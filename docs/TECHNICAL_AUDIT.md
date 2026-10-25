# Technical Audit: Peer/Link

## Current state and bottlenecks

### 1. Storage and file-size behavior

The sender hashes and transmits bounded chunks. The receiver uses OPFS when available and falls back to an in-memory buffer when it is not. OPFS reduces RAM pressure, but browser quota, permission policy, and the fallback path still impose practical limits. A production UI should preflight quota and report disk-write failures before acceptance.

### 2. Failure and resume behavior

The protocol stores partial data in OPFS and exchanges a byte offset for a retry. A durable transfer ID and reconnect state machine are still needed for reliable resume across browser restarts or a changed peer session. Signaling loss can still terminate an active transfer.

### 3. Negotiation safety

ICE candidates are queued until a remote description exists. Room cleanup removes sockets from their current room. Signaling messages and relay payloads are validated at the server boundary, and client message-queue failures now transition to an error state instead of leaving the queue permanently locked.

### 4. Performance

Hashing is incremental in 4 MB slices and yields to the event loop. DataChannel chunks are bounded and use backpressure. Large files should still be benchmarked in a worker, and the 3D scene should be lazy-loaded because the production bundle is above 500 kB.

### 5. Scalability

The signaling server keeps rooms in a process-local `Map`, so horizontal deployment needs sticky sessions or Redis/pub-sub. The two-peer design is intentionally not a swarm. TURN fallback can become the main bandwidth and cost bottleneck and needs separate capacity metrics.

### 6. Security assumptions

File chunks use application-layer AES-GCM derived through ECDH, in addition to WebRTC transport encryption. The peers display a deterministic public-key fingerprint and require an explicit out-of-band verification action before transfer. This detects key substitution when users compare the codes, but does not prevent denial of service.

Signaling uses short-lived JWTs for anonymous browser sessions, exact origin allowlists, cryptographic 10-character room codes, signal validation, and per-action rate limiting. JWTs do not identify a human; OAuth/OIDC or signed invitations are required for identity-bound access control.

### 7. Production requirements

Use HTTPS/WSS behind a trusted TLS reverse proxy, configure `CLIENT_ORIGINS`, `JWT_SECRET`, `TURN_URL`, and `TURN_SECRET` from a secret manager, deploy redundant signaling/TURN instances, add Redis/pub-sub before load balancing, and perform regular dependency and large-file load testing.
