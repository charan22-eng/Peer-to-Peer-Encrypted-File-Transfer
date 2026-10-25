# Peer/Link Architecture

## Core System Overview
Peer/Link is a decentralized, peer-to-peer file transfer platform leveraging WebRTC for direct data transit and WebSockets for initial signaling. 

The architecture intentionally decouples **Signaling** (discovering and negotiating peer connections) from **Data Transport** (secure, direct byte streams). The signaling server never receives or inspects file payloads.

### Technical Stack
- **Frontend Core:** React, TypeScript, Vite
- **State Management:** Zustand
- **Graphics/UI:** Tailwind CSS, React Three Fiber (R3F), GSAP for animations
- **Transport Layer:** WebRTC `RTCDataChannel`
- **Signaling Layer:** Node.js, `ws` module
- **Cryptography:** Web Crypto API (`window.crypto.subtle`)

---

## Data Flow

### 1. Signaling Flow (WebSockets)
1. **Initiator** creates a room on the Node.js signaling server (`create-room`). Server responds with a cryptographically generated 10-character code.
2. **Joiner** requests to join via the code (`join-room`).
3. Server verifies room capacity (max 2 peers) and notifies the Initiator (`peer-joined`).
4. **Offer/Answer Exchange (SDP):** Initiator creates an SDP Offer, sends it via `signal` to the server. Server relays to Joiner. Joiner generates an SDP Answer, relays it back.
5. **ICE Candidate Exchange:** Simultaneously, both peers query configured STUN/TURN servers to discover viable public IP/port mappings. These ICE candidates are streamed via the signaling server to each other.

### 2. WebRTC Lifecycle (Peer-to-Peer)
- Once ICE candidates are exchanged and connection paths are verified, the `RTCPeerConnection` state transitions to `connected`.
- An `RTCDataChannel` (named `fileTransfer`) is established. It is configured as `ordered: true` and `binaryType: 'arraybuffer'`.

### 3. Transfer Lifecycle (DataChannel)
1. **Metadata Handshake:** Sender transmits a `file-meta` JSON string containing filename, size, mime-type, and pre-computed SHA-256 hash.
2. **Chunking & Streaming:** Sender slices the file into 16 KB chunks (`16384` bytes) and transmits them iteratively over the DataChannel.
3. **Backpressure Control:** If the `bufferedAmount` exceeds `65536` bytes (64 KB), the sender loop pauses. It resumes only when the `bufferedamountlow` event fires, preventing the browser's outbound network buffer from overflowing.
4. **Completion Handshake:** Sender transmits a `file-done` JSON string.
5. **Verification Handshake:** Receiver computes the SHA-256 hash of the reconstructed file. Receiver replies with a `file-result` JSON string containing `{ verified: true/false }`. Sender displays success only upon receiving this acknowledgment.

---

## Design Principles
- **Regression Safety:** Key fixes (ICE candidate queueing prior to `remoteDescription`, backpressure loops, and 2-way verification) must not be disturbed by future refactors.
- **Client-Side Heavy:** The Node.js server is intentionally lightweight, but room state is process-local. Horizontal scaling requires sticky sessions or a Redis/pub-sub backplane.
- **Trust Boundary:** File payloads use an application-layer ECDH/AES-GCM channel. The peers display a short authentication fingerprint; users must compare it out-of-band before approving a transfer because the anonymous signaling service cannot authenticate public keys by itself.
