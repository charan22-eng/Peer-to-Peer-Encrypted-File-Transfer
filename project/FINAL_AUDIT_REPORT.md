# Peer/Link: Master Technical Audit & Evolution Report

**Date:** 2026-09-27  
**Scope:** Deep-dive analysis of the Peer/Link WebRTC architecture, including historical bug remediation, current state analysis, line-by-line architectural review, and advanced future roadmap.  
**Purpose:** Comprehensive documentation for academic viva presentation, open-source community guidelines, and commercial scaling foundation.

---

## 1. Executive Summary

Peer/Link is a high-performance, purely peer-to-peer file transfer web application. Built entirely without a middleman server intercepting file bytes, it relies on WebRTC `RTCDataChannel` for transport, Web Crypto API for cryptographic verification, and a Node.js WebSocket signaling server for peer discovery. 

This report documents the architectural evolution of the project. It highlights the rigorous engineering problem-solving applied to overcome critical WebRTC race conditions and memory leaks, provides a line-by-line architectural analysis of the current robust state, and outlines an advanced roadmap to elevate the project to an "outstanding" commercial and academic tier.

---

## 2. Architectural Evolution & Rigorous Bug Remediation

During the development lifecycle, several critical bugs and architectural gaps were identified and systematically resolved. Documenting these showcases the engineering depth required to stabilize a raw WebRTC implementation.

### 2.1 WebRTC ICE Candidate Race Condition (Resolved)
- **The Bug:** In early versions, incoming ICE candidates from the signaling server were immediately passed to `addIceCandidate()`. Because network latency is unpredictable, candidates often arrived *before* `setRemoteDescription()` completed, causing fatal WebRTC connection errors and discarded candidates.
- **The Fix:** Implemented a robust queueing mechanism in `webrtc.ts`. Candidates received prior to a remote description are pushed to an `iceCandidateQueue`. Once the SDP offer/answer is processed, the queue is flushed and candidates are safely applied.

### 2.2 False SHA-256 Sender Verification (Resolved)
- **The Bug:** Cryptographic proof-of-delivery is a core project claim. However, the sender was prematurely marking the transfer as `verified: true` immediately after dispatching the final chunk (`file-done`), without waiting for the receiver to actually compute the hash.
- **The Fix:** Instituted a two-way handshake over the DataChannel. The receiver computes the SHA-256 hash locally, compares it against the expected metadata, and transmits a `file-result` packet (`{ type: 'file-result', verified: boolean }`) back to the sender. The sender UI now explicitly hangs on "Computing SHA-256..." until this network acknowledgment is received.

### 2.3 Server-Side Memory & Socket Leaks (Resolved)
- **The Bug:** Sockets could create or join new rooms without being purged from their previous rooms in `server/index.js`, leading to ghost sockets, orphaned rooms, and compounding memory leaks.
- **The Fix:** Implemented a strict `leaveCurrentRoom()` routine enforced on socket close, room creation, and room joining. This ensures O(1) state correctness and prevents stale peer routing.

### 2.4 Backpressure & Memory Exhaustion (Resolved)
- **The Bug:** Pumping a multi-gigabyte file into `RTCDataChannel` synchronously causes fatal memory exhaustion and buffer overflows. 
- **The Fix:** Configured `bufferedAmountLowThreshold` (64KB limit). The sending loop now `awaits` a custom Promise tied to the `bufferedamountlow` event, properly throttling the file read speed to match the real-world network outbound speed.

---

## 3. Deep Dive: Line-by-Line Architectural Analysis

### 3.1 Signaling Server (`server/index.js`)
- **Transport:** Standard `ws` package over Node.js `http`.
- **State Management:** `rooms = new Map()` holding `Set<WebSocket>`. This in-memory structure is O(1) for lookups but limits horizontal scaling (a single Node process).
- **Security & Abuse Control:** 
  - Independent rate limits cover token issuance, room creation, room joining, and signaling/relay messages.
  - Generates cryptographic, unambiguous 10-character room codes.
- **Liveness:** Implements a strict 10-second heartbeat ping/pong interval. Dead connections are forcefully terminated, freeing up room slots immediately.

### 3.2 WebRTC Client Manager (`client/src/lib/webrtc.ts`)
- **Class-based State:** Encapsulated `WebRTCManager` interacting with a global `zustand` store (`useStore`) for decoupled UI reactivity.
- **ICE Configuration:** Fetches configured STUN/TURN credentials from the signaling service, with public fallback only for local development.
- **DataChannel Chunking:** Files are sliced into `16384` byte chunks (`CHUNK_SIZE`). This is the optimal MTU-friendly size for WebRTC SCTP packets across varying networks.
- **Strict Validations:** Prevents concurrent transfers, verifies public-key fingerprints before transfer approval, and uses OPFS when supported.

### 3.3 Visuals & UI (`client/src/components`)
- **Glassmorphic Tailwind:** The interface strictly utilizes CSS variables (`--color-surface-overlay`, `--color-brand-primary`) to maintain a cohesive amber/ink premium palette.
- **React Three Fiber (R3F):** 
  - Employs a `FibonacciSphere` algorithm to distribute 3,000 particle nodes evenly.
  - Utilizes `QuadraticBezierCurve3` to draw a dynamic, arcing connection beam between peers.
  - Uses `EffectComposer` with precise `luminanceThreshold` and `toneMapped={false}` flags to apply selective bloom *only* to the active transfer nodes, leaving the UI and background crisp.
- **GSAP Animations:** A robust ScrollTrigger architecture manages the transition from hero banner to the 3D application state.

---

## 4. Current Real-Time Gaps (V1 Limitations)

While structurally sound, the V1 architecture has acceptable real-time gaps that must be acknowledged in an academic or production context:

1. **Browser Storage Limits:** OPFS reduces receiver RAM usage, but browser quotas and the in-memory fallback still impose practical limits.
2. **Production TURN Dependency:** Production requires configured TURN credentials for strict NATs and enterprise firewalls; public fallback credentials are development-only.
3. **In-Memory Signaling:** The Node.js WebSocket server relies on a local `Map`. If deployed across multiple servers/containers (e.g., Kubernetes), peers connected to different instances cannot share rooms without a Redis Pub/Sub backplane.
4. **Resumability:** OPFS partial files and byte offsets support retrying a transfer, but a durable transfer ID is still needed for robust resume across browser restarts.

---

## 5. Architectural Upgrades (V2 Features Implemented)

The following advanced features were successfully integrated into the architecture to elevate Peer/Link into an "outstanding" commercial and academic tier:

### 5.1 Advanced P2P & Architecture
- **OPFS File Streaming:** Uses `FileSystemWritableFileStream` through the Origin Private File System when available, reducing memory usage without claiming unlimited size.
- **Folder Transfers:** Utilizes the HTML5 `webkitdirectory` API combined with an on-the-fly zip streaming protocol (`fflate`) to perfectly reconstruct complex folder structures on the receiver's end while defending against path traversal attacks.

### 5.2 Enterprise Security & Authentication
- **End-to-End Payload Encryption (E2EE):** Uses ephemeral ECDH (P-256) and AES-GCM for file chunks. A displayed public-key fingerprint must be compared out-of-band before approval; JWTs authenticate anonymous browser sessions, not human identities.
- **Signaling Hardening:** Uses short-lived JWTs, an explicit CORS origin allowlist, production secret checks, payload validation, and independent IP-based rate limits.

### 5.3 Media & Premium UX Enhancements
- **Live Media Streaming:** Extended the connection to support raw WebRTC MediaStreams. Users can instantly share their webcam or screen (`getUserMedia` / `getDisplayMedia`) alongside the data channel, with responsive `<video>` elements integrated directly into the glassmorphic UI.
- **PWA Integration:** Added a Web App Manifest and Service Worker via `vite-plugin-pwa`, enabling offline capability and allowing users to install Peer/Link as a native-like application.

---

## 6. Conclusion

Peer/Link demonstrates modern WebRTC, ICE, TURN, Web Crypto, and browser storage techniques. The current implementation is suitable as a hardened academic prototype. Before production use, it still needs TLS termination, identity-bound authorization, Redis-backed signaling for horizontal scale, redundant TURN capacity, storage-quota handling, durable transfer IDs, and load testing.
