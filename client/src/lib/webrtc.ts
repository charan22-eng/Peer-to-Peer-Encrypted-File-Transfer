import { useStore } from '../store/useStore';
import { hashFileStream, generateECDHKeyPair, exportPublicKey, deriveAESKey, encryptChunk, decryptChunk, fingerprintPublicKeys } from './crypto';
import { createSHA256 } from 'hash-wasm';
import { Zip, ZipPassThrough } from 'fflate';

const CHUNK_SIZE = 16384;
const BUFFER_THRESHOLD = 65536; // 64KB backpressure limit to prevent ngrok frame drops

function sanitizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/');
  return normalized
    .split('/')
    .filter(part => part.length > 0 && part !== '.' && part !== '..')
    .join('/')
    .slice(0, 1024);
}

export class WebRTCManager {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  
  private receiveBuffer: ArrayBuffer[] = [];
  private expectedFileHash = '';
  private expectedFileName = '';
  private expectedFileMime = '';
  
  private iceTimeout: number | null = null;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private isRelayed = false;
  
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  
  private ecdhKeyPair: CryptoKeyPair | null = null;
  private sharedAesKey: CryptoKey | null = null;
  private jwtToken: string | null = null;

  private signalingUrl: string;
  private opfsFileHandle: any = null;
  private opfsWritable: any = null;
  private messageQueue: any[] = [];
  private isProcessingMessage = false;
  private offsetResolver: ((offset: number) => void) | null = null;
  private batchResultResolver: (() => void) | null = null;
  private globalFallbackTimeout: any = null;
  private batchHadFailure = false;
  private isSendingBatch = false;
  private batchSendVerified = true;
  
  private receiveHasher: any = null;
  private isBatch = false;
  private batchZip: Zip | null = null;
  private batchBuffer: Uint8Array[] = [];
  private batchWritePromise: Promise<void> = Promise.resolve();
  private currentZipFile: ZipPassThrough | null = null;
  private batchCompletedFiles = 0;

  private async waitForSharedKey(timeoutMs = 10000): Promise<boolean> {
    const started = Date.now();
    while (!this.sharedAesKey && Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return this.sharedAesKey !== null;
  }
  
  constructor(signalingUrl?: string) {
    if (signalingUrl) {
      this.signalingUrl = signalingUrl;
    } else if (import.meta.env.VITE_SIGNALING_URL) {
      this.signalingUrl = import.meta.env.VITE_SIGNALING_URL;
    } else if (typeof window !== 'undefined' && window.location && window.location.host) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.signalingUrl = `${proto}//${window.location.host}`;
    } else {
      this.signalingUrl = 'ws://localhost:8080';
    }
  }

  private async connectSignaling(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    if (!this.jwtToken) {
      const httpUrl = this.signalingUrl.replace(/^ws/, 'http');
      const res = await fetch(`${httpUrl}/auth/token`);
      if (!res.ok) throw new Error('Failed to fetch token');
      const data = await res.json();
      this.jwtToken = data.token;
    }

    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`${this.signalingUrl}/`, [`peerlink.jwt.${this.jwtToken}`]);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = this.handleSignalingMessage.bind(this);
      this.ws.onclose = () => {
        this.jwtToken = null;
        const state = useStore.getState();
        if (state.connectionStatus !== 'idle' && state.connectionStatus !== 'disconnected' && state.connectionStatus !== 'failed') {
          useStore.getState().setConnectionStatus('failed');
          useStore.getState().updateTransfer({ stage: 'error' });
        }
      };
    });
  }

  private handleSignalingMessage(event: MessageEvent) {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      useStore.getState().addDebugLog('[SIGNAL] Ignored malformed message');
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const store = useStore.getState();

    switch (msg.type) {
      case 'ping':
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        }
        break;
      case 'room-created':
        store.setRoomCode(msg.roomCode);
        store.setRole('initiator');
        store.setConnectionStatus('waiting');
        break;
      case 'room-joined':
        store.addDebugLog('[SIGNAL] Joined room: ' + msg.roomCode);
        store.setRoomCode(msg.roomCode);
        store.setRole('joiner');
        store.setConnectionStatus('connecting');
        this.setupPeerConnection();
        this.startGlobalFallbackTimeout();
        break;
      case 'peer-joined':
        store.addDebugLog('[SIGNAL] Peer joined room');
        store.setConnectionStatus('connecting');
        this.setupPeerConnection();
        this.createOffer();
        this.startGlobalFallbackTimeout();
        break;
      case 'peer-left':
        this.disconnect('Peer disconnected');
        break;
      case 'error':
        this.disconnect(`Error: ${msg.message}`, true);
        break;
      case 'signal':
        void this.handleSignal(msg.payload).catch(error => {
          console.error('Signal processing failed:', error);
          useStore.getState().updateTransfer({ stage: 'error' });
        });
        break;
    }
  }

  private startGlobalFallbackTimeout() {
    if (this.globalFallbackTimeout) clearTimeout(this.globalFallbackTimeout);
    this.globalFallbackTimeout = setTimeout(() => {
      if (useStore.getState().connectionStatus !== 'connected') {
        useStore.getState().addDebugLog('[GLOBAL TIMEOUT] Forcing fallback to Relay');
        this.fallbackToRelay();
      }
    }, 12000); // 12 seconds after peering up
  }

  private setupPeerConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    if (this.ecdhKeyPair) {
      exportPublicKey(this.ecdhKeyPair.publicKey).then(key => {
        this.sendSignal({ type: 'public-key', key });
      });
    }

    // We rely on the browser's native iceConnectionState === 'failed' state
    // rather than a hardcoded manual timeout, to allow slow TURN relays to connect.

    this.pc.onicecandidate = (event) => {
      const msg = `[CANDIDATE] ${event.candidate ? event.candidate.candidate : 'end-of-candidates'}`;
      console.log(msg);
      useStore.getState().addDebugLog(msg);
      if (event.candidate) {
        this.sendSignal({ candidate: event.candidate });
      }
    };

    this.pc.onicegatheringstatechange = () => {
      const msg = `[ICE GATHERING] ${this.pc?.iceGatheringState}`;
      console.log(msg, new Date().toISOString());
      useStore.getState().addDebugLog(msg);
    };

    // Removed onnegotiationneeded to prevent double-offers when peer-joined fires

    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        useStore.getState().setRemoteStream(event.streams[0]);
      }
    };

    let disconnectTimeout: any = null;

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      const msg = `[ICE STATE] ${state}`;
      console.log(msg, new Date().toISOString());
      useStore.getState().addDebugLog(msg);
      
      if (state === 'connected' || state === 'completed') {
        if (this.globalFallbackTimeout) clearTimeout(this.globalFallbackTimeout);
        if (disconnectTimeout) {
          clearTimeout(disconnectTimeout);
          disconnectTimeout = null;
        }
        useStore.getState().setConnectionStatus('connected');
      } else if (state === 'checking') {
        if (!disconnectTimeout) {
          disconnectTimeout = setTimeout(() => {
            if (this.pc?.iceConnectionState === 'checking' || this.pc?.iceConnectionState === 'disconnected') {
              this.fallbackToRelay();
            }
          }, 8000); // 8 seconds in checking -> fallback
        }
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        if (disconnectTimeout) clearTimeout(disconnectTimeout);
        this.fallbackToRelay();
      }
    };

    const role = useStore.getState().role;
    if (role === 'initiator') {
      this.dc = this.pc.createDataChannel('fileTransfer', { ordered: true });
      this.setupDataChannel();
    } else {
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.setupDataChannel();
      };
    }
  }

  private fallbackToRelay() {
    if (this.globalFallbackTimeout) clearTimeout(this.globalFallbackTimeout);
    if (this.isRelayed) return;
    this.isRelayed = true;
    useStore.getState().addDebugLog('[FALLBACK] Using WebSocket Relay');
    useStore.getState().setConnectionStatus('connected');
    
    // Stop WebRTC things
    if (this.dc) this.dc.close();
    if (this.pc) this.pc.close();
    
    // Fake data channel setup for UI
    if (useStore.getState().role === 'initiator') {
      setTimeout(() => this.handleDataChannelOpen(), 100);
    } else {
      setTimeout(() => this.handleDataChannelOpen(), 100);
    }
  }

  private setupDataChannel() {
    if (!this.dc) return;
    this.dc.binaryType = 'arraybuffer';
    this.dc.bufferedAmountLowThreshold = 65536; // 64KB backpressure threshold
    
    this.dc.onopen = () => {
      this.handleDataChannelOpen();
    };
    
    this.dc.onclose = () => {
      if (!this.isRelayed) {
        if (useStore.getState().connectionStatus !== 'connected') {
          this.fallbackToRelay();
        } else {
          this.disconnect('Data channel closed');
        }
      }
    };
    
    this.dc.onerror = () => {
      if (!this.isRelayed) {
        if (useStore.getState().connectionStatus !== 'connected') {
          this.fallbackToRelay();
        } else {
          this.disconnect('Data channel error', true);
        }
      }
    };

    this.dc.onmessage = (event) => {
      this.messageQueue.push(event.data);
      this.processMessageQueue();
    };
  }

  private handleDataChannelOpen() {
    useStore.getState().setConnectionStatus('connected');
    const store = useStore.getState();
    if (store.role === 'initiator' && store.pendingFiles.length > 0) {
      void this.sendPendingOfferWhenReady();
    }
  }

  private async sendPendingOfferWhenReady() {
    const ready = await this.waitForSharedKey();
    if (!ready) {
      useStore.getState().addDebugLog('[CRYPTO] Shared key was not established');
      useStore.getState().updateTransfer({ stage: 'error' });
      return;
    }

    const files = useStore.getState().pendingFiles;
    if (files.length === 0) return;

    if (files.length === 1) {
      const file = files[0];
      this.sendAppMessage({
        type: 'file-offer',
        name: file.name,
        size: file.size,
        mime: file.type
      });
      return;
    }

    const batchName = (files[0] as any).webkitRelativePath
      ? (files[0] as any).webkitRelativePath.split('/')[0]
      : 'folder';
    this.sendAppMessage({
      type: 'batch-offer',
      name: batchName,
      size: files.reduce((total, file) => total + file.size, 0),
      totalFiles: files.length,
      mime: 'application/zip'
    });
  }

  private async processMessageQueue() {
    if (this.isProcessingMessage) return;
    this.isProcessingMessage = true;
    try {
      while (this.messageQueue.length > 0) {
        const data = this.messageQueue.shift();
        if (typeof data === 'string') {
          const msg = JSON.parse(data);
        if (msg.type === 'batch-meta') {
          this.isBatch = true;
          this.batchHadFailure = false;
          this.batchCompletedFiles = 0;
          this.batchBuffer = [];
          this.batchWritePromise = Promise.resolve();
          this.expectedFileName = `${msg.name}.zip`;
          
          useStore.getState().updateTransfer({
            direction: 'receive',
            fileName: this.expectedFileName,
            fileSize: msg.totalSize,
            stage: 'transferring',
            bytesTransferred: 0,
            batchTotalFiles: msg.totalFiles,
            batchCurrentIndex: 0,
            verified: null
          });

          this.batchZip = new Zip((err, data, final) => {
            if (err) console.error('Zip error', err);
            if (this.opfsWritable) {
              this.batchWritePromise = this.batchWritePromise.then(async () => {
                await this.opfsWritable?.write(data);
                if (final) {
                  await this.opfsWritable?.close();
                  this.opfsWritable = null;
                }
              });
            } else if (data.byteLength > 0) {
              this.batchBuffer.push(new Uint8Array(data));
            }
          });
          
          const opfsFilename = `${this.expectedFileName}.part`;
          if (navigator.storage && navigator.storage.getDirectory) {
            const dir = await navigator.storage.getDirectory();
            this.opfsFileHandle = await dir.getFileHandle(opfsFilename, { create: true });
            this.opfsWritable = await this.opfsFileHandle.createWritable();
          }
        } else if (msg.type === 'file-offer' || msg.type === 'batch-offer') {
          useStore.getState().setPendingFileMeta({
            name: msg.name,
            size: msg.size,
            mime: msg.mime,
            hash: '',
            isBatch: msg.type === 'batch-offer',
            totalFiles: msg.totalFiles
          });
        } else if (msg.type === 'accept-transfer') {
          const files = useStore.getState().pendingFiles;
          if (files.length > 0) {
            if (files.length === 1) {
              void this.sendFile(files[0]);
            } else {
              void this.sendFiles(files);
            }
          }
        } else if (msg.type === 'file-meta') {
          if (!this.isBatch && this.receiveHasher) {
            console.error('Transfer already in progress');
            continue;
          }
          this.expectedFileName = msg.name;
          this.expectedFileMime = msg.mime;
          this.expectedFileHash = msg.hash || ''; // Hash might come later
          this.receiveBuffer = [];
          
          this.receiveHasher = await createSHA256();
          this.receiveHasher.init();

          const cleanPath = sanitizeRelativePath(String(msg.path || msg.name || 'file')) || 'file';

          if (this.isBatch) {
            this.currentZipFile = new ZipPassThrough(cleanPath);
            this.batchZip!.add(this.currentZipFile);
            
            this.sendAppMessage({ type: 'file-offset', offset: 0 });
            continue;
          }

          this.opfsFileHandle = null;
          this.opfsWritable = null;

          const opfsFilename = `${msg.name}_${msg.hash}.part`;
          let existingSize = 0;

          try {
            if (navigator.storage && navigator.storage.getDirectory) {
              const dir = await navigator.storage.getDirectory();
              
              try {
                this.opfsFileHandle = await dir.getFileHandle(opfsFilename, { create: false });
                const existingFile = await this.opfsFileHandle.getFile();
                existingSize = existingFile.size;
                if (existingSize > msg.size) {
                  await dir.removeEntry(opfsFilename);
                  this.opfsFileHandle = await dir.getFileHandle(opfsFilename, { create: true });
                  existingSize = 0;
                }
              } catch {
                this.opfsFileHandle = await dir.getFileHandle(opfsFilename, { create: true });
              }

              this.opfsWritable = await this.opfsFileHandle.createWritable({ keepExistingData: true });
              if (existingSize > 0) await this.opfsWritable.seek(existingSize);
            }
          } catch {
            existingSize = 0;
          }

          useStore.getState().updateTransfer({
            direction: 'receive',
            fileName: msg.name,
            fileSize: msg.size,
            bytesTransferred: existingSize,
            stage: 'transferring',
            verified: null
          });

          if (existingSize > 0) {
            const existingFile = await this.opfsFileHandle!.getFile();
            for (let offset = 0; offset < existingFile.size; offset += 4 * 1024 * 1024) {
              const chunk = await existingFile.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer();
              this.receiveHasher.update(new Uint8Array(chunk));
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }

          this.sendAppMessage({ type: 'file-offset', offset: existingSize });
        } else if (msg.type === 'file-hash') {
          this.expectedFileHash = msg.hash;
        } else if (msg.type === 'file-done') {
          const fileHash = this.receiveHasher ? this.receiveHasher.digest('hex') : '';
          const verified = fileHash === this.expectedFileHash;
          if (!verified) {
            console.warn(`Hash mismatch! Expected: ${this.expectedFileHash}, Got: ${fileHash}`);
          }
          
          if (this.isBatch && this.currentZipFile) {
            this.currentZipFile.push(new Uint8Array(0), true);
            this.currentZipFile = null;
            this.batchCompletedFiles++;
            useStore.getState().updateTransfer({ batchCurrentIndex: this.batchCompletedFiles });
            if (!verified) this.batchHadFailure = true;
            this.sendAppMessage({ type: 'file-result', verified, receivedSize: useStore.getState().transfer.bytesTransferred });
            this.receiveHasher = null;
          } else {
            useStore.getState().updateTransfer({ stage: 'verifying' });
            await this.finishReceive(verified);
            this.receiveHasher = null;
          }
        } else if (msg.type === 'batch-done') {
          if (this.batchZip) {
            this.batchZip.end();
          }
          await this.batchWritePromise;
          useStore.getState().updateTransfer({ stage: 'complete', verified: !this.batchHadFailure });
           
          if (!this.batchHadFailure) {
            let finalBlob: Blob;
            if (this.opfsFileHandle) {
              finalBlob = await this.opfsFileHandle.getFile();
            } else {
              const batchParts = this.batchBuffer.map(chunk => chunk.slice().buffer as ArrayBuffer);
              finalBlob = new Blob(batchParts, { type: 'application/zip' });
            }
            if (finalBlob.size > 0) {
              const objectUrl = URL.createObjectURL(finalBlob);
              const a = document.createElement('a');
              a.href = objectUrl;
              a.download = this.expectedFileName;
              a.click();
              URL.revokeObjectURL(objectUrl);
            }
          }
          this.batchBuffer = [];
          this.isBatch = false;
        } else if (msg.type === 'file-result') {
          if (!this.isSendingBatch) {
            useStore.getState().updateTransfer({ stage: 'complete', verified: msg.verified });
          }
          if (!msg.verified) this.batchSendVerified = false;
          if (!msg.verified) {
            alert(`Receiver reported a hash mismatch. Received: ${msg.receivedSize} bytes.`);
          }
          if (this.batchResultResolver) {
            this.batchResultResolver();
            this.batchResultResolver = null;
          }
        } else if (msg.type === 'file-offset') {
          if (this.offsetResolver) {
            this.offsetResolver(msg.offset);
            this.offsetResolver = null;
          }
        }
        } else {
          let chunkData = data;
          if (!(await this.waitForSharedKey())) {
            throw new Error('Shared encryption key is unavailable');
          }
          try {
            chunkData = await decryptChunk(this.sharedAesKey!, data);
          } catch (e) {
            throw new Error(`Decryption failed: ${String(e)}`);
          }

        if (this.receiveHasher) {
          this.receiveHasher.update(new Uint8Array(chunkData));
        }

        if (this.isBatch && this.currentZipFile) {
          this.currentZipFile.push(new Uint8Array(chunkData), false);
        } else if (this.opfsWritable) {
          await this.opfsWritable.write(chunkData);
        } else {
          this.receiveBuffer.push(chunkData);
        }
        useStore.getState().updateTransfer({
          bytesTransferred: useStore.getState().transfer.bytesTransferred + chunkData.byteLength
        });
        }
      }
    } catch (error) {
      console.error('Message processing failed:', error);
      this.messageQueue = [];
      useStore.getState().updateTransfer({ stage: 'error', verified: false });
    } finally {
      this.isProcessingMessage = false;
    }
  }

  private async finishReceive(preVerified?: boolean) {
    let fileToHash: File;
    let finalBlob: Blob;

    if (this.opfsWritable && this.opfsFileHandle) {
      await this.opfsWritable.close();
      fileToHash = await this.opfsFileHandle.getFile() as unknown as File;
      finalBlob = fileToHash;
    } else {
      finalBlob = new Blob(this.receiveBuffer, { type: this.expectedFileMime });
      fileToHash = new File([finalBlob], this.expectedFileName, { type: this.expectedFileMime });
    }

    let verified = preVerified;
    if (verified === undefined) {
      const computedHash = await hashFileStream(fileToHash);
      verified = computedHash === this.expectedFileHash;
    }
    
    useStore.getState().updateTransfer({ verified, stage: 'complete' });
    
    // Acknowledge to sender
    this.sendAppMessage({ type: 'file-result', verified, receivedSize: useStore.getState().transfer.bytesTransferred });

    if (verified) {
      // Trigger download
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.expectedFileName;
      a.click();
      URL.revokeObjectURL(url);
      
      // Clean up OPFS part file
      try {
        if (navigator.storage && navigator.storage.getDirectory) {
          const dir = await navigator.storage.getDirectory();
          await dir.removeEntry(`${this.expectedFileName}_${this.expectedFileHash}.part`);
        }
      } catch (e) {
        console.warn('Failed to cleanup OPFS file', e);
      }
    }
  }

  private async createOffer() {
    if (!this.pc) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    useStore.getState().addDebugLog('[SIGNAL] Offer sent');
    this.sendSignal({ sdp: this.pc.localDescription });
  }

  private async handleSignal(payload: any) {
    if (!this.pc) return;
    if (payload.sdp) {
      if (payload.sdp.type === 'answer') {
        useStore.getState().addDebugLog('[SIGNAL] Answer received');
      } else if (payload.sdp.type === 'offer') {
        useStore.getState().addDebugLog('[SIGNAL] Offer received');
      }
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      
      // Flush queued candidates
      while (this.iceCandidateQueue.length > 0) {
        const cand = this.iceCandidateQueue.shift();
        if (cand) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.error('Error adding queued ICE candidate', e);
          }
        }
      }

      if (payload.sdp.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        useStore.getState().addDebugLog('[SIGNAL] Answer sent');
        this.sendSignal({ sdp: this.pc.localDescription });
      }
    } else if (payload.candidate) {
      if (!this.pc.remoteDescription) {
        // Queue candidates that arrive before remote description
        this.iceCandidateQueue.push(payload.candidate);
      } else {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) {
          console.error('Error adding ICE candidate', e);
        }
      }
    } else if (payload.type === 'public-key') {
      if (this.ecdhKeyPair && payload.key) {
        this.sharedAesKey = await deriveAESKey(this.ecdhKeyPair.privateKey, payload.key);
        const localKey = await exportPublicKey(this.ecdhKeyPair.publicKey);
        const fingerprint = await fingerprintPublicKeys(localKey, payload.key);
        useStore.getState().setSecurityFingerprint(fingerprint);
        useStore.getState().addDebugLog(`[CRYPTO] Key fingerprint: ${fingerprint}`);
        console.log('E2EE AES-GCM Shared Key Derived');
      }
    } else if (payload.relayType === 'chunk') {
      if (!this.isRelayed) this.fallbackToRelay();
      // Decode base64 to ArrayBuffer
      const binaryString = atob(payload.data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      this.messageQueue.push(bytes.buffer);
      this.processMessageQueue();
    } else if (payload.relayType === 'app') {
      if (!this.isRelayed) this.fallbackToRelay();
      this.messageQueue.push(JSON.stringify(payload.data));
      this.processMessageQueue();
    }
  }

  private sendSignal(payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'signal', payload }));
    }
  }

  private sendAppMessage(msg: any) {
    if (this.isRelayed && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'signal', payload: { relayType: 'app', data: msg } }));
    } else if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
    }
  }

  private async sendData(data: ArrayBuffer) {
    if (this.isRelayed && this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Robust base64 encoding using FileReader
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(',')[1]);
        };
        reader.readAsDataURL(new Blob([data]));
      });
      this.ws.send(JSON.stringify({ type: 'signal', payload: { relayType: 'chunk', data: base64 } }));
    } else if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(data);
    } else {
      throw new Error('No active data channel or relay connection');
    }
  }

  private async fetchIceServers() {
    try {
      const httpUrl = this.signalingUrl.replace(/^ws/, 'http');
      const res = await fetch(`${httpUrl}/turn-credentials`);
      if (res.ok) {
        const data = await res.json();
        if (data.iceServers) {
          this.iceServers = data.iceServers;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch TURN credentials, using fallback STUN', e);
    }
  }

  public async createRoom() {
    useStore.getState().setConnectionStatus('creating');
    try {
      this.isRelayed = false;
      this.sharedAesKey = null;
      this.iceCandidateQueue = [];
      this.ecdhKeyPair = await generateECDHKeyPair();
      await this.fetchIceServers();
      await this.connectSignaling();
      this.ws!.send(JSON.stringify({ type: 'create-room' }));
    } catch (err) {
      useStore.getState().setConnectionStatus('failed');
      console.error(err);
    }
  }

  public async joinRoom(roomCode: string) {
    useStore.getState().setConnectionStatus('joining');
    try {
      this.isRelayed = false;
      this.sharedAesKey = null;
      this.iceCandidateQueue = [];
      this.ecdhKeyPair = await generateECDHKeyPair();
      await this.fetchIceServers();
      await this.connectSignaling();
      this.ws!.send(JSON.stringify({ type: 'join-room', roomCode }));
    } catch (err) {
      useStore.getState().setConnectionStatus('failed');
      console.error(err);
    }
  }

  public acceptTransfer() {
    this.sendAppMessage({ type: 'accept-transfer' });
  }

  public async sendFiles(files: File[]) {
    if (files.length === 0) return;
    if (!this.isRelayed && (!this.dc || this.dc.readyState !== 'open')) return;
    
    if (files.length === 1) {
      return this.sendFile(files[0]);
    }
    
    const batchName = (files[0] as any).webkitRelativePath 
      ? (files[0] as any).webkitRelativePath.split('/')[0] 
      : 'folder';
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    this.isSendingBatch = true;
    this.batchSendVerified = true;
    useStore.getState().updateTransfer({
      direction: 'send',
      fileName: `${batchName}.zip`,
      fileSize: totalSize,
      stage: 'transferring',
      bytesTransferred: 0,
      batchTotalFiles: files.length,
      batchCurrentIndex: 0,
      verified: null
    });
    
    this.sendAppMessage({ 
      type: 'batch-meta', 
      name: batchName, 
      totalSize, 
      totalFiles: files.length 
    });
    
    useStore.getState().updateTransfer({
       batchTotalFiles: files.length,
       batchCurrentIndex: 0
    });

    for (let i = 0; i < files.length; i++) {
       useStore.getState().updateTransfer({ batchCurrentIndex: i + 1 });
       await this.sendFile(files[i], true);
    }
    
    this.sendAppMessage({ type: 'batch-done' });
    useStore.getState().updateTransfer({ stage: 'complete', verified: this.batchSendVerified });
    this.isSendingBatch = false;
  }

  public async sendFile(file: File, isBatch = false) {
    if (!this.isRelayed && (!this.dc || this.dc.readyState !== 'open')) return;
    if (!isBatch && useStore.getState().transfer.stage !== 'idle') {
      console.error('Transfer already in progress');
      return;
    }

    if (!useStore.getState().securityVerified) {
      console.error('Security fingerprint must be verified before transfer');
      useStore.getState().updateTransfer({ stage: 'error' });
      if (isBatch) this.batchSendVerified = false;
      return;
    }

    if (!isBatch) {
      useStore.getState().updateTransfer({
        direction: 'send',
        fileName: file.name,
        fileSize: file.size,
        stage: 'hashing',
        bytesTransferred: 0,
        verified: null
      });
    }

    if (!(await this.waitForSharedKey())) {
      console.error('Shared encryption key is unavailable');
      useStore.getState().updateTransfer({ stage: 'error' });
      if (isBatch) this.batchSendVerified = false;
      return;
    }

    let hash: string;
    try {
      hash = await hashFileStream(file);
    } catch (error) {
      console.error('Failed to hash file:', error);
      useStore.getState().updateTransfer({ stage: 'error' });
      if (isBatch) this.batchSendVerified = false;
      return;
    }
    useStore.getState().updateTransfer({ stage: 'transferring' });

    let startOffset = 0;
    const offsetPromise = new Promise<number>((resolve) => {
      this.offsetResolver = resolve;
      setTimeout(() => {
        if (this.offsetResolver) {
          this.offsetResolver = null;
          resolve(0);
        }
      }, 5000);
    });
    
    this.sendAppMessage({
      type: 'file-meta',
      name: file.name,
      path: (file as any).webkitRelativePath || file.name,
      size: file.size,
      mime: file.type,
      hash
    });

    // Wait for receiver to send 'file-offset'
    try {
      startOffset = await offsetPromise;
    } catch (e) {
      console.warn('Failed to get offset', e);
    }

    useStore.getState().updateTransfer({ stage: 'transferring' });

    let offset = Math.max(0, Math.min(startOffset, file.size));
    useStore.getState().updateTransfer({ bytesTransferred: offset });

    let resultPromise: Promise<void> | null = null;
    if (isBatch) {
      resultPromise = new Promise<void>((resolve) => {
        this.batchResultResolver = resolve;
      });
    }

    const sendChunk = async () => {
      while (offset < file.size) {
        if (!this.isRelayed && this.dc!.bufferedAmount > BUFFER_THRESHOLD) {
          // Wait for buffer to drain
          await new Promise<void>((resolve, reject) => {
            if (!this.dc) return reject('No data channel');
            
            const handleLow = () => {
              cleanup();
              resolve();
            };
            
            const handleClose = () => {
              cleanup();
              reject('Data channel closed while buffering');
            };
            
            const cleanup = () => {
              this.dc?.removeEventListener('bufferedamountlow', handleLow);
              this.dc?.removeEventListener('close', handleClose);
              this.dc?.removeEventListener('error', handleClose);
            };

            this.dc.addEventListener('bufferedamountlow', handleLow);
            this.dc.addEventListener('close', handleClose);
            this.dc.addEventListener('error', handleClose);
          });
        } else if (this.isRelayed && this.ws && this.ws.bufferedAmount > BUFFER_THRESHOLD) {
          // Wait for websocket buffer to drain
          await new Promise<void>((resolve, reject) => {
            const check = setInterval(() => {
              if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                clearInterval(check);
                reject('WebSocket closed while buffering');
              } else if (this.ws.bufferedAmount <= BUFFER_THRESHOLD) {
                clearInterval(check);
                resolve();
              }
            }, 50); // Poll every 50ms
          });
        }
        
        if (!this.isRelayed && (!this.dc || this.dc.readyState !== 'open')) return;
        if (this.isRelayed && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) return;

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(offset, end);
        const chunk = await chunkBlob.arrayBuffer();
        
        const dataToSend = await encryptChunk(this.sharedAesKey!, chunk);
        
        await this.sendData(dataToSend);
        const bytesSent = end - offset;
        offset = end;
        
        const currentBytes = isBatch
          ? useStore.getState().transfer.bytesTransferred + bytesSent
          : offset;
        useStore.getState().updateTransfer({ bytesTransferred: currentBytes });
        
        // Yield to event loop to allow WebRTC ICE keepalives to process
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (this.isRelayed || (this.dc && this.dc.readyState === 'open')) {
        this.sendAppMessage({ type: 'file-done' });
        if (!isBatch) {
          useStore.getState().updateTransfer({ stage: 'verifying' }); // Sender waits for receiver
        }
      }
    };

    try {
      await sendChunk();
      if (resultPromise) await resultPromise;
    } catch (e) {
      console.error('Transfer aborted:', e);
      useStore.getState().updateTransfer({ stage: 'error' });
      if (isBatch) this.batchSendVerified = false;
    }
  }

  public disconnect(reason?: string, isFailed: boolean = false) {
    if (this.globalFallbackTimeout) clearTimeout(this.globalFallbackTimeout);
    if (this.iceTimeout) clearTimeout(this.iceTimeout);
    this.stopMedia();
    if (this.dc) this.dc.close();
    if (this.pc) this.pc.close();
    if (this.ws) this.ws.close();
    this.dc = null;
    this.pc = null;
    this.ws = null;
    this.isRelayed = false;
    this.sharedAesKey = null;
    this.ecdhKeyPair = null;
    this.iceCandidateQueue = [];
    this.messageQueue = [];
    this.isProcessingMessage = false;
    this.offsetResolver = null;
    this.batchResultResolver = null;
    this.receiveHasher = null;
    this.isBatch = false;
    this.isSendingBatch = false;
    this.batchHadFailure = false;
    this.batchSendVerified = true;
    
    const store = useStore.getState();
    if (isFailed) {
      store.setConnectionStatus('failed');
      if (reason) alert(reason);
    } else {
      store.setConnectionStatus('disconnected');
    }
  }

  public async shareMedia(type: 'camera' | 'screen') {
    if (!this.pc) return;
    
    try {
      this.stopMedia();
      
      this.localStream = type === 'camera' 
        ? await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
      useStore.getState().setLocalStream(this.localStream);
      
      this.localStream.getTracks().forEach(track => {
        if (this.pc && this.localStream) {
          this.pc.addTrack(track, this.localStream);
        }
      });
      
    } catch (e) {
      console.error(`Failed to share ${type}`, e);
    }
  }
  
  public stopMedia() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => {
        t.stop();
        if (this.pc) {
          const sender = this.pc.getSenders().find(s => s.track === t);
          if (sender) this.pc.removeTrack(sender);
        }
      });
      this.localStream = null;
      useStore.getState().setLocalStream(null);
    }
  }
}

export const webrtc = new WebRTCManager();
