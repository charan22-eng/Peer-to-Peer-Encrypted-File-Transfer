# Peer/Link Network Architecture and Security Audit

**Scope:** `client/src`, `server/index.js`, configuration, tests, and project documentation as present in the working tree.

**System classification:** WebRTC application-layer overlay, not a routed enterprise LAN. The browser and OS networking stack provide IP routing, NAT, firewall traversal, and interface selection through ICE. Peer/Link adds a signaling control plane and an optional WebSocket relay fallback.

## Executive priority list

| Priority | Finding | Status |
|---|---|---|
| P0 | Anonymous signaling could be used as a room-join and relay-abuse service | Fixed in code with origin, token, room-code, and rate controls; production identity/auth remains a product decision |
| P0 | Unauthenticated ECDH exchange allowed signaling MITM | Fixed by showing a short key fingerprint and requiring explicit out-of-band verification before transfer |
| P0 | Public TURN fallback and wildcard CORS were unsafe production defaults | Fixed: production requires TURN configuration and CORS origins are allowlisted |
| P1 | Six-character `Math.random()` room codes were too weak | Fixed with cryptographic 10-character codes and exact validation |
| P1 | Single-process room state prevents horizontal scaling | Not hidden: requires sticky sessions or Redis/pub-sub for multi-instance deployment |
| P1 | Large relay/file transfers remain resource-sensitive | Partially mitigated by chunking and OPFS; capacity, quota, and load testing are still required |

## 1. Architecture and design

### Topology

The chosen topology is appropriate for a 1:1 file-transfer prototype:

```text
Browser A ── signaling WebSocket ──┐
                                   ├── Signaling service
Browser B ── signaling WebSocket ──┘

Browser A ═════ ICE-selected RTCDataChannel ═════ Browser B
                    or TURN/WS relay fallback
```

The signaling service is a control-plane dependency. It should not be treated as the file-data path when direct WebRTC succeeds. The relay fallback is useful for availability, but it changes bandwidth, privacy, and cost assumptions and must be monitored separately.

### Subnetting and routing

There is no application-controlled subnetting or routing protocol in this repository. That is normal for a browser WebRTC application. The project delegates routing to:

- the host operating system and local router;
- NAT and firewall policy;
- ICE candidate selection;
- STUN for discovery;
- TURN for relay traversal.

Therefore, OSPF, BGP, VLAN, and enterprise subnet design are outside the application boundary. In a deployment architecture, place the signaling service in a protected public subnet/DMZ, keep TURN in a separately monitored edge segment, and do not expose the application process directly to the Internet without TLS termination and upstream rate controls.

### Scalability assessment

The current signaling implementation stores rooms in a process-local `Map`. It is scalable vertically for a small academic workload, but not horizontally without one of:

1. load-balancer stickiness for the lifetime of each room; or
2. a shared Redis/pub-sub room registry and signal fan-out layer.

The browser-to-browser data path scales better than a centralized upload service, but TURN fallback can become the dominant bandwidth and cost bottleneck. A production design should expose direct-vs-relayed connection ratios and TURN egress metrics.

### Design recommendations

- Keep the 1:1 room model for the current scope; do not introduce a mesh without a chunk-availability protocol.
- Use a managed or clustered TURN deployment with UDP, TCP, and TLS listeners.
- Add a Redis-backed signaling adapter before running multiple server instances.
- Add explicit room expiry and maximum concurrent-room quotas for abuse containment.
- Treat OPFS storage quota and browser permission failure as normal runtime outcomes, not exceptional edge cases.

## 2. Security vulnerabilities and controls

### Critical controls implemented

- **Key authentication:** ECDH still provides the session key, but the peers now display a deterministic fingerprint derived from both public keys. A transfer cannot be approved until the user explicitly marks the fingerprint as verified. This is an out-of-band authentication step; it is not a replacement for an organizational identity provider.
- **Payload confidentiality and integrity:** AES-GCM is required before file chunks are sent. SHA-256 is used as an end-to-end file-level integrity check.
- **Signaling authorization:** WebSocket connections require a JWT. Tokens are short-lived and are sent through the WebSocket subprotocol rather than the URL query string in the browser client. Query-token compatibility remains for the Node test client.
- **Room-code entropy:** Room identifiers use `crypto.randomInt()` and a 10-character restricted alphabet. The server validates the exact format.
- **Abuse controls:** Token issuance, room creation, room joining, and signaling messages have independent rate limits. The WebSocket server retains a payload limit.
- **Origin and browser hardening:** CORS uses an explicit origin allowlist, and basic security headers are emitted.
- **Production secrets:** Production startup fails if `JWT_SECRET`, `TURN_URL`, or `TURN_SECRET` are missing.

### Remaining security requirements before production

1. **User identity and authorization:** The JWT is an anonymous session credential issued by the same service. It does not identify a human or organization. Add OAuth/OIDC or a signed invitation model if rooms contain sensitive material.
2. **TLS termination:** The Node server listens on HTTP and the local development client uses `ws://`. Production must terminate HTTPS/WSS at a trusted reverse proxy or load balancer and redirect/block plaintext access.
3. **TURN credential lifecycle:** Use time-limited credentials and restrict TURN allocation quotas. Do not use shared public fallback credentials in production.
4. **Operational secrets:** Keep `JWT_SECRET` and `TURN_SECRET` in a secret manager; rotate them and alert on startup with missing or changed values.
5. **Content policy:** Filenames and metadata are untrusted input. Keep path sanitization, filename length limits, and Unicode normalization in the receiver path. Never render raw metadata as HTML.
6. **Dependency security:** Run `npm audit`, lockfile review, and an automated dependency update process in CI. The current review did not treat third-party package advisories as verified without a live audit result.
7. **Observability privacy:** Log room lifecycle and counters, but never log JWTs, public IPs beyond the required operational retention, file names, file hashes, or payload contents unless explicitly justified.

### Threat model limitations

- A malicious signaling server can still deny service, suppress candidates, or present a different fingerprint to each peer. Out-of-band fingerprint comparison detects key substitution; it does not prevent denial of service.
- A compromised browser, malicious extension, or XSS can read plaintext before encryption or after decryption. Content Security Policy and dependency controls are required for a hardened deployment.
- TURN can observe traffic metadata and bandwidth even when it cannot decrypt AES-GCM payloads.

## 3. Performance, availability, and redundancy

### Single points of failure

- One signaling process and one in-memory room registry.
- A single configured deployment endpoint for signaling.
- Public or single-instance TURN if no HA service is supplied.
- A single browser tab owns transfer state; closing it terminates the session.

### Recommended redundancy

- Run at least two signaling instances behind an HTTPS/WSS load balancer with Redis/pub-sub and health checks.
- Deploy TURN in multiple regions or availability zones with separate DNS/service records.
- Keep the frontend static assets on a CDN with immutable hashed assets.
- Add retry/backoff for signaling reconnect, but never silently resume a transfer without a transfer ID and verified byte offset.
- Add server-level connection, room, signal-message, and relay-byte quotas.

### Performance recommendations

- Measure direct and relayed throughput separately; relay traffic should have a clear budget.
- Continue using bounded chunks and backpressure. For very large files, prefer writable streams/OPFS and avoid reconstructing an in-memory `Blob`.
- Add browser storage-quota checks before accepting a transfer.
- Reduce production bundle size by lazy-loading the 3D scene; the current build reports a JavaScript chunk above 500 kB.
- Add load tests for simultaneous rooms, candidate storms, relay throughput, and large-file hashing.

## 4. Compliance and standards alignment

The project is an academic prototype, not a certified compliance boundary. Its controls can be mapped to industry guidance as follows:

- **WebRTC/IETF:** Uses ICE/STUN/TURN and DTLS-SRTP/RTCDataChannel primitives. Production TURN must support the deployment's UDP/TCP/TLS policy.
- **NIST SP 800-57 / ISO/IEC 11770 concepts:** ECDH establishes keys, but user fingerprint comparison is needed for peer authentication. Document key lifetime, rotation, and compromise handling.
- **ISO/IEC 27001-style controls:** Apply asset inventory, least privilege, secret management, vulnerability management, logging/monitoring, incident response, and backup/restore procedures at deployment level.
- **OWASP ASVS:** Validate all metadata, restrict origins, use secure transport, enforce authentication/authorization, avoid token leakage, and add CSP/security headers.
- **Privacy:** Define retention and deletion rules for signaling logs, IP addresses, room lifecycle data, and any relay telemetry. Do not claim “server never sees traffic” when relay fallback is active.

No IEEE or ISO certification can be inferred from source code alone. Compliance requires documented operational controls, evidence, testing, and an approved risk assessment.

## Verification performed

- Client TypeScript check, lint, production build, and Playwright transfer test.
- Server syntax and signaling integration tests.
- Static review of WebRTC setup, crypto/key exchange, signaling validation, rate limiting, CORS, TURN configuration, and deployment configuration.
- `npm audit --omit=dev --json` for both client and server: no reported production vulnerabilities after removing the unused `node-turn` dependency and refreshing the client lockfile.
