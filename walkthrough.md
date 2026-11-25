# Security Summary

**Reviewed Files**: 22
**Issues Resolved**: 4

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Unvalidated Episode Patch & SVG Data URL | `server.ts`, `server/security.ts` | 438 | `PATCH /api/episodes/:id` merged unvalidated `coverSpec` keys and accepted any `data:image/*` URL, including `data:image/svg+xml`. | Medium | Fixed | Added strict `EpisodePatchSchema` validation in `server/security.ts` allowing only explicit `coverSpec` properties and raster data URLs (`png`, `jpeg`, `webp`). |
| Unsanitized External Source Links | `src/components/TranscriptChatView.tsx`, `src/lib/format.ts` | 455 | Grounding source URIs were passed directly into anchor `href` attributes without client-side scheme verification. | Medium | Fixed | Added `safeExternalUrl` helper restricting rendered links strictly to `http:` and `https:` URLs. |
| Missing Mutation Rate Limits & URL Credentials Check | `server.ts`, `server/security.ts` | 438, 137 | Episode rename/delete and voice preset mutation routes lacked `apiLimiter`, and SSRF validation ran after Gemini client initialization while permitting userinfo URLs. | Low | Fixed | Applied `apiLimiter` across all mutation endpoints, rejected embedded URL credentials, and enforced SSRF checks before AI client calls. |
| Baseline Hardening Headers | `server.ts` | 88 | Responses lacked `Permissions-Policy` and `X-DNS-Prefetch-Control` hardening headers. | Low | Fixed | Added `Permissions-Policy` and `X-DNS-Prefetch-Control: off` while preserving AI Studio iframe compatibility. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Secrets | `server/ai.ts`, `.env.example` | `GEMINI_API_KEY` is read exclusively server-side via `process.env` and never bundled or sent to the browser. |
| SSRF Protection | `server/security.ts` | `validateSafeExternalUrl` and `safeFetchUrlText` restrict schemes to `http`/`https`, reject localhost/metadata/private IPv4 & IPv6 ranges via DNS lookup, and block userinfo credentials. |
| File Upload & Audio Signature Validation | `server.ts`, `server/security.ts` | `multer` caps uploads at 10 MB in memory, verifies explicit user consent, validates binary magic bytes (`RIFF`/`WAVE`, `ID3`/MP3, `fLaC`, `OggS`, `ftyp`, WebM), and discards raw audio after analysis. |
| Path Confinement | `server/storage.ts` | Resource IDs are stripped via `safeId` and resolved paths are confined inside `.cozyland-data` via `confinePath`. |
| Dependency Security | `bun.lock`, `package.json` | Verified via `bun audit` across 274 packages with 0 reported vulnerabilities. |

## PoC Verification

### SVG Data URL & Schema Bypass in Episode Patch

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unvalidated Update Payload / Stored Script Vector |
| Impact | Medium |
| Affected File | `server.ts:438`, `server/security.ts:95` |
| Test Scenario | `PATCH /api/episodes/:id` with `{"coverImageDataUrl":"data:image/svg+xml;base64,PHN2Zy8+"}` and extra unallowed `coverSpec` properties. |

#### How It Was Fixed
Added `EpisodePatchSchema` with `.strict()` object validation, hex-color validation on `palette`, enum constraints on `motif` and `visualStyle`, and a regex restricting `coverImageDataUrl` strictly to `data:image/(png|jpeg|webp);base64,...`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `PATCH /api/episodes/:id` enters Express route handler at `server.ts:438` | Request body captured |
| 2 | `EpisodePatchSchema.safeParse(req.body)` executes at `server.ts:440` | Fails raster regex / strict schema check |
| 3 | Handler returns HTTP `400` with `code: "VALIDATION_ERROR"` | **Handled Safely** |

#### Conclusion
**Fix Verified** - SVG data URLs and unvalidated `coverSpec` properties are rejected with HTTP 400 before touching episode storage.

### SSRF Targeting Loopback & Cloud Metadata

#### Summary
| Field | Value |
|---|---|
| Issue Type | Server-Side Request Forgery |
| Impact | High |
| Affected File | `server/security.ts:127`, `server/podcastPipeline.ts:143` |
| Test Scenario | `POST /api/stage-a` with `referenceUrl` set to `http://127.0.0.1:3000/api/health`, `http://169.254.169.254/latest/meta-data/`, `https://user:pass@example.com/`, or `file:///etc/passwd`. |

#### How It Was Fixed
Ordered `resolveOptionalUrlContext` before `getGeminiClient` in both `runStageA` and `runUnifiedStageAB`, rejecting embedded credentials (`username`/`password`), non-HTTP(S) protocols, and loopback/metadata/private IP ranges prior to any outbound fetch or AI call.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/stage-a` passes `referenceUrl` into `runStageA` at `server/podcastPipeline.ts:143` | URL enters context resolver |
| 2 | `validateSafeExternalUrl` parses scheme, credentials, hostname, and DNS IP ranges at `server/security.ts:127` | Matches private IP / metadata / credential rule |
| 3 | Throws `statusCode: 400` (`BLOCKED_PRIVATE_IP` / `UNSUPPORTED_URL_SCHEME` / `INVALID_URL_CREDENTIALS`) | **Handled Safely** |

#### Conclusion
**Fix Verified** - Internal loopback, metadata endpoints, credentialed URLs, and local file schemes are blocked with HTTP 400 before outbound requests occur.
