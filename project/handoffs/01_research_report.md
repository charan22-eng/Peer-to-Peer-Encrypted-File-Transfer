# Research Report: Peer/Link (Awwwards-Tier 3D WebRTC Transfer)

## 1. Executive Summary
The market for WebRTC peer-to-peer file transfer is crowded with functional but visually utilitarian tools (e.g., Snapdrop, ShareDrop, FilePizza). While they solve the core problem of secure, serverless file sharing, they lack premium design, emotional resonance, and data verification transparency. **Peer/Link** will disrupt this space not by changing the underlying protocol, but by elevating the experience: wrapping robust WebRTC logic and SHA-256 integrity checks in a stunning, Awwwards-tier 3D WebGL interface.

**Top USPs:**
1. **Premium 3D Data Visualization:** Interactive WebGL data-path rendering (Differentiation).
2. **Guaranteed File Integrity:** Explicit SHA-256 hashing and verification (Differentiation).
3. **Inclusive Performance:** Graceful fallbacks for mobile and reduced-motion users (Differentiation).

## 2. Problem Analysis & Personas
**Personas:**
- **Creative Professionals / Designers:** Need to share large assets quickly, appreciate premium aesthetics.
- **Privacy-Conscious Users:** Want to transfer files without them touching a third-party server.
**Pain Points:** Existing tools look cheap, often fail silently without clear error states, lack proof of integrity, or don't offer a cohesive narrative around data security.

## 3. Market Landscape
Direct competitors are browser-based P2P file-sharing web apps. Indirect competitors include cloud storage (Google Drive, Dropbox) and native ecosystem tools (AirDrop, Nearby Share).

## 4. Competitor Profiles
1. **ToffeeShare** (https://toffeeshare.com/) · Browser P2P · Good functionality, handles large files · Weakness: Generic UI, no visual representation of the secure tunnel.
2. **ShareDrop** (https://www.sharedrop.io/) · Browser P2P (Local Network focus) · Easy AirDrop clone · Weakness: Basic 2D UI, often fails outside local network without clear errors.
3. **Wormhole** (https://wormhole.app/) · E2E encrypted transfer (P2P + Server fallback) · Very fast, nice UI · Weakness: Uses servers for some routing, not purely serverless visually.
4. **FilePizza** (https://file.pizza/) · Browser P2P · Quirky concept · Weakness: Outdated visually, lacks robust error handling.
5. **PairDrop** (https://pairdrop.net/) · Open-Source P2P · Solid functionality, self-hostable · Weakness: Utilitarian design, no "premium" feel.
6. **SendFiles** (https://sendfiles.in/) · Browser P2P · Zero-log simple UI · Weakness: Forgettable design, no integrity guarantees shown.

## 5. Feature Comparison Matrix
| Feature | ToffeeShare | ShareDrop | Wormhole | FilePizza | PairDrop | **Peer/Link (Proposed)** |
|---|---|---|---|---|---|---|
| True P2P (No server storage) | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| 3D Visualized Transfer | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Explicit File Hashing (SHA-256) | ❓ | ❓ | ✅ | ❌ | ❓ | ✅ |
| Robust Error States | ⚠️ | ⚠️ | ✅ | ❌ | ⚠️ | ✅ |
| Premium Awwwards UI | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |

## 6. Competitor Drawbacks
- **Visual Stagnation:** Most tools use standard 2D progress bars or circles.
- **Opaque Errors:** When ICE negotiation fails or connection drops, users are left hanging.
- **Lack of Verification:** Users don't know if the file arrived 100% intact bit-for-bit.

## 7. Opportunity Gaps
Building a tool that not only works but *feels* secure and premium. By visualizing the data channel (DTLS-SRTP) as a secure 3D beam and explicitly hashing files, we build trust through design.

## 8. Recommended USPs
1. **Interactive 3D WebGL Visualization:** Visualizes the connection and transfer in real-time. (DIFFERENTIATOR)
2. **Cryptographic Proof of Delivery:** SHA-256 hash comparison visible to users. (DIFFERENTIATOR)
3. **Explicit Error Boundaries:** Clear states for NAT failures, dropped peers. (TABLE STAKES)
4. **Performance Tiers:** Adapts 3D fidelity to device capability (Mobile/Reduced Motion). (DIFFERENTIATOR)

## 9. Build-vs-Reuse
- **Signaling:** Custom Node.js + `ws` for strict control and zero file tracking.
- **WebRTC:** Native browser APIs (`RTCPeerConnection`, `RTCDataChannel`).
- **3D Engine:** React Three Fiber (`@react-three/fiber`) + GSAP for scroll storytelling.

## 10. Risks and Constraints
- **Performance:** 3D bloom/particles can tank mobile performance. Handled via performance tiers.
- **Memory Limits:** SHA-256 requires the entire file in an `ArrayBuffer`. Capped at 2GB in v1.
- **NAT Traversal:** Strict corporate networks might block standard STUN without TURN fallback.

## 11. Assumptions & Open Questions
- STUN servers (e.g., Google's public STUN) will suffice for most peer connections.
- WebGL2 is widely supported by our target audience.

## 12. Sources
- https://toffeeshare.com/
- https://www.sharedrop.io/
- https://wormhole.app/
- https://file.pizza/
- https://pairdrop.net/
