TOTAL_PHASES: 8

# Master Plan: Peer/Link

## Phase 0: Scaffold & Foundation (DevOps/Frontend)
- **Goal:** Initialize Vite + React + TS, Node.js + ws server.
- **Tasks:**
  - Setup `/server` with Node.js, `ws`, Express (for healthcheck).
  - Setup `/client` with Vite, React, TS, Tailwind/CSS.
  - Configure ESLint, Prettier.
- **Dependencies:** None
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Scaffold: Vite+React+TS, ESLint/Prettier, folder structure, basic shell — deploy a "hello world" to confirm the pipeline end to end.

## Phase 1: Signaling Server (Backend)
- **Goal:** Implement peer discovery and relay.
- **Tasks:**
  - Generate 6-char alphanumeric room codes (avoid 0,O,1,I,L).
  - Room state management (max 2 peers, clean up on empty).
  - Relay SDP and ICE candidate signals (exact payload format per `websocket-contract.json`).
  - Implement heartbeat (ping/pong) and IP rate limiting.
- **Dependencies:** Phase 0
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Exactly two peers per room enforced; third join rejected clearly.
  - [ ] Disconnect notifies the remaining peer; empty rooms are cleaned up.
  - [ ] Rate limiting throttles rapid repeated room creation from one IP.
  - [ ] A dead connection (no pong) is reaped within the configured window.
  - [ ] GET /health returns 200.

## Phase 2: WebRTC Transfer Logic & Store (Frontend)
- **Goal:** Real peer connection and file transfer with Zustand store.
- **Tasks:**
  - `RTCPeerConnection` setup with public STUN.
  - Zustand store implementation matching `shared-store.ts` verbatim.
  - DataChannel chunking (16KB) exactly per `webrtc-contract.json`, backpressure handling.
  - SHA-256 hash calculation (SubtleCrypto) pre-send and post-receive.
  - Unstyled HTML/CSS 2D UI for testing transfer logic.
- **Dependencies:** Phase 1
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Two real browser tabs complete a real multi-MB file transfer; SHA-256 verified message displays correctly.
  - [ ] An oversized test file is rejected client-side with a clear message, not attempted.
  - [ ] Simulated ICE failure/timeout produces the documented clear message within ~25s, not an indefinite spinner.
  - [ ] A disconnect mid-transfer (kill the server, or close a tab) produces a clear UI state, not a silent hang.
  - [ ] Server-side logging/network inspection confirms the signaling server only ever sees text signaling messages, never file bytes.
  - [ ] Both the 2D UI and the 3D scene read from the single shared store — confirmed by code reference, not just visual match.

## Phase 3: Base 3D Scene (Frontend)
- **Goal:** Render the baseline 3D visual component.
- **Tasks:**
  - Install `@react-three/fiber`, `three`, `@react-three/postprocessing` (explicit dependency for bloom), `drei`.
  - Build `PeerLink` component: Nodes (icosahedron), Curve (tube), Ambient particles.
  - Lighting: Emissive materials, selective bloom via `@react-three/postprocessing`.
  - Drive via scripted timeline.
- **Dependencies:** Phase 0
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Hero renders the particle globe + two labeled nodes; idle shows no/faint path; parallax is present and bounded (report the actual degree range used).
  - [ ] Data path animates smoothly on connect, same component in both demo and live modes (code reference).
  - [ ] Bloom is applied selectively (report which objects/layers), not globally.

## Phase 4: Scroll Choreography (Frontend)
- **Goal:** Storytelling scroll sequence.
- **Tasks:**
  - Install `lenis` (explicit dependency for smooth scrolling).
  - GSAP + ScrollTrigger integration.
  - 7-beat camera journey mapping (Create, Join, Discover, Connect, Secure, Transfer, Complete).
- **Dependencies:** Phase 3
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Scroll story plays all 7 named beats as one continuous camera move, no jump cuts, reversing smoothly on scroll-up — recorded top to bottom and bottom to top.

## Phase 5: Live Wiring (Frontend)
- **Goal:** Connect 3D Scene to Zustand Store.
- **Tasks:**
  - Map live `bytesTransferred` to the particle stream.
  - Update nodes based on `idle`/`connecting`/`connected` states.
- **Dependencies:** Phase 2, Phase 4
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Live transfer visualization's particle-stream progress is sampled against the real store's byte-progress at 5+ points during a real transfer and stays within a small, stated tolerance at each sample — report the actual sampled numbers.
  - [ ] Received file's 3D object reassembles alongside the real hash-verified confirmation.
  - [ ] Glassmorphism appears only on the two specified surfaces — confirm by listing every element using it.
  - [ ] Reported palette hex values match Part C's tokens; no out-of-system neon/cyberpunk colors introduced.

## Phase 6: Performance & Accessibility (Frontend)
- **Goal:** Mobile fallbacks, reduced motion, a11y.
- **Tasks:**
  - Implement mobile tier (reduced particles, no bloom).
  - Implement `prefers-reduced-motion` tier (static/text fallback).
  - Keyboard navigation and screen reader support.
- **Dependencies:** Phase 5
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Desktop tier hits 60fps sustained during the scroll sequence (measured, not estimated).
  - [ ] Mobile tier is a genuinely reduced build (report which effects are disabled), tested at a real mobile viewport, functional UI fully usable, no overflow/broken touch targets.
  - [ ] Magnetic cursor respects its stated bounds and is disabled on touch devices.
  - [ ] prefers-reduced-motion fallback tested and recorded: no camera-jacking, all 7-beat content present as text.
  - [ ] Full keyboard-only pass through create → join → send → receive, no reliance on the 3D canvas.
  - [ ] Contrast ratios on all text over the 3D background measured and passing WCAG AA.
  - [ ] Initial 3D-bundle payload measured and under the 2.5MB gzipped budget, lazy-loaded separately from the functional UI.

## Phase 7: Testing, CI & Security (QA/DevOps)
- **Goal:** Regression tests, CI pipeline, error states.
- **Tasks:**
  - Vitest for chunker/hasher.
  - Playwright E2E for two-tab transfer.
  - CI workflow on push (lint, test, build).
  - Handle and display named error states explicitly (room full, hash mismatch, ICE timeout).
- **Dependencies:** Phase 2, Phase 6
- **Acceptance Criteria (Minimum Goals):**
  - [ ] Unit tests exist and pass for the chunker/hasher/backpressure edge cases listed in Part E.
  - [ ] The Playwright two-tab e2e test exists and passes locally.
  - [ ] CI workflow runs install/typecheck/lint/test/build on push.
  - [ ] Each named error state in Part F is reachable and was actually triggered and recorded (at minimum: room full, hash mismatch, WebGL unsupported, signaling unreachable).
