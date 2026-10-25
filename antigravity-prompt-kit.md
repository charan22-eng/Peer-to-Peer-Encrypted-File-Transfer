# Prompt Kit — peer/link: Awwwards-Tier 3D WebRTC File Transfer Site
### For Google Antigravity (Gemini 3 Pro / Claude Sonnet 4.5 agent)

---

## Three ways to run this — pick one

| Version | Use when | Assumes existing code? |
|---|---|---|
| **v3 — Zero-to-Full** (below, recommended default) | You're pointing Antigravity at an empty repo and want everything — signaling server, WebRTC logic, and the full 3D experience — built from nothing in one autonomous run | No |
| v2 — Reuse & Layer On | You already have the working server/client from earlier and want the 3D experience layered on top, with the existing logic explicitly preserved | Yes |
| v1 — Staged Iterations | Same as v2, but split into 4 smaller, individually-reviewed prompts instead of one long run | Yes |

Only run one of these per workspace — v3 builds the backend and
transfer logic itself, so don't also feed it the earlier project as
"existing code to preserve," or you'll be giving it two conflicting
sources of truth.

---

## Master Prompt v3 — Zero-to-Full Greenfield Build (Deep-Spec Edition)

Paste this into a **brand-new, empty** Antigravity workspace. It
specifies the entire system — nothing to attach, nothing to port.
This edition goes a level deeper than a typical brief on purpose:
exact color/type/spacing tokens, exact message and state shapes,
exact geometry/material/camera numbers for the 3D scene, a named
error-state list, a test/CI layer, and a phased build order. The goal
is to leave as little open to improvisation as possible, so a long
autonomous run stays on rails instead of drifting — while still
leaving *creative execution* (exact copy, exact curve shapes, minor
easing choices) to the agent's own judgment where precision wouldn't
add anything.

```
ROLE
You are acting as a senior full-stack and WebGL engineer, capable of
shipping both correct real-time networking code and 3D web experiences
at the quality bar of awwwards.com/websites/3d. Build the complete
system below from an empty repository — there is no existing code to
read or preserve. Use the awwwards showcase only as a register/quality
reference; do not copy any specific site's exact composition, assets,
or code.

WHAT YOU ARE BUILDING, END TO END
A complete, production-grade, deployable WebRTC peer-to-peer file
transfer web application: a signaling server, the real WebRTC transfer
logic, a premium 3D interface wrapped around it, a design system tying
both together, a test/CI layer, and documented security and error
handling. Build all of it to a standard you'd be comfortable actually
shipping and demoing live. Work through the Recommended Build Phases
near the end of this brief in order — each phase has a reason for its
position, mainly: prove the boring, invisible part (real networking
correctness) before layering the impressive, visible part (3D) on top
of it.

============================================================
PART A — SIGNALING SERVER (Node.js + ws), build from scratch
============================================================
Its only job is peer discovery and handshake relay. It must never see,
log, or store actual file bytes.

Message contract (relayed as JSON text frames over the WebSocket) —
implement exactly this shape so client and server agree without
guessing:

  Client -> Server
    { type: "create-room" }
    { type: "join-room", roomCode: string }
    { type: "signal", payload: SignalPayload }

  Server -> Client
    { type: "room-created", roomCode: string }
    { type: "room-joined", roomCode: string }
    { type: "peer-joined" }
    { type: "signal", payload: SignalPayload }
    { type: "peer-left" }
    { type: "error", message: string }

  SignalPayload is opaque to the server — forward it, don't interpret
  it — and is one of:
    { sdp: RTCSessionDescriptionInit }
    { candidate: RTCIceCandidateInit }

Requirements:
- Room codes: 6 characters, uppercase alphanumeric, excluding visually
  ambiguous characters (0/O, 1/I/L) — a 32-character alphabet, so state
  the resulting code space (32^6, roughly 1.07 billion) in a code
  comment as a sanity check on collision risk. Retry generation on
  collision against currently-active rooms.
- Exactly two clients per room; a third join attempt on a full room
  gets a clear `error` message, not a silent drop.
- On disconnect, notify the remaining peer (`peer-left`) and delete
  the room once it's empty, so codes don't leak memory over time.
- Heartbeat: use ws's ping/pong to detect dead connections that closed
  without a clean TCP close (e.g. a laptop put to sleep). Ping every
  ~30s; terminate and clean up any socket that hasn't ponged within a
  defined window (~10s grace).
- Basic abuse resistance: rate-limit `create-room` per IP (a simple
  in-memory token bucket is enough — e.g. 10 room creations per minute
  per IP, configurable via env var) so the server can't be trivially
  spammed into exhausting memory with abandoned rooms.
- A plain HTTP `GET /health` endpoint returning 200 alongside the WS
  server, for host health checks and uptime monitoring.
- Structured logs for room lifecycle events (created/joined/closed,
  with room code and timestamp) — never log SDP/ICE payload contents
  beyond what's needed to debug a connection issue, and obviously
  never anything resembling file data, since none ever reaches this
  process.
- Config via environment variables with sane defaults: PORT,
  RATE_LIMIT_PER_MINUTE, HEARTBEAT_INTERVAL_MS.
- Ship a package.json with a start script; deployable as a standalone
  process to any host supporting persistent WebSocket connections
  (Render, Railway, Fly.io — pick one and document the exact steps).

============================================================
PART B — WEBRTC TRANSFER LOGIC (client), build from scratch
============================================================
Data-channel message contract — small JSON control messages plus raw
binary chunks, in this order for every transfer:

  1. One JSON message:
     { type: "file-meta", name: string, size: number, mime: string,
       hash: string }
  2. size/CHUNK_SIZE binary ArrayBuffer messages, each up to 16384
     bytes, in order (see ordering note below).
  3. One JSON message:
     { type: "file-done" }

Requirements:
- RTCPeerConnection using public STUN servers for NAT traversal.
  Whichever peer created the room is the initiator and creates the SDP
  offer once the second peer joins (on receiving `peer-joined`); the
  joining peer answers on receiving the offer via `signal`.
- One RTCDataChannel, created with `{ ordered: true }`. This ordering
  guarantee is load-bearing: chunks are appended in arrival order with
  no sequence numbers, so do not change this to an unordered channel
  without also adding explicit sequence numbers to re-order on
  receipt.
- Sending: read the file via the File API, compute a SHA-256 hash of
  its full contents up front (via the Web Crypto `subtle.digest` API),
  send the `file-meta` message, then stream fixed 16KB chunks as
  binary messages, respecting backpressure — do not let
  `dataChannel.bufferedAmount` exceed a defined threshold (1MB is a
  reasonable default); await the channel's `bufferedamountlow` event
  before continuing when it's exceeded. Send `file-done` once all
  chunks are sent.
- Hashing strategy and its explicit tradeoff: `crypto.subtle.digest`
  has no incremental/streaming API, so hashing the full file requires
  holding it in memory as one ArrayBuffer. For v1, accept this and set
  a documented maximum file size guardrail (default 2GB, configurable)
  — reject larger files client-side with a clear message rather than
  attempting the transfer and risking an out-of-memory crash. Note
  incremental/streaming hashing (via a userland streaming SHA-256
  implementation) as a stated future enhancement if the size cap ever
  needs to be lifted — do not silently implement a partial or
  unverified streaming approach now.
- Receiving: buffer incoming binary chunks in arrival order, reassemble
  into a Blob on `file-done`, compute its SHA-256 hash, compare to the
  sender's declared hash, and show a clear verified/mismatch state
  before the file downloads.
- ICE/connection timeout: if the connection hasn't reached `connected`
  within ~25 seconds of the handshake starting, transition the UI to a
  clear "couldn't establish a direct connection" state (mention that
  no TURN relay is configured, since that's the documented cause on
  strict networks) instead of hanging on a spinner indefinitely.
- No automatic reconnection: on ICE state `disconnected`/`failed`/
  `closed`, or the data channel closing unexpectedly, show a clear
  disconnected state and require starting a new room. Don't attempt
  silent retries that could leave the user unsure whether a transfer
  actually completed.
- State these v1 scope limits clearly in the UI/README rather than
  quietly working around them: no TURN relay fallback, no resumable
  transfer after a drop, one peer pair per room, no authentication on
  room codes.

============================================================
PART C — DESIGN SYSTEM & DATA CONTRACTS
============================================================
Shared source of truth for both the 2D UI and the 3D scene — build
this once, have both layers read from it.

Color tokens (exact hex; the amber is the single accent and doubles as
the "signal"/link color in 3D):
  --bg: #0F131A         --surface: #161C26      --surface-2: #1D2531
  --border: #2A3341      --text: #E8EBEF         --text-dim: #8B95A5
  --accent: #FFB454       --accent-dim: #6B5330
  --ok: #5FD98A            --warn: #E8685D

Type: Inter (400/500/600) for UI text; IBM Plex Mono (400/500/600) for
data readouts (room codes, byte counts, hashes) and any in-scene HUD
text. Rough scale: hero headline 56–72px desktop / 32–40px mobile,
body 16–18px, mono data 14–16px, line-height 1.4–1.6 for body copy.

Spacing: 4px base unit; steps of 4/8/12/16/24/32/48/64/96.
Radii: 8px small controls, 10–12px panels.
Breakpoints: mobile <480px, tablet 480–1024px, desktop >1024px — align
these with the performance tiers in Part D.

Shared app state (one Zustand store; both the 2D UI and the 3D scene
read from this single instance — do not let the 3D layer keep its own
parallel copy of connection/transfer state):

  connectionStatus: one of
    "idle" | "creating" | "waiting" | "joining" | "connecting" |
    "connected" | "disconnected" | "failed"
  roomCode: string | null
  role: "initiator" | "joiner" | null
  transfer:
    direction: "send" | "receive" | null
    fileName: string | null
    fileSize: number | null
    bytesTransferred: number
    verified: boolean | null
    stage: "idle" | "hashing" | "transferring" | "verifying" |
           "complete" | "error"

============================================================
PART D — THE 3D / UX EXPERIENCE
============================================================
TECH STACK: React + TypeScript + Vite, three.js via
@react-three/fiber, GSAP (+ScrollTrigger) for the scroll/camera
timeline. Bring in supporting libraries where they clearly help (drei,
postprocessing, Lenis) — substitute equivalents if better-supported,
as long as the quality bar and behavior below are met. Lazy-load heavy
3D assets separately from the functional transfer UI. The functional
UI must remain usable even if the 3D layer fails to load or WebGL2 is
unavailable (feature-detect and fall back gracefully, per Part F).

ARCHITECTURE: build ONE reusable "peer link" visual component (nodes +
connecting beam/data path), parameterized by a state source: a
scripted/looping demo timeline feeds it in the Hero and Scroll Story
(there's no real connection yet at that point in the page); the shared
store from Part C feeds it once the user reaches the real app section
and actually connects/transfers. Same component, same visual language,
two inputs — do not build a separate "fake" version and a separate
"real" version.

VISUAL DIRECTION: minimal, futuristic networking aesthetic; premium
dark interface; glassmorphism used sparingly, only on two surfaces —
the room-code card and the active transfer panel; realistic depth via
soft volumetric lighting and subtle fog, not flat gradients; subtle
particles, not particle storms; clean, restrained typography with
strong contrast; smooth micro-interactions on functional elements
only; explicitly avoid saturated neon or cyberpunk styling — the light
should read as premium hardware/instrumentation, not a rave.

Scene technical baseline (treat as sensible defaults — adjust only
where you have a clearly better reason, and say what you changed):
- Camera: perspective, ~45–50° FOV, near 0.1 / far 100, resting
  position roughly (0, 0, 8) looking at the origin.
- Nodes: low-poly rounded geometry (e.g. an icosahedron, radius
  ~0.35), emissive material tied to accent color, moderate roughness/
  metalness — idle uses a dim, desaturated tone near --border, active/
  connected shifts to full --accent emissive intensity, an error state
  uses --warn.
- Beam/data path: a tube along a gently arced 3D curve between the two
  nodes (not a straight line) — small radius (~0.02–0.04), modest
  radial segment count; material mix shifts from a plain glow to a
  braided/encoded pattern for the "Secure Data Channel" beat.
- Ambient particle field: a point cloud distributed roughly evenly
  across a sphere volume (e.g. a Fibonacci-sphere distribution to
  avoid visible clumping) — roughly 2,000–4,000 points on desktop,
  small point size, additive blending, low opacity, so it reads as
  atmosphere, not clutter.
- Lighting approach: prefer emissive materials + a selective bloom
  pass over a full PBR lighting rig — it's both cheaper and a better
  stylistic match for a "glowing instrument in a dark void" look than
  a lit-product-render look.
- Postprocessing: a bloom pass applied selectively to the glowing
  nodes/beam (via layers or a selective-bloom technique), not the
  whole scene indiscriminately — moderate threshold and intensity, a
  small radius; an optional subtle vignette; skip chromatic
  aberration/film grain unless you have a specific reason it earns its
  place — default off.
- Fog: exponential fog whose color exactly matches the background, so
  the particle field fades into the void rather than into a visible
  gray wall.

PATTERN 1 — INTERACTIVE 3D PEER NETWORK HERO
The globe/particle volume above, with two primary nodes clearly
distinguished from the ambient field by size and glow: one labeled
"This device," one labeled "Peer" (illustrated as Laptop/Phone forms
in the demo timeline). Idle: faint or no path. Connected (real or
demo): the beam animates in smoothly. Mouse-follow parallax: a damped
rotation/offset of the camera or node group based on pointer position,
clamped to roughly ±3° (0.05 rad) at most, lerped with a damping
factor around 0.05–0.08 per frame — smooth and bounded, never
disorienting. If in doubt, dial it back further; this is the one place
"elegant, not flashy" matters most.

PATTERN 2 — SCROLL-DRIVEN 3D STORYTELLING
One continuous 3D journey, not a stack of separately animated
sections. A single GSAP timeline, scrubbed by one ScrollTrigger across
the full scroll container (scrub value ~0.5–1 for a slight smoothing
lag), moves the camera along a continuous spline (e.g.
CatmullRomCurve3 with control points you design, roughly one per
beat), with the look-at target interpolated smoothly across beat
boundaries rather than snapping. Use eases like power2.inOut or
expo.inOut for camera moves — nothing bouncy/elastic; that register is
wrong for this brief. No jump cuts; scrolling back up reverses
smoothly. Seven beats, each with its own camera position/angle, object
rotation, scale, and depth change, each built as its own sub-timeline
inserted into the master timeline at a normalized position so
unrelated objects don't linger between beats:
1. Create Room — a node materializes from the particle field; a
   room-code token forms near it.
2. Join Room — a second node approaches from a distance.
3. Peer Discovery — several thin candidate paths appear and are tested
   between the nodes (visualizing ICE/STUN candidate gathering).
4. WebRTC Connection — the candidates converge into one matched path.
5. Secure Data Channel — the path's material shifts to the braided/
   encoded pattern (DTLS-SRTP).
6. File Transfer — the path becomes the curved tunnel from Pattern 3,
   shown here as an illustrative demo pass.
7. Transfer Complete — the object reassembles at the destination node
   and settles; a confirmation state plays.
Include a minimal on-screen wayfinding cue (a slim progress rail or
current-beat label) so users have a sense of place — consistent with
"clean typography, strong contrast," not a decorative addition.

PATTERN 3 — 3D FILE TRANSFER VISUALIZATION (LIVE)
What actually happens once a user selects a file to send for real. The
file becomes a polished 3D glowing card/icon (reflect file type where
reasonable). It travels the same curved beam geometry as the hero/
story's data path, from "This device" to "Peer," through a particle
stream. The stream's progress must be driven by the real
`bytesTransferred`/`fileSize` values from Part C's shared store — not
an independent tweened animation (this is the single most important
"don't fake it" requirement in this whole brief; the verification loop
below checks it directly). On completion, the receiving object
assembles back into the file representation alongside the real
hash-verified confirmation from Part B. Add subtle hover tilt on the
file card/drop zone; a gentle magnetic-cursor pull near interactive
targets (attraction radius ~60–80px, max displacement ~6–10px, spring
back on leave) disabled entirely on touch devices; soft motion blur/
depth on the particle trail — all subtle. For the moment a 2D file
selection becomes a 3D object: prefer a true DOM-to-3D transform if
it fits the performance budget, but a well-timed cross-fade with
matched scale/position easing is an acceptable fallback — don't let
this specific transition consume disproportionate build time at the
expense of the checklist below.

PERFORMANCE TIERS (build all three; mobile is not an afterthought)
- Desktop/high-end: full effect set as described above.
- Mobile/low-end (auto-detected: no WebGL2, low core count, or a
  measured low frame rate on a short warm-up test): particle count
  reduced to roughly 500–800, no postprocessing bloom pass, simplified
  beam material, parallax and magnetic-cursor effects disabled.
- prefers-reduced-motion: no scroll-jacked camera movement at all —
  normal document scroll, the 7 beats shown as static or lightly
  animated imagery with the same content conveyed in text, no
  mouse-parallax, no magnetic cursor.
Target budget: <2.5MB gzipped initial payload for the 3D bundle
(lazy-loaded separately from the functional UI), 60fps sustained
during the scroll sequence on a mid-tier laptop GPU.

ACCESSIBILITY: full keyboard operability for create/join/transfer,
independent of the 3D scene. Equivalent content in semantic HTML for
screen readers — no information exists only inside the canvas. Visible
focus states, verified WCAG AA contrast ratios. wss:// only in
production signaling config.

============================================================
PART E — TESTING, CI & DEPLOYMENT
============================================================
- Unit tests (Vitest) for the webrtc lib in isolation (no React, no
  three.js dependency in these modules — enforce that boundary):
  chunker produces correct chunk count/sizes for a 0-byte file, a
  file exactly one chunk size, a file exactly N chunk sizes, and a
  file with a partial remainder chunk; hashing matches a known test
  vector; backpressure logic actually awaits `bufferedamountlow` once
  the threshold is crossed (mock the data channel for this).
- One Playwright end-to-end test: two browser contexts on localhost,
  running the full create-room → join-room → send a generated test
  file → assert the received file's hash matches the sent file's
  hash. This automates the same check you'll do manually during
  verification, as a repeatable regression test, not a one-off.
- A CI workflow (GitHub Actions is fine) that on push: installs,
  type-checks, lints, runs the unit tests, and builds. Don't wire up
  account-specific deploy secrets — just get the build/test pipeline
  green.
- Document required env vars: `VITE_SIGNALING_URL` (client, build
  time) and `PORT` / rate-limit / heartbeat vars (server, runtime),
  each with a `.env.example`.
- Deployment: server to a host supporting persistent WebSocket
  connections (Render/Railway/Fly.io — pick one, document exact
  steps); client as a static build (Vercel/Netlify/GitHub Pages).

============================================================
PART F — SECURITY, EDGE CASES & ERROR STATES
============================================================
- Validate and length-cap the room-code input on both client and
  server; never trust client input server-side.
- Feature-detect RTCPeerConnection and WebGL2 support; if either is
  missing, show a clear, accessible message instead of a blank or
  broken page.
- Document a recommended CSP for the deployed client.
- Design an explicit, reachable UI state for each of: room not found,
  room already full, ICE connection failed/timed out, peer
  disconnected mid-transfer, hash mismatch on receive, WebGL
  unsupported, signaling server unreachable. None of these should be
  an unhandled console error or a silent hang.

============================================================
RECOMMENDED BUILD PHASES
============================================================
Work in this order. Each phase exists to de-risk the next one — most
importantly, prove the real transfer works before any 3D complexity
sits on top of it, so a visual bug can never mask a networking bug.
0. Scaffold: Vite+React+TS, ESLint/Prettier, folder structure, basic
   shell — deploy a "hello world" to confirm the pipeline end to end.
1. Part A alone, with its own quick manual test (a script or wscat),
   before touching the browser client.
2. Part B + Part C's store + a plain, unstyled 2D UI. Verify a real
   two-tab file transfer works correctly. Do not start Part D until
   this is solid.
3. Base 3D scene from Part D: the peer-link component (nodes + beam +
   ambient particles + selective bloom) rendering standalone, driven
   only by the scripted demo timeline, at target frame rate.
4. Scroll choreography: the 7-beat GSAP/ScrollTrigger camera journey
   using the Phase 3 scene.
5. Live wiring: connect Pattern 3 and the post-story Pattern 1 hero to
   the real Part C store.
6. Performance tiers, reduced-motion fallback, accessibility pass.
7. Part E and Part F: tests, CI, security, named error states.
8. Full verification loop against the Minimum Goals checklist below —
   iterate until every item is green.

============================================================
MINIMUM GOALS — DEFINITION OF DONE
============================================================
Treat every line as a pass/fail check. Produce independent evidence (a
recording, a screenshot, or a measured number) for each one.

Server (Part A)
 [ ] Exactly two peers per room enforced; third join rejected clearly.
 [ ] Disconnect notifies the remaining peer; empty rooms are cleaned up.
 [ ] Rate limiting throttles rapid repeated room creation from one IP.
 [ ] A dead connection (no pong) is reaped within the configured window.
 [ ] GET /health returns 200.

Transfer logic (Part B)
 [ ] Two real browser tabs complete a real multi-MB file transfer;
     SHA-256 verified message displays correctly.
 [ ] An oversized test file is rejected client-side with a clear
     message, not attempted.
 [ ] Simulated ICE failure/timeout produces the documented clear
     message within ~25s, not an indefinite spinner.
 [ ] A disconnect mid-transfer (kill the server, or close a tab)
     produces a clear UI state, not a silent hang.
 [ ] Server-side logging/network inspection confirms the signaling
     server only ever sees text signaling messages, never file bytes.

Design system & state (Part C)
 [ ] Both the 2D UI and the 3D scene read from the single shared
     store — confirmed by code reference, not just visual match.

3D / UX (Part D)
 [ ] Hero renders the particle globe + two labeled nodes; idle shows
     no/faint path; parallax is present and bounded (report the
     actual degree range used).
 [ ] Data path animates smoothly on connect, same component in both
     demo and live modes (code reference).
 [ ] Scroll story plays all 7 named beats as one continuous camera
     move, no jump cuts, reversing smoothly on scroll-up — recorded
     top to bottom and bottom to top.
 [ ] Live transfer visualization's particle-stream progress is
     sampled against the real store's byte-progress at 5+ points
     during a real transfer and stays within a small, stated
     tolerance at each sample — report the actual sampled numbers.
 [ ] Received file's 3D object reassembles alongside the real
     hash-verified confirmation.
 [ ] Glassmorphism appears only on the two specified surfaces —
     confirm by listing every element using it.
 [ ] Reported palette hex values match Part C's tokens; no
     out-of-system neon/cyberpunk colors introduced.
 [ ] Bloom is applied selectively (report which objects/layers), not
     globally.
 [ ] Desktop tier hits 60fps sustained during the scroll sequence
     (measured, not estimated).
 [ ] Mobile tier is a genuinely reduced build (report which effects
     are disabled), tested at a real mobile viewport, functional UI
     fully usable, no overflow/broken touch targets.
 [ ] Magnetic cursor respects its stated bounds and is disabled on
     touch devices.
 [ ] prefers-reduced-motion fallback tested and recorded: no
     camera-jacking, all 7-beat content present as text.
 [ ] Full keyboard-only pass through create → join → send → receive,
     no reliance on the 3D canvas.
 [ ] Contrast ratios on all text over the 3D background measured and
     passing WCAG AA.
 [ ] Initial 3D-bundle payload measured and under the 2.5MB gzipped
     budget, lazy-loaded separately from the functional UI.

Testing, CI & security (Parts E, F)
 [ ] Unit tests exist and pass for the chunker/hasher/backpressure
     edge cases listed in Part E.
 [ ] The Playwright two-tab e2e test exists and passes locally.
 [ ] CI workflow runs install/typecheck/lint/test/build on push.
 [ ] Each named error state in Part F is reachable and was actually
     triggered and recorded (at minimum: room full, hash mismatch,
     WebGL unsupported, signaling unreachable).

============================================================
AUTONOMOUS LOOP — HOW YOU WORK THROUGH THIS
============================================================
Before writing code, produce your implementation plan as an artifact:
restate Parts A–F and the Build Phases above in your own words,
propose your file/folder structure, and flag any item you think
conflicts with another (e.g. a performance target vs. an effect)
before you proceed. Work phase by phase, in order — don't start a
phase's checklist items until the previous phase's are green. Use your
editor, terminal, and browser together to test against the checklist.
For any item that fails: fix it, then re-test that specific item —
don't move on with a known failure. Keep looping build → test → fix
autonomously until every item passes with real evidence attached. Do
not consider this finished, and do not tell me it's done, until the
full checklist is green with evidence per line.

The one thing you must never do to close out a failing item: relax the
check, fake the measurement, or hardcode a result so it appears to
pass. If something is genuinely not achievable within these
constraints (say, the 60fps target and the full desktop particle count
conflict on a specific tested GPU tier), stop, report exactly which
item is blocked, why, and your recommended tradeoff, and wait for my
decision on that item specifically rather than silently shipping a
workaround.
```

---

## How this kit is built, and how to use it (v2 / v1 — reuse the existing project)

Antigravity isn't a chat box you write clever one-liners into — it's an
agent that plans its own task list, writes code, runs a terminal, opens
a real Chrome instance to test what it built, and hands you back
Artifacts (plans, screenshots, recordings) to review. That changes what
a "good prompt" is. Your job isn't to specify every line of code — it's
to pin down the **vision, the constraints, and the bar for "done"**
tightly enough that when the agent plans, it plans the right thing, and
when it verifies itself, it's checking against criteria that actually
matter.

That's why this is four iterations, not one wall of text:

| # | Prompt | What it locks in |
|---|--------|-------------------|
| 1 | Foundation & Architecture | Stack, file structure, what NOT to touch (the working WebRTC logic) |
| 2 | 3D Art Direction & Motion | The actual visual/narrative concept, so it doesn't default to generic bloom-and-spin |
| 3 | Production Hardening | Performance budget, accessibility, SEO, security — the stuff that separates a portfolio toy from something you'd ship |
| 4 | Verification Pass | Forces the agent to use its own browser + Artifacts to prove the thing works, not just that it compiles |

**Recommended flow:** paste Iteration 1 into a fresh Antigravity
workspace, let it produce a plan Artifact, skim it, approve. Let it
finish, watch the recording it gives you. Then paste Iteration 2 into
the *same* thread (so it keeps the architecture context), and so on.
Four short, reviewable loops beat one giant uncontrolled diff — and it
matches how the tool actually wants to work.

If you'd rather do it in one pass and review a bigger diff at the end,
skip to the **Master Grade Prompt** at the bottom — it's all four
iterations fused into a single brief.

> **Update:** the design brief got a lot more specific (three named
> animation patterns, an exact 7-stage scroll narrative, a pinned
> visual language). **`Master Prompt v2`**, right below this section,
> is now the recommended single-shot prompt — it supersedes the
> original Master Grade Prompt at the bottom of this file for this
> project. It also adds an explicit autonomous build → test → fix
> loop, so the agent doesn't stop until every minimum goal is
> independently verified, not just "looks about right." The original
> four iterations and the v1 master prompt are left in place below as
> reference methodology if you want to run this in smaller, more
> reviewable steps instead — just swap in v2's pattern specs where
> the old Iteration 2 used to go.

**Before you paste anything:**
- Open the `p2p-file-transfer/` project (server + client from earlier)
  as the workspace root, so the agent has the real, working signaling
  server and WebRTC logic as ground truth — not something to invent
  from scratch.
- Set the workspace model to Gemini 3 Pro (or Claude Sonnet 4.5, if
  you want stronger design taste on the 3D/art-direction pass —
  you can switch models between iterations).

---

## Master Prompt v2 — Full Pattern Brief + Autonomous Self-Test Loop

### A few notes before you paste this, as the senior-engineer read

A handful of things worth knowing about *why* the prompt below is
written the way it is, since a couple of choices aren't obvious from
the brief alone:

- **One visual component, two data sources.** The hero (Pattern 1)
  needs to show connection state before any real connection exists,
  and the scroll story (Pattern 2) needs to walk through all 7 stages
  as a demo before the user has done anything. Neither of those can
  be wired to real WebRTC state — there's nothing real to show yet.
  But once the user reaches the actual app and starts a real
  transfer, Pattern 3 *must* be wired to real state. Rather than let
  the agent build two diverging visual systems, the prompt below
  makes this explicit: build **one** node/beam visual component,
  parameterized by a state source — a scripted demo timeline for the
  hero/story, the live Zustand store for the real app. Same visual
  language, same code, two inputs.
- **Progress-bar honesty.** "Show real-time transfer progress through
  the particle stream" is the single most common place an agent will
  quietly cheat — it's much easier to tween a progress value with a
  nice easing curve than to correctly plumb real `bufferedAmount` /
  bytes-transferred events into a shader uniform. The prompt below
  forbids this explicitly and makes it part of the verification loop:
  the agent has to prove the 3D progress tracks real bytes, not just
  that it animates smoothly.
- **Performance is the real risk here, not the visuals.** Particles +
  volumetric lighting + a curved tunnel + magnetic cursor + parallax
  + a scroll-scrubbed camera is a lot of simultaneous GPU work. Left
  to its own judgment, an agent will often ship "the same scene, just
  slower" on mobile instead of a genuinely reduced version. The
  prompt pins down three explicit quality tiers so mobile isn't an
  afterthought.
- **Glassmorphism "used sparingly"** is vague enough that an agent
  will either skip it or spread it everywhere. The prompt scopes it
  to two specific surfaces so it has a defined boundary.
- **The self-testing loop** is exactly the workflow Antigravity is
  built for — it drives its own browser, so it can genuinely check
  its own work. The brief's goals are turned into a literal numbered
  checklist below, and the agent is told to keep looping
  build → test → fix, with evidence per item, until every line is
  green — and, importantly, to report a real blocker rather than
  quietly redefining a metric to pass it.

### The prompt

```
ROLE
You are acting as a senior creative technologist and WebGL engineer,
capable of shipping work at the quality bar of
awwwards.com/websites/3d — precise camera choreography, restrained
and intentional effects, real depth and lighting, not generic
particle flash. Use that showcase only as a register/quality
reference — do not copy any specific site's exact composition,
assets, or code.

GROUND TRUTH — HARD CONSTRAINT
This repo has a working WebRTC peer-to-peer file transfer system.
The signaling server (server/, Node.js + ws) does exactly one job:
peer discovery and relaying SDP offer/answer and ICE candidates. It
never sees file data. The actual file bytes travel directly between
browsers over an encrypted WebRTC DataChannel once the handshake
completes. Read the existing server/ and client/ code fully before
writing anything. Port this behavior faithfully into the new stack —
do not simplify, mock, or fake any part of the handshake, chunking,
backpressure, or SHA-256 integrity verification. A real file must
still transfer correctly between two real browser tabs when you are
done. That is non-negotiable and independent of how the 3D layer
looks.

TECH STACK
React + TypeScript + Vite, three.js via @react-three/fiber, GSAP
(+ScrollTrigger) for the scroll/camera timeline. You may bring in
supporting libraries where they clearly help (drei for R3F helpers,
postprocessing for bloom/DoF, Lenis for smooth scroll, Zustand for
shared state) — substitute equivalents if you have a better-supported
option, as long as the quality bar and behavior below are met.
Optimize the WebGL rendering path, lazy-load heavy 3D assets
separately from the functional transfer UI, and support
prefers-reduced-motion and a genuine mobile fallback (see tiers
below) — the 3D must enhance the product, never block or degrade its
usability.

ARCHITECTURE NOTE (read before building)
Build ONE reusable "peer link" visual component (nodes + connecting
beam/data path), parameterized by a state source rather than hardcoded
to either the marketing narrative or the live app:
- In the Hero and the Scroll Story, feed it a scripted/looping demo
  timeline (idle → searching → connected → idle, or the relevant
  7-stage beat).
- In the real app section (after the user actually creates/joins a
  room and transfers a file), feed it the live Zustand connection/
  transfer store.
Same component, same visual language, two data sources — do not
build a separate "fake" version and a separate "real" version.

VISUAL DIRECTION
Minimal, futuristic networking aesthetic. Premium dark interface.
Glassmorphism used sparingly and only on two surfaces: the room-code
card and the active transfer panel — not as a general background
treatment. Realistic depth via soft volumetric lighting and subtle
fog/vignette, not flat gradients. Subtle particles, not particle
storms. Clean, restrained typography with strong contrast. Smooth
micro-interactions on functional elements only. Explicitly avoid
saturated neon or cyberpunk styling — the light should read as
premium hardware/instrumentation, not a rave.

PATTERN 1 — INTERACTIVE 3D PEER NETWORK HERO
A floating sphere/globe volume built from subtle instanced particles
and faint connecting network lines (ambient network texture, kept
quiet — this is atmosphere, not the focus). Two primary nodes sit
inside/near it, clearly distinguished from the ambient field by size
and glow: one labeled "This device," one labeled "Peer" (or, in the
demo timeline, illustrate as Laptop and Phone silhouette forms). Idle
state: faint or no path between them. On a "connected" state (real
or scripted-demo): a smooth, glowing data path animates between the
two nodes. Add mouse-follow parallax — a small, damped rotation/
offset of the camera or node group based on pointer position, in the
range of a few degrees at most, always smooth and never disorienting.
This is the one place "elegant, not flashy" matters most: if in
doubt, dial it back further.

PATTERN 2 — SCROLL-DRIVEN 3D STORYTELLING
The page is one continuous 3D journey, not a stack of sections with
separate animations. Build a single GSAP timeline, scrubbed by one
ScrollTrigger across the full scroll container, moving the camera
along a continuous path (e.g. a spline curve) with easing — no jump
cuts between stages, and scrolling back up must reverse smoothly.
Move through these seven beats, each with its own camera position/
angle, object rotation, scale, and depth change:
1. Create Room — a node materializes from the particle field; a
   room-code token forms near it.
2. Join Room — a second node approaches from a distance.
3. Peer Discovery — several thin candidate paths appear and are
   tested between the nodes (visualizing ICE/STUN candidate
   gathering).
4. WebRTC Connection — the candidates converge into one matched path.
5. Secure Data Channel — the path's material shifts to an encoded/
   braided pattern (representing DTLS-SRTP encryption).
6. File Transfer — the established path becomes the curved tunnel
   from Pattern 3, shown here as an illustrative demo pass (a
   representative object travels the path).
7. Transfer Complete — the object reassembles at the destination
   node and settles; a confirmation state plays.
This scroll sequence is an explainer, driven by the scripted demo
timeline from the Architecture Note above — it plays the same way
for every visitor, independent of any real connection.

PATTERN 3 — 3D FILE TRANSFER VISUALIZATION (LIVE)
This is what actually happens in the real app, once a user selects a
file to send for real. The file becomes a polished 3D glowing card/
icon (reflect file type where reasonable). It travels along the same
curved beam geometry as the hero/story's data path, from the "This
device" node to the "Peer" node, through a particle stream. The
particle stream's progress must be driven by the real transfer
progress from the Zustand store (actual bytes sent / bufferedAmount
state) — not an independent tweened animation. On completion, the
object at the receiving end assembles back into the file
representation, and the existing SHA-256-verified confirmation is
shown alongside it. Add subtle hover tilt on the file card/drop zone,
a gentle magnetic-cursor pull near interactive targets, and soft
motion blur/depth on the particle trail — all subtle, matching the
"elegant, not flashy" direction throughout.

PERFORMANCE TIERS (build all three; do not treat mobile as an
afterthought)
- Desktop/high-end: full effect set as described above.
- Mobile/low-end (auto-detected: no WebGL2, low core count, or a
  measured low frame rate on a short warm-up test): reduced particle
  counts, no volumetric postprocessing pass, simplified beam
  material, parallax and magnetic-cursor effects disabled (they're
  pointer-only concepts anyway).
- prefers-reduced-motion: no scroll-jacked camera movement at all —
  normal document scroll, the 7 beats shown as static or lightly
  animated imagery with the same content conveyed in text, no
  mouse-parallax, no magnetic cursor.
Target budget: <2.5MB gzipped initial payload for the 3D bundle
(lazy-loaded separately from the functional UI), 60fps sustained
during the scroll sequence on a mid-tier laptop GPU, and a usable,
responsive functional transfer UI even before or if the 3D layer
fails to load.

ACCESSIBILITY & CORRECTNESS
Full keyboard operability for create/join/transfer, independent of
the 3D scene. Equivalent content in semantic HTML for screen readers
— no information should exist only inside the canvas. Visible focus
states, verified contrast ratios. wss:// only in production signaling
config. Do not alter the documented limitations of the existing
system (no TURN relay, no resumable transfer, one peer pair per room,
no room-code auth) — flag it and ask if you think one should change,
don't quietly "fix" it.

MINIMUM GOALS — DEFINITION OF DONE
Treat every line below as a pass/fail check, not a suggestion. You
must produce independent evidence (a recording, a screenshot, or a
measured number) for each one:

 [ ] 1. Two real browser tabs complete a real file transfer of a
        multi-MB file; SHA-256 verified message displays correctly.
 [ ] 2. Hero renders the particle globe + two labeled nodes; idle
        state shows no/faint path; parallax is present, bounded, and
        smooth (report the actual degree range used).
 [ ] 3. Data path animates smoothly on connect, using the same
        component in both demo and live modes (confirm via code
        reference, not just visually).
 [ ] 4. Scroll story plays all 7 named beats as one continuous
        camera move, no jump cuts, and reverses smoothly on scroll-up
        — recorded top to bottom and bottom to top.
 [ ] 5. Live file-transfer visualization's particle-stream progress
        is sampled against the real store's byte-progress at at
        least 5 points during a real transfer and stays within a
        small, stated tolerance at each sample — report the actual
        sampled numbers, don't assert it "looks synced."
 [ ] 6. Received file's 3D object reassembles and the real
        hash-verified confirmation displays.
 [ ] 7. Glassmorphism appears only on the two specified surfaces —
        confirm by listing every element using it.
 [ ] 8. No saturated neon/cyberpunk colors — report the actual
        palette hex values used.
 [ ] 9. Desktop tier hits 60fps sustained during the scroll sequence
        (measured, not estimated) on a mid-tier profile.
 [ ] 10. Mobile tier is a genuinely reduced build (report which
        effects are disabled), tested at a real mobile viewport, with
        the functional UI fully usable and no overflow/broken touch
        targets.
 [ ] 11. prefers-reduced-motion fallback tested and recorded: no
        camera-jacking, all 7-beat content present as text.
 [ ] 12. Full keyboard-only pass through create → join → send → 
        receive, with no reliance on the 3D canvas.
 [ ] 13. Contrast ratios on all text over the 3D background measured
        and passing WCAG AA.
 [ ] 14. Signaling server file unmodified in its core relay behavior;
        confirm (e.g. via server-side logging or a network inspector
        pass) that it never receives file-chunk data, only signaling
        messages.
 [ ] 15. Initial 3D-bundle payload measured and under the 2.5MB
        gzipped budget, lazy-loaded separately from the functional
        UI.

AUTONOMOUS LOOP — HOW YOU WORK THROUGH THIS
Before writing code, produce your implementation plan as an artifact,
restating the checklist above in your own words and flagging any
item you think conflicts with another (e.g. a performance target vs.
an effect) before you proceed. Then build, and use your editor,
terminal, and browser together to test against the checklist above.
For any item that fails: fix it, then re-test that specific item —
don't move on with a known failure. Keep looping build → test → fix
autonomously until every item passes with real evidence attached. Do
not consider this finished, and do not tell me it's done, until the
full checklist is green with evidence per line.

The one thing you must never do to close out a failing item: relax
the check, fake the measurement, or hardcode a result so it appears
to pass. If something is genuinely not achievable within these
constraints (say, the 60fps target and the full desktop particle
count conflict on a specific tested GPU tier), stop, report exactly
which item is blocked, why, and your recommended tradeoff, and wait
for my decision on that item specifically rather than silently
shipping a workaround.
```

---

## Iteration 1 — Foundation & Architecture

```
You are acting as a senior creative technologist and frontend
architect. We are rebuilding the client of an existing, working
WebRTC peer-to-peer file transfer app into a production-grade,
award-caliber 3D marketing + product site, in the visual register of
sites featured on awwwards.com/websites/3d — not a generic Bootstrap
landing page.

GROUND TRUTH — DO NOT REBUILD THIS
The `server/` directory contains a working Node.js + ws signaling
server (room creation, join, SDP/ICE relay). The `client/` directory
contains a working vanilla-JS implementation of the WebRTC handshake,
chunked file transfer, backpressure handling, and SHA-256 integrity
verification. Read both fully before writing anything. This logic is
correct and tested — port its *behavior* faithfully into the new
stack. Do not simplify, mock, or stub out any of the transfer logic.
The rebuilt site must still actually transfer files peer-to-peer when
finished — that is the definition of done, not "looks good."

TARGET STACK
- Vite + React + TypeScript
- three.js via @react-three/fiber, with @react-three/drei for helpers
  and @react-three/postprocessing for effects
- GSAP + ScrollTrigger for scroll-driven sequencing
- Lenis for smooth scroll
- Zustand for app/connection state (room state, transfer progress,
  peer connection status)
- Tailwind CSS for non-3D UI chrome (panels, buttons, inputs)
- Keep server/ as-is (Node + ws) — no changes needed there yet

ARCHITECTURE REQUIREMENTS
1. Separate the WebRTC/signaling logic into framework-agnostic
   TypeScript modules under client/src/lib/webrtc/ (connection
   manager, chunked sender, chunked receiver, hashing) with no React
   or three.js imports — these should be unit-testable in isolation.
2. Expose that logic to the UI through a thin Zustand store /
   custom hooks layer (client/src/state/). The 3D scene and the 2D UI
   both read from this store; neither owns connection state directly.
3. The 3D scene lives in its own component tree
   (client/src/scene/) and NEVER blocks or delays the functional
   UI — file transfer must work even if WebGL fails to initialize
   (see fallback requirement below).
4. Set up the project with a clean src/ layout, path aliases,
   ESLint + Prettier, and a README section documenting the
   architecture decisions above.

FIRST MILESTONE (this iteration only — do not build final visuals yet)
Get a working skeleton: the ported WebRTC logic running correctly in
the new stack, a plain unstyled 2D UI for create/join/transfer (so we
can verify function before form), and an empty R3F <Canvas> mounted
and rendering at 60fps with a single placeholder object, wired into
Lenis + ScrollTrigger scaffolding. Before writing code, produce your
usual implementation plan artifact, and call out any place where you
think the target stack conflicts with preserving the existing
transfer logic's correctness — flag it rather than silently deciding.

When you believe this milestone is complete, open it in your browser
tool and actually run a two-tab transfer test locally (create room in
tab A, join in tab B, send a file) before telling me it's done. Show
me the recording.
```

---

## Iteration 2 — 3D Art Direction & Motion System

```
Foundation is approved. Now build the actual visual identity and
scroll narrative. This is the pass where taste matters most — avoid
the default "dark background, one hero object spinning, particles
everywhere" treatment. Ground every visual choice in what this
product actually does: two devices, connected directly, with no
server in the data path, over an encrypted channel, in
network-topology-accurate stages (candidate discovery → matched
path → encrypted transfer). The 3D concept IS the explanation of
the product, not decoration next to it.

CONCEPT: "THE LINK"
One continuous 3D scene — not separate hero images — that the camera
moves through as the user scrolls. Two luminous nodes suspended in a
dark volumetric space, joined by a beam of light. Reference the
visual language of awwwards.com/websites/3d work: precise camera
choreography tied to scroll position, restrained bloom/glow used with
intent (not blanket), a single memorable moment rather than constant
motion everywhere. Do not copy any specific site's exact composition,
assets, or code — use it only as a register/quality bar reference.

SCROLL SEQUENCE (five beats, camera dollies/orbits between them,
driven by GSAP ScrollTrigger scrubbing the R3F camera + shader
uniforms):

1. HERO — two distant nodes, faint idle beam pulsing slowly.
   Headline states what the product does in plain language.
2. "DIRECT, NOT ROUTED" — camera pulls back to reveal a third,
   dimmer node off the direct path (representing a conventional
   cloud server), with a broken/crossed-out dotted line through it,
   contrasted against the solid direct beam. This is the one moment
   allowed a slightly more illustrative, storytelling treatment.
3. "HOW IT CONNECTS" — visualize ICE/STUN candidate gathering: many
   thin candidate paths/particles briefly appear between the nodes
   and converge down to the single matched connection. This should
   read as "searching, then locking on," not as a generic particle
   swarm.
4. "ENCRYPTED END TO END" — the beam's material/shader shifts to a
   braided or encoded pattern as the camera moves along its length,
   representing the DTLS-SRTP layer.
5. TRANSITION TO PRODUCT — the 3D scene recedes/dissolves and hands
   off to the real, functional create-room/join-room panel from
   Iteration 1. This handoff must feel designed, not like a hard cut
   from "marketing site" to "app."

DESIGN TOKENS (extend, don't replace, unless you have a specifically
better justified system — explain your reasoning if you deviate)
- Background: near-black ink, not pure #000
- One warm accent used for connection/signal state (in the existing
  client this was an amber, ~#FFB454) — carry it through as the
  color of "the link" itself in 3D
- A calm success green and a warn red already exist in the current
  design system for verified/error states — keep them consistent
  between the 3D scene and the 2D transfer UI
- Typography: keep the existing Inter (UI) + IBM Plex Mono (data
  readouts: room codes, byte counts, hashes) pairing; the mono face
  should also inform any in-scene typographic/HUD elements

MOTION DISCIPLINE
- Spend boldness on ONE thing: the camera-driven scroll sequence
  through the link. Everything else (buttons, panels, inputs) stays
  quiet, fast, and unanimated except functional micro-feedback
  (hover, focus, connection-state changes).
- No scroll-jacked fade-up-on-every-section pattern. No hover
  effects on every single card "because we can."
- Respect prefers-reduced-motion: ship a fallback where scroll
  behaves normally (no camera hijacking, no scrub), the 3D scene
  either goes fully static or is replaced with a lightweight
  static/animated-image equivalent of each beat, and all information
  conveyed by camera movement is also conveyed in text.

Before implementing, produce a short written art-direction plan
(palette as named hex values, type roles, the wireframe/beat
breakdown above with your own refinements, and what makes this
specifically about THIS product rather than a generic "3D dark site")
as your plan artifact, so I can react before you build.
```

---

## Iteration 3 — Production Hardening

```
Visual direction is approved and implemented. This pass is about the
difference between a portfolio piece and something production-grade.
Go through each of the following as a checklist and treat every item
as a requirement, not a suggestion:

PERFORMANCE
- Establish and enforce a budget: initial JS + 3D asset payload under
  ~2.5MB gzipped, first contentful paint under 2s on a throttled
  "Fast 3G / mid-tier mobile CPU" profile, sustained 60fps on a
  mid-tier laptop GPU during the scroll sequence.
- Lazy-load the 3D scene bundle separately from the functional
  transfer UI, so the app is usable the instant it's interactive even
  if the 3D assets are still loading.
- Detect low-end devices / lack of WebGL2 and serve the reduced-motion
  fallback from Iteration 2 automatically, not just on user request.
- Instrument and report actual measured numbers back to me, not
  estimates — use your browser tool's performance profiling.

ACCESSIBILITY
- Full keyboard navigation through create/join/transfer flows,
  independent of the 3D scene.
- The 3D scene and its scroll narrative must not be the only carrier
  of information anywhere — screen reader users get the same content
  as plain, semantic HTML alongside it (not hidden behind canvas).
- Visible focus states, sufficient contrast on all text over the 3D
  background (check actual contrast ratios, don't eyeball it),
  honor prefers-reduced-motion and prefers-contrast.

SEO / SHAREABILITY
- This is a client-rendered SPA with heavy WebGL — make sure the
  document still has correct <title>, meta description, Open Graph /
  Twitter card tags, and that the core value proposition is present
  in initial HTML (SSR the marketing copy via a lightweight
  pre-render step, or provide a noscript-safe content layer) so it
  isn't invisible to crawlers and link previews.

SECURITY / CORRECTNESS (carry forward from the existing system)
- Confirm the signaling server is used over wss:// in production
  config, never ws://.
- Confirm room codes still expire/clean up correctly when a peer
  disconnects (check server/server.js logic is unchanged and still
  correct after any client-side changes).
- Do not silently "fix" the known, documented limitations (no TURN
  relay, no resumable transfer, no auth on room codes) by faking
  them — if you think one is now in scope, ask me first rather than
  quietly implementing a partial version.

ENGINEERING QUALITY
- TypeScript strict mode, no `any` escapes without a comment
  explaining why.
- Component and module boundaries stay as defined in Iteration 1 —
  webrtc/ logic still has zero three.js/React imports.
- Add a short CONTRIBUTING or ARCHITECTURE note explaining the
  scene/state/logic separation for whoever maintains this next.

Report back with actual measured numbers (bundle size, Lighthouse
scores, contrast ratios) — not "should be fine."
```

---

## Iteration 4 — Verification Pass

```
Before calling this finished, run your own end-to-end verification
using your editor, terminal, and browser tools together, and produce
Artifacts I can review directly (screenshots + recording), covering:

1. Full functional transfer test: create a room in one browser
   context, join from a second, drag-and-drop a real file (a few MB,
   not a tiny stub), confirm it downloads on the receiving side, and
   confirm the SHA-256 verified message displays correctly. Record
   this.
2. The full scroll sequence from Iteration 2, recorded top to bottom,
   at a normal scroll speed — I want to see the camera choreography
   as a user would experience it, not just individual screenshots.
3. Reduced-motion fallback: toggle prefers-reduced-motion and record
   the same scroll pass, confirming no camera-jacking and that all
   narrative content is still present as text.
4. Mobile viewport pass (e.g. 390×844): confirm the 3D scene degrades
   sensibly, the transfer UI remains fully usable, and nothing
   overflows or breaks touch targets.
5. A hard failure case: kill the signaling server mid-session and
   confirm the UI communicates the disconnect state clearly instead
   of hanging silently.

For each, tell me pass/fail against the specific requirement it maps
to from Iterations 1–3 — not a general "looks good." If anything
fails, fix it and re-run that specific check before reporting back.
```

---

## The Master Grade Prompt (single-shot, full brief)

Use this instead of the four iterations above if you want one long
autonomous run. It's the same brief, fused — Antigravity will still
produce its own plan Artifact first; read that before letting it
proceed.

```
ROLE
You are acting as a senior creative technologist and frontend
architect, the kind of person capable of shipping work that would be
featured on awwwards.com/websites/3d — not a generic template
builder. Take the aesthetic and technical bar of that showcase
seriously: precise camera choreography, restrained and intentional
effects, a distinct visual identity grounded in the actual subject
matter, and production-level engineering underneath it. Do not copy
any specific site's exact composition, assets, or code — use that
showcase only as a register and quality reference.

CONTEXT AND GROUND TRUTH
This repository contains a working WebRTC peer-to-peer file transfer
system: a Node.js + ws signaling server (server/) that only ever
relays room-matchmaking and SDP/ICE handshake messages, and a client
(client/) that performs the real work — RTCPeerConnection setup,
STUN-based ICE, a DTLS-encrypted RTCDataChannel, 16KB chunked
transfer with bufferedAmount-based backpressure, and SHA-256 integrity
verification on both ends. Read all of it before writing anything.
This logic is correct — port its behavior faithfully into the new
stack below. The finished site must still actually transfer a real
file peer-to-peer between two browser tabs. That is the non-negotiable
definition of "done," independent of how good the visuals look.

Known, intentional limitations to preserve as-is (do not silently
"fix" or fake a solution to these — ask first if you think one should
change): no TURN relay fallback, no resumable transfer after
disconnect, one peer pair per room, no auth on room codes.

TARGET STACK
Vite + React + TypeScript · three.js via @react-three/fiber ·
@react-three/drei · @react-three/postprocessing · GSAP + ScrollTrigger
· Lenis smooth scroll · Zustand for connection/transfer state ·
Tailwind CSS for 2D UI chrome. Leave server/ (Node + ws) as-is.

ARCHITECTURE
- client/src/lib/webrtc/ — framework-agnostic TypeScript: connection
  manager, chunked sender/receiver, hashing. Zero React or three.js
  imports. Unit-testable in isolation.
- client/src/state/ — Zustand store + hooks exposing connection/
  transfer state to both the 3D scene and the 2D UI. Neither owns
  connection state directly.
- client/src/scene/ — the 3D scene, isolated, never blocking the
  functional UI. File transfer must keep working even if WebGL fails
  to initialize.
- Strict TypeScript, ESLint + Prettier, path aliases, and an
  ARCHITECTURE.md explaining this separation.

DESIGN CONCEPT — "THE LINK"
One continuous 3D scene the camera moves through as the user scrolls,
telling the product's real story in five beats (GSAP ScrollTrigger
scrubbing the R3F camera and shader uniforms, not per-section
fade-ins):
1. Hero — two distant luminous nodes in a dark volumetric space,
   joined by a faintly pulsing beam. Plain-language headline.
2. "Direct, not routed" — camera reveals a third, dimmer node off the
   direct path (a conventional server), a broken line through it,
   contrasted with the solid direct beam.
3. "How it connects" — ICE/STUN candidate gathering visualized as
   multiple thin candidate paths converging to one matched
   connection — reads as "searching, then locking on."
4. "Encrypted end to end" — the beam's material shifts to a braided/
   encoded pattern as the camera travels its length.
5. Transition to product — the scene recedes and hands off, as a
   designed transition (not a hard cut), to the real, functional
   create-room / join-room panel.

Design tokens to extend (deviate only with justification): near-black
ink background (not pure #000); a warm amber (~#FFB454) as the single
accent, carried through as the color of "the link" in 3D; existing
success green / warn red kept consistent between scene and UI; Inter
for UI text, IBM Plex Mono for data readouts (room codes, byte
counts, hashes) and any in-scene HUD typography.

Motion discipline: spend boldness on the one scroll-driven camera
sequence; keep buttons/panels/inputs quiet with only functional
micro-feedback; no fade-up-on-scroll on every section; no hover
effects added just because they're possible.

PRODUCTION REQUIREMENTS
- Performance: <2.5MB gzipped initial payload, FCP <2s on throttled
  mid-tier mobile, sustained 60fps during scroll on a mid-tier
  laptop GPU. Lazy-load the 3D bundle separately from the functional
  UI. Auto-detect low-end devices / no-WebGL2 and serve a
  reduced-motion fallback (static or lightweight imagery per beat,
  normal scroll, all narrative content present as text).
- Accessibility: full keyboard operability for create/join/transfer
  independent of the 3D scene; equivalent content in semantic HTML
  for screen readers; visible focus states; verified contrast ratios;
  honors prefers-reduced-motion and prefers-contrast.
- SEO: correct title/meta description/OG/Twitter tags and the core
  value proposition present in initial HTML despite the heavy
  client-rendered scene (pre-render the marketing copy or provide a
  noscript-safe content layer).
- Security: wss:// only in production signaling config; confirm room
  cleanup on disconnect is still correct after client changes.

VERIFICATION (use your editor, terminal, and browser together; report
pass/fail against the specific requirement above, not "looks good")
1. Real two-tab file transfer test with a multi-MB file; confirm
   download and SHA-256 verified message; record it.
2. Full scroll sequence recorded at normal speed, top to bottom.
3. Reduced-motion fallback recorded the same way.
4. Mobile viewport pass (390×844): scene degrades sensibly, transfer
   UI fully usable, no overflow or broken touch targets.
5. Signaling-server-killed mid-session: confirm a clear disconnect
   state in the UI rather than a silent hang.
6. Actual measured numbers: bundle size, Lighthouse scores, contrast
   ratios — not estimates.

PROCESS
Before writing code, produce your implementation plan as an artifact,
including the beat-by-beat 3D sequence in your own words and any
point where the stack above seems to conflict with preserving the
existing transfer logic's correctness — flag those rather than
deciding silently. Wait for my go-ahead on the plan before building.
```

---

## Why this is structured this way

A few principles behind the choices above, in case you want to adapt
this kit for a different project:

- **Constraints before creativity.** "Preserve the exact WebRTC
  behavior" comes before any visual direction, in every prompt. An
  agent that's free to refactor working networking code while also
  chasing a visual brief will usually sacrifice the invisible thing
  (correctness) for the visible one (looks).
- **Ground the 3D concept in the product, not in "3D websites in
  general."** A generic "cool dark 3D site" prompt gets you generic
  cool dark 3D. Tying every beat of the scene to an actual network
  concept (NAT traversal, DTLS) is both more distinctive and easier
  for the agent to reason about than an arbitrary aesthetic brief.
- **Exploit the tool's own verification loop.** Antigravity can
  drive a real browser and hand you a recording — so the prompts ask
  for recordings against named requirements instead of trusting a
  self-reported "done." Treat its Artifacts like a junior engineer's
  PR: read them, don't rubber-stamp them.
- **Negative constraints matter as much as positive ones.** Calling
  out what NOT to do (no fade-up-on-every-section, no hover-on-
  everything, don't silently "fix" documented limitations) prevents
  default patterns from creeping back in under a vague brief.
- **Numbers, not adjectives.** "Fast" and "polished" are not
  requirements an agent can verify against. Payload size, FCP,
  frame rate, and contrast ratios are.
- **Review the plan artifact before code exists.** Every prompt above
  asks for a plan first. Catching a wrong architectural assumption in
  a paragraph is cheap; catching it after 40 files exist is not.
