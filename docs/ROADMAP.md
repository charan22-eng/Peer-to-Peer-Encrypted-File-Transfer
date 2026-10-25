# Peer/Link Evolution Roadmap

This roadmap defines the incremental implementation strategy to evolve Peer/Link from an academic prototype into a production-grade, infinitely scalable P2P platform. 

**Execution Principle:** Implement incrementally. Never break existing features. Prove every change with automated tests.

---

### Phase 1: Regression Safety
Establish a robust automated test baseline covering signaling, WebRTC negotiation, backpressure, hashing, and current limits. Any new architecture must pass this baseline.

### Phase 2: Infinite-Size Streaming
Migrate away from RAM-bound `Blob` accumulation. Implement `FileSystemWritableFileStream` to stream data directly to disk. File size limits will be bounded only by the user's hard drive space.

### Phase 3: Resumable Transfers
Introduce a persistent transfer protocol with `transferId`, tracking verified chunks. Allow dropped connections to renegotiate and resume transfers from the exact byte of failure without data duplication.

### Phase 4: TURN + Network Reliability
Upgrade beyond STUN. Implement configurable TURN (UDP/TCP/TLS) credentials provided securely by the signaling server to guarantee connectivity across strict corporate firewalls and symmetric NATs. Expose connection diagnostics to the user.

### Phase 5: Multi-Peer Swarming
Transition from a 1:1 connection model to a 1:N swarm. Divide files into chunks and implement a chunk availability map so peers can cross-share fragments efficiently (BitTorrent model) without unbounded mesh fan-out.

### Phase 6: End-to-End Payload Encryption (E2EE)
Implement application-layer `AES-GCM` payload encryption utilizing `ECDH` key exchange during signaling. Guarantee that a compromised signaling or TURN server cannot decrypt the file payload.

### Phase 7: Authenticated Signaling
Migrate signaling from anonymous room logic to a JWT/OAuth authenticated architecture with granular authorization (owners, members, read-only) and strict server-side payload validation.

### Phase 8: Folder Transfers
Implement `webkitdirectory` support. Serialize relative paths and reconstruct complex folder hierarchies on the receiving peer while protecting against path traversal attacks.

### Phase 9: Live Media Streaming
Pipe incoming DataChannel video/audio streams into a `MediaSource` buffer, allowing compatible media to dynamically play while downloading in the background.

### Phase 10: Progressive Web App (PWA)
Implement Service Workers, Web Manifests, and the Web Share Target API to allow native OS installation and offline shell capabilities.

### Phase 11: Performance Engineering
Conduct rigorous benchmarking (throughput, CPU, RAM latency) across 10MB to 10GB payloads. Optimize array copies, JSON serializations, and queue allocations.

### Phase 12: Observability
Introduce structured client metrics (bufferedAmount, ICE state, transfer speed, ETAs) and server metrics (disconnect rates, active rooms) to enable robust monitoring without logging sensitive payload bytes.

### Phase 13: UI / UX Evolution
Iteratively upgrade the glassmorphic React Three Fiber UI to elegantly surface new capabilities (encryption status, resume state, swarm peer count) without overwhelming the user.

### Phase 14: Comprehensive Testing
Expand the testing suite across Unit, Integration, E2E (browser-to-browser), and Stress testing to guarantee swarm resilience and large-file integrity under extreme load.

### Phase 15: Security Review
Finalize the threat model. Review dependencies, patch XSS/CSRF vectors, secure TURN credential lifecycle, and conduct a full cryptographic audit on the new E2EE protocol.

### Phase 16: Production Architecture
Finalize CDN/static hosting for the frontend, Node.js + Redis Pub/Sub scaling for horizontal signaling, and Coturn deployment.

### Phase 17: B.Tech Viva Documentation
Compile technically rigorous documentation (`docs/VIVA_GUIDE.md`) defending the architecture, protocols, and engineering choices for final academic presentation.
