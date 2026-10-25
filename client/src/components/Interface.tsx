import { useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { webrtc } from '../lib/webrtc';
import { LucideUpload, LucideWifi, LucideWifiOff, LucideShieldCheck, LucideFile, LucideLoader2, LucideAlertCircle, LucideTerminal, LucideCopy } from 'lucide-react';

export function Interface() {
  const store = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDebug, setShowDebug] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      store.setPendingFiles(files);
    }
  };

  const startSending = () => {
    if (store.pendingFiles.length > 0) {
      store.setFlowState('send-wait');
      webrtc.createRoom();
    }
  };

  const joinRoom = (code: string) => {
    store.setFlowState('receive-input');
    webrtc.joinRoom(code);
  };

  const acceptTransfer = () => {
    if (!store.securityVerified) return;
    webrtc.acceptTransfer();
  };

  const renderSecurityVerification = () => {
    if (!store.securityFingerprint || store.securityVerified) return null;
    return (
      <div className="mb-4 rounded-xl border border-[var(--color-brand-secondary)]/50 bg-black/30 p-4 text-center">
        <p className="text-xs text-[var(--color-text-secondary)] mb-2">Compare this security code with the other peer out-of-band:</p>
        <p className="font-mono text-sm tracking-wider text-[var(--color-brand-primary)] break-all">{store.securityFingerprint}</p>
        <button
          onClick={() => store.setSecurityVerified(true)}
          className="mt-3 rounded-lg bg-[var(--color-brand-secondary)] px-4 py-2 text-xs font-bold text-black hover:bg-white"
        >
          I verified this code
        </button>
      </div>
    );
  };

  const renderHome = () => (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button 
        onClick={() => store.setFlowState('send-pick')}
        className="w-full bg-[var(--color-brand-primary)] text-black font-bold py-4 rounded-xl hover:bg-white transition-colors"
      >
        Send
      </button>
      <button 
        onClick={() => store.setFlowState('receive-input')}
        className="w-full bg-white/10 text-white font-bold py-4 rounded-xl hover:bg-white/20 transition-colors"
      >
        Receive
      </button>
    </div>
  );

  const renderSendPick = () => (
    <div className="flex flex-col gap-4 animate-in fade-in duration-500">
      <button 
        onClick={() => store.setFlowState('home')}
        className="text-xs text-[var(--color-text-muted)] hover:text-white mb-2 self-start"
      >
        &larr; Back
      </button>

      {store.pendingFiles.length === 0 ? (
        <div className="flex gap-4 w-full">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 bg-white/5 border border-white/10 border-dashed text-white font-bold py-12 rounded-2xl hover:bg-white/10 hover:border-white/30 transition-all flex flex-col items-center justify-center gap-4 group"
          >
            <LucideUpload size={32} className="text-[var(--color-brand-primary)] group-hover:-translate-y-2 transition-transform" />
            <span>Select File</span>
          </button>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LucideFile size={24} className="text-[var(--color-brand-primary)]" />
            <div className="overflow-hidden">
              <p className="font-bold truncate max-w-[200px]">
                {store.pendingFiles.length === 1 ? store.pendingFiles[0].name : `${store.pendingFiles.length} files`}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {(store.pendingFiles.reduce((total, file) => total + file.size, 0) / 1024 / 1024).toFixed(2)} MB total
              </p>
            </div>
          </div>
          <button 
            onClick={() => store.setPendingFiles([])}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            Clear
          </button>
        </div>
      )}
      
      <input type="file" aria-label="File Upload" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple />

      <button 
        onClick={startSending}
        disabled={store.pendingFiles.length === 0}
        className={`w-full font-bold py-4 rounded-xl transition-colors mt-4 ${
          store.pendingFiles.length > 0 
            ? 'bg-[var(--color-brand-primary)] text-black hover:bg-white' 
            : 'bg-white/5 text-[var(--color-text-muted)] cursor-not-allowed'
        }`}
      >
        Send
      </button>
    </div>
  );

  const renderSendWait = () => (
    <div className="flex flex-col items-center justify-center py-8 animate-in fade-in zoom-in duration-500">
      <p className="text-[var(--color-text-secondary)] mb-4">Waiting for receiver...</p>
      <div className="text-5xl font-mono tracking-widest text-[var(--color-brand-primary)] font-bold bg-black/30 py-4 px-8 rounded-2xl border border-[var(--color-brand-primary)]/20 shadow-[0_0_30px_rgba(95,217,138,0.2)]">
        {store.roomCode || '...'}
      </div>
    </div>
  );

  const renderReceiveInput = () => (
    <div className="flex flex-col gap-4 animate-in fade-in duration-500">
      <button 
        onClick={() => store.setFlowState('home')}
        className="text-xs text-[var(--color-text-muted)] hover:text-white mb-2 self-start"
      >
        &larr; Back
      </button>
      <input 
        type="text" 
        aria-label="Room Code"
        placeholder="Enter 10-Character Code" 
        className="w-full bg-black/50 border border-white/10 rounded-xl py-4 px-4 text-center font-mono text-2xl uppercase focus:outline-none focus:border-[var(--color-brand-secondary)] transition-colors tracking-[0.5em]"
        maxLength={10}
        onChange={(e) => {
          if (e.target.value.length === 10) {
            joinRoom(e.target.value.toUpperCase());
          }
        }}
      />
    </div>
  );

  const renderConnecting = () => (
    <div className="flex flex-col items-center justify-center py-12 animate-in fade-in duration-500">
      <LucideLoader2 className="animate-spin text-[var(--color-brand-secondary)] mb-4" size={32} />
      <p className="text-[var(--color-text-secondary)]">Connecting...</p>
    </div>
  );

  const renderAcceptTransfer = () => {
    if (!store.pendingFileMeta) return null;
    return (
      <div className="flex flex-col gap-4 animate-in fade-in duration-500">
        <p className="text-center text-[var(--color-text-secondary)]">Incoming Transfer:</p>
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col items-center gap-2">
          <LucideFile size={48} className="text-[var(--color-brand-secondary)] mb-2" />
          <p className="font-bold text-lg text-center break-all">{store.pendingFileMeta.name}</p>
          <p className="text-sm text-[var(--color-text-muted)]">{(store.pendingFileMeta.size / 1024 / 1024).toFixed(2)} MB</p>
          {store.pendingFileMeta.isBatch && (
            <p className="text-xs text-[var(--color-text-muted)]">{store.pendingFileMeta.totalFiles} files</p>
          )}
        </div>
        <button 
          onClick={acceptTransfer}
          disabled={!store.securityVerified}
          className="w-full bg-[var(--color-brand-secondary)] text-black font-bold py-4 rounded-xl hover:bg-white transition-colors mt-2"
        >
          {store.securityVerified ? 'Accept' : 'Verify security code first'}
        </button>
      </div>
    );
  };

  const renderTransferProgress = () => {
    // Both sender and receiver see this once stage is 'transferring'
    const name = store.role === 'initiator'
      ? (store.pendingFiles.length === 1 ? (store.pendingFiles[0]?.name || '') : `${store.pendingFiles.length} files`)
      : (store.pendingFileMeta?.name || '');
    const size = store.role === 'initiator'
      ? store.pendingFiles.reduce((total, file) => total + file.size, 0)
      : (store.pendingFileMeta?.size || 0);
    const transferred = store.transfer.bytesTransferred;
    const progressPercent = size > 0 ? (transferred / size) * 100 : 0;
    
    return (
      <div className="flex flex-col gap-4 py-4 animate-in fade-in duration-500">
        <div className="flex justify-between items-end mb-2">
          <div className="overflow-hidden">
            <p className="font-bold truncate text-lg">{name}</p>
            <p className="text-sm text-[var(--color-text-secondary)] capitalize">{store.transfer.direction || (store.role === 'initiator' ? 'send' : 'receive')}ing...</p>
          </div>
          <div className="text-right whitespace-nowrap ml-4">
            <p className="font-mono text-[var(--color-brand-secondary)]">
              {progressPercent.toFixed(0)}%
            </p>
          </div>
        </div>

        {/* Progress Bar Track */}
        <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[var(--color-brand-secondary)] to-[var(--color-brand-primary)] transition-all duration-200 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-[var(--color-text-muted)] font-mono mt-1">
          <span>{(transferred / 1024 / 1024).toFixed(2)} MB</span>
          <span>{(size / 1024 / 1024).toFixed(2)} MB</span>
        </div>

        {/* Verification Status */}
        <div className={`mt-4 flex items-center justify-center gap-2 py-3 rounded-xl font-mono text-sm transition-all duration-500 ${
          store.transfer.verified === true 
            ? 'bg-[var(--color-status-success)]/20 text-[var(--color-status-success)]' 
            : store.transfer.verified === false
            ? 'bg-[var(--color-status-error)]/20 text-[var(--color-status-error)]'
            : 'bg-white/5 text-[var(--color-text-muted)]'
        }`}>
          {store.transfer.verified === true && <LucideShieldCheck size={16} />}
          {store.transfer.stage === 'verifying' 
            ? <><LucideLoader2 className="animate-spin" size={16}/> Computing SHA-256...</> 
            : store.transfer.verified === true ? 'SHA-256 MATCH' 
            : store.transfer.verified === false ? 'HASH MISMATCH' 
            : <span className="text-[var(--color-text-muted)] font-sans text-xs">E2EE Secured</span>}
        </div>
      </div>
    );
  };

  const renderFailed = () => (
    <div className="flex flex-col items-center justify-center py-8 animate-in fade-in zoom-in duration-500">
      <LucideAlertCircle className="text-red-500 mb-4" size={48} />
      <p className="text-red-400 font-bold text-lg mb-2 text-center">Connection Failed</p>
      <p className="text-[var(--color-text-secondary)] text-sm mb-6 text-center max-w-xs">
        {store.connectionStatus === 'failed' ? "The peer-to-peer connection dropped or failed to establish." : "An error occurred."}
      </p>
      <button 
        onClick={() => {
          webrtc.disconnect();
          store.reset();
        }}
        className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-8 rounded-xl transition-colors"
      >
        Retry
      </button>
    </div>
  );

  let currentView = null;

  if (store.connectionStatus === 'failed' || store.connectionStatus === 'disconnected') {
    currentView = renderFailed();
  } else if (store.connectionStatus === 'connecting' || store.connectionStatus === 'joining' || store.connectionStatus === 'creating') {
    currentView = renderConnecting();
  } else if (store.connectionStatus === 'connected') {
    if (store.role === 'initiator') {
      if (store.transfer.stage === 'idle') {
        currentView = (
          <div className="flex flex-col items-center justify-center py-12 animate-in fade-in duration-500">
            {renderSecurityVerification()}
            <LucideLoader2 className="animate-spin text-[var(--color-brand-primary)] mb-4" size={32} />
            <p className="text-[var(--color-text-secondary)] text-center">Waiting for receiver to accept...</p>
          </div>
        );
      } else {
        currentView = renderTransferProgress();
      }
    } else {
      // Receiver
      if (store.transfer.stage === 'idle') {
        currentView = <>{renderSecurityVerification()}{renderAcceptTransfer()}</>;
      } else {
        currentView = renderTransferProgress();
      }
    }
  } else {
    // Idle state UI
    if (store.flowState === 'home') currentView = renderHome();
    else if (store.flowState === 'send-pick') currentView = renderSendPick();
    else if (store.flowState === 'send-wait') currentView = renderSendWait();
    else if (store.flowState === 'receive-input') currentView = renderReceiveInput();
  }

  return (
    <div className="w-screen flex flex-col items-center pointer-events-none">
      
      {/* Page 1: Hero */}
      <section className="w-full h-screen flex flex-col items-center justify-center text-center p-8">
        <h1 className="text-6xl font-bold tracking-tighter mb-4 pointer-events-auto">
          Peer<span className="text-[var(--color-brand-primary)]">/</span>Link
        </h1>
        <p className="text-xl text-[var(--color-text-secondary)] max-w-lg pointer-events-auto">
          Hyper-fast, secure, and limitless peer-to-peer file transfer directly in your browser. No servers in the middle.
        </p>
        <div className="mt-12 text-[var(--color-text-muted)] animate-pulse pointer-events-auto">
          Scroll to begin
        </div>
      </section>

      {/* Page 2: Spacer / Story */}
      <section className="w-full h-screen">
      </section>

      {/* Page 3: App Interface */}
      <section className="w-full h-screen flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-md bg-[var(--color-surface-overlay)] backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl pointer-events-auto transition-all duration-300 relative">
          
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold">Transfer</h2>
            <div className="flex items-center gap-2 text-sm font-mono bg-white/5 px-3 py-1 rounded-full">
              {store.connectionStatus === 'connected' ? (
                <><LucideWifi size={14} className="text-[var(--color-brand-primary)]" /> Connected</>
              ) : store.connectionStatus === 'idle' ? (
                <><LucideWifiOff size={14} className="text-[var(--color-text-muted)]" /> Idle</>
              ) : store.connectionStatus === 'failed' || store.connectionStatus === 'disconnected' ? (
                <><LucideWifiOff size={14} className="text-red-400" /> Failed</>
              ) : (
                <><LucideWifi size={14} className="text-[var(--color-brand-secondary)] animate-pulse" /> {store.connectionStatus}</>
              )}
            </div>
          </div>

          {currentView}

        </div>
      </section>

      {/* Debug Panel Button & Overlay */}
      <div className="fixed bottom-4 right-4 pointer-events-auto z-50 flex flex-col items-end gap-2">
        {showDebug && (
          <div className="bg-black/90 border border-white/20 rounded-xl p-4 w-[90vw] max-w-2xl max-h-[50vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-mono font-bold text-sm text-[var(--color-brand-secondary)]">Debug Logs</h3>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(store.debugLogs.join('\n'));
                }}
                className="flex items-center gap-1 text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded transition-colors"
              >
                <LucideCopy size={12} /> Copy
              </button>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] text-gray-300 flex flex-col gap-1 border border-white/5 bg-black p-2 rounded">
              {store.debugLogs.length === 0 ? (
                <span className="text-gray-600 italic">No logs yet...</span>
              ) : (
                store.debugLogs.map((log, i) => (
                  <div key={i} className="break-all">{log}</div>
                ))
              )}
            </div>
          </div>
        )}
        <button 
          onClick={() => setShowDebug(!showDebug)}
          className={`p-3 rounded-full backdrop-blur transition-colors ${showDebug ? 'bg-[var(--color-brand-secondary)] text-black' : 'bg-white/10 hover:bg-white/20 text-white'}`}
          title="Toggle Debug Panel"
        >
          <LucideTerminal size={20} />
        </button>
      </div>

    </div>
  );
}
