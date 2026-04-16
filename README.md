# DigiDeck — AI-Enhanced Music Mashup Studio

**License:** AGPL-3.0 | **Stack:** React 19 · Firebase · Vercel · Anthropic claude-haiku-4-5 · WaveSurfer.js · Essentia.js · SoundTouch.js · Spotify API · AudD API

> This README is a trust argument. It documents what the system does, where AI is involved, what evidence supports the trust claims, and where the system is known to fail or fall short.

---

## 1. System Overview

DigiDeck is a browser-based music mashup tool. Authenticated users load tracks from Spotify or upload local MP3s, arrange them in a workspace, apply per-track controls (EQ, reverb, delay, compressor, pitch shift, tempo, fade, segmentation), and consult an AI mixing assistant.

No audio is stored in the cloud — only URLs and metadata. Firebase handles auth, file storage, and project saves. AI and fingerprinting calls route through a Vercel serverless proxy so no API keys reach the browser. All processing runs client-side.

**Trust-relevant architecture:**

| Component | Trust Role |
|---|---|
| `App.js` + `AuthScreen.js` | Auth gate — workspace never renders without a resolved user |
| `appContext.js` | Workspace state, UID-scoped localStorage, undo/redo (50 steps) |
| `AudioEngine.js` | Web Audio API, SoundTouch pitch/speed, effects chain, WAV export |
| `AIPanel.js` | Claude chat with bias disclosure; never modifies workspace |
| `api/aiChat.js` | Vercel proxy — holds `ANTHROPIC_API_KEY` server-side only |
| `FirebaseService.js` | Firestore CRUD, Storage upload/download, atomic cleanup on failure |
| `essentiaAnalyzer.js` | Client-side BPM/key detection (Essentia WASM, 30 s timeout) |

---

## 2. AI Usage

### 2.1 Development Methodology

AI was used as an active development partner in three phases:

1. **Plan first.** Before any significant feature, a spec was written in an external LLM session covering what to build, which files to touch, and what could go wrong. The spec was refined until precise enough to act on.
2. **Implement with IDE-integrated tools.** Claude Haiku 4.5 (Claude Code) handled logic-heavy work — auth, state, tests, CI/CD, and the AI panel. Gemini 3.1 Low (Antigravity IDE) handled layout; Antigravity can control the browser directly, so it could visually verify UI changes against the design doc.
3. **Refine conversationally.** Follow-ups corrected mistakes the LLM introduced and resolved design decisions (component choices, Firestore rule scope, storage strategy).

### 2.2 AI Features in the Product

**Mixing assistant (FR-010–013).** Every user message is sent to `/api/aiChat` with a system prompt containing the live workspace state: track titles, BPM, key, Camelot notation, source type, segment positions, EQ, and active effects. The model is explicitly told not to modify the workspace — suggestions are advisory only. A dismissible bias notice appears above each session warning that suggestions reflect training data and may be inaccurate (FR-027).

**Filename parsing (FR-022).** If an uploaded MP3 has no ID3 tags and AudD fingerprinting fails, the filename is sent to Claude for a best-effort title/artist guess. Last resort only.

**Runtime effects description (NFR-010).** `buildEffectsCapabilities()` generates the AI's description of available controls from live config at call time, so the AI cannot give advice based on a stale list of effects.

### 2.3 External API Data Flow

| Upstream | Route | Data Sent | Stored? |
|---|---|---|---|
| Anthropic | `/api/aiChat` | Message + workspace context | No |
| AudD | `/api/identifyTrack` | Audio URL | No |
| Claude (filename) | `/api/parseFilename` | Filename string | Applied to metadata only if ID3 and AudD both fail |
| Spotify | `api.spotify.com` | Auth token + search query | Cached in component state |

---

## 3. Trust Gates

These are the mechanisms that enforce specific trust properties. Each maps to a requirement and is covered by tests.

**G1 — Auth Gate (FR-015)**
Nothing in the workspace renders until Firebase Auth resolves to a signed-in user. localStorage is UID-scoped so one user's data cannot be read by another. On sign-out, in-memory workspace state resets to defaults.
*Evidence:* `auth.test.js`, `authScreen.test.js`, `firebase.test.js`, `libraryPanel.test.js`, `header.test.js`

**G2 — Audio Quality Warning (NFR-005)**
If pitch shift exceeds ±3 semitones or tempo exceeds ±15%, a visible warning appears on the track card.
*Evidence:* `trackCard.test.js — quality warning`; `ai.test.js — system prompt constraints`

**G3 — AI Non-Replacement Guard (FR-012)**
The Claude system prompt explicitly bans adding, removing, or reordering tracks. No tool-use format is requested. The request body omits `tools` and `tool_choice` entirely.
*Evidence:* `ai.test.js — API call parameters`

**G4 — Track Limit (FR-020)**
`handleAddTrack` and `handleDuplicateTrack` both check `tracks.length >= 5` and refuse to add a sixth track. An error notification is shown.
*Evidence:* `appContext.test.js — track limit`; `workspace.test.js — track limit error notification`

**G5 — API Failure Visibility (NFR-007)**
Upload/delete errors show dismissible banners. Claude errors appear in chat. Project save failures show a toast. localStorage quota failure shows an amber banner for 5 seconds.
*Evidence:* `libraryPanel.test.js`; `ai.test.js`; `header.test.js`

**G6 — AI Context Freshness (FR-010, FR-029)**
`buildSystemPrompt()` is called at send time using the live track state. Each reply shows a "Context at HH:MM" timestamp.
*Evidence:* `ai.test.js — context timestamp`

**G7 — Upload Atomicity**
If Storage upload succeeds but Firestore write fails, both Storage blobs are deleted before the error surfaces. No orphaned files can persist.
*Evidence:* `libraryPanel.test.js — upload error notification`

**G8 — Orphan Track Detection on Delete**
When a file is deleted, all workspace tracks referencing it are marked `isMissing: true` before the Storage delete runs.
*Evidence:* `libraryPanel.test.js — delete upload`

### CI/CD Pipeline

Every push or pull request to `main` triggers:

```
build → test → analysis → deploy
```

- **build:** `npm ci` + `npm run build` — any compile error or ESLint warning fails the job.
- **test:** `npm test -- --coverage --watchAll=false` — all tests must pass. **Current count: 856 passing, 13/14 suites (1 skipped).**
- **analysis:** `npm run lint` — zero errors allowed.
- **deploy:** Only runs if all three prior jobs pass. Production only on push to `main`.

Pipeline skips `docx/**` and `**.md` changes.

---

## 4. Key Incidents and Failures

These are real failures that occurred during development. They are documented here because a credible trust argument requires honesty about what went wrong.

**Incident 1 — Forever loading screen after deploy.**
`firebase.js` called `getDoc()` inside `onAuthStateChanged` with no error handling. When Firestore rules blocked the read, the error bypassed `setLoading(false)`, leaving the app stuck. Fix: `try/catch/finally` around all Firestore calls so loading always clears.

**Incident 2 — Firebase Storage CORS blocked uploads.**
Firebase Storage needs explicit CORS config per bucket — it doesn't inherit domain allowlists from the Firebase Console. Fix: `cors.json` applied with `gsutil cors set`.

**Incident 3 — Spotify tokens blocked by subcollection rules.**
Firestore rules only covered `users/{userId}`. The Spotify token path `users/{userId}/tokens/spotify` was a subcollection and was denied. Fix: wildcard subcollection rule.

**Incident 4 — AI removed a valid Essentia parameter and broke BPM/key detection.**
`0.0001` in `KeyExtractor` was flagged as a rogue parameter and removed. It is `spectralPeaksThreshold` — the correct positional default in a 15-argument function. The AI did not check the signature. Both `public/` and `build/` copies of the worker had to be manually reverted.

**Incident 5 — AI responses cut off mid-sentence.**
`max_tokens` was left at the plan draft placeholder of `400`. Raised to `1024`.

**Incident 6 — AI suggested control values that don't exist.**
Claude recommended "set speed to 0.91" — not a valid preset. The system prompt described state but not valid ranges or which controls are presets vs. sliders. Fix: `APP_CAPABILITIES` block added, later made runtime-derived via `buildEffectsCapabilities()`.

**Incident 7 — Requirement annotations broke a test suite.**
`// [NFR-004]` placed inside `describe()` argument lists caused `SyntaxError: Unexpected token` and blocked the whole suite. Fix: moved comments inside the `{`.

**Incident 8 — AI suggested putting a private key in the client bundle.**
During a refactor, the model suggested moving `api/authTokenValid.js` (which holds the Firebase Admin private key) into `src/firebase/` to "simplify structure." This would have shipped the key to every browser. The model raised no concern. The user caught it.

**Incident 9 — Firebase User properties dropped by shallow clone.**
`Object.assign({}, auth.currentUser)` was used to force a re-render. Firebase `User` objects expose properties as non-enumerable getters — `Object.assign` silently drops them, producing an empty object. Fix: explicit property mapping.

**Incident 10 — Waveforms disappear after track reorder. (Unresolved)**
WaveSurfer instances hold references to specific DOM nodes. When React reorders components, the instances become attached to the wrong nodes. Multiple fixes were tried (stable keys, destroy/reinit on cleanup). Waveforms reinitialize after page reload but not reliably after in-session reordering.

**Incident 11 — Beat snapping and segment magnetization abandoned.**
Both features were planned and attempted across multiple AI sessions. Beat positions from Essentia did not map to WaveSurfer's coordinate system. Magnetization created drag handler conflicts. Both features were removed.

**Incident 12 — `clearAllMocks()` broke auth callback capture.**
Tests captured the Firebase auth callback with `onAuthStateChanged.mockImplementation(cb => capturedAuthCallback = cb)`. `clearAllMocks()` in `beforeEach` wiped the implementation, so `capturedAuthCallback` was never repopulated. Fix: moved `mockImplementation` inside `beforeEach`.

**Incident 13 — Import paths not updated after moving a file.**
`SpotifyContext.js` was moved from `src/context/` to `src/spotify/` while the AI was assisting a cleanup. Six files kept the old import path. The AI confirmed the move was complete without doing a dependency scan. Broken imports found at build time.

---

## 5. Trust Claims

Each claim is stated with evidence and its known limitation. Claims without evidence or acknowledged limitations are not included.

**Claim 1: No workspace data is visible before a user signs in.**
*Evidence:* `App.js` shows `<AuthScreen />` when `user` is null. localStorage is keyed per UID. Workspace resets on sign-out. Auth tests cover all transitions. Firestore rules validated by `firestore.rules.test.js`.
*Limitation:* Rules tests run against the emulator, not production. A misconfiguration that only appears in prod would not be caught before deploy.

**Claim 2: The AI assistant cannot modify workspace tracks.**
*Evidence:* System prompt prohibits it. `tools` and `tool_choice` are absent from every API request. `ai.test.js — API call parameters` verifies this.
*Limitation:* The restriction is prompt-based. A model update or a prompt injection in a track title could bypass it. There is no architectural enforcement.

**Claim 3: The workspace is capped at five tracks and the user is told when it's full.**
*Evidence:* `handleAddTrack` and `handleDuplicateTrack` both check `tracks.length >= 5`. Covered by `appContext.test.js` and `workspace.test.js`.
*Limitation:* None identified.

**Claim 4: API and network failures are shown to the user.**
*Evidence:* Upload/delete errors show banners, Claude errors appear in chat, save failures show a toast, localStorage quota failure shows an amber banner. All tested.
*Limitation:* Only tested failure paths are covered. Untested paths (e.g. partial Firestore failures mid-load) may still be silent.

**Claim 5: The AI sees the workspace state at the moment the message is sent.**
*Evidence:* `buildSystemPrompt()` is called at send time with the live track ref. Each response shows a "Context at HH:MM" timestamp. Verified by `ai.test.js`.
*Limitation:* None identified beyond normal async race conditions, which have not been observed.

---

## 6. Limitations and Risks

### Known Broken Behavior

- **Undo removes the entire track instead of the last action.** The undo system steps through full history snapshots. If the last snapshot before adding a track was empty, undo will remove tracks the user did not intend to remove. Confusing and not per-action.
- **Segment cut position has a consistent offset.** When snipping a segment, the cut does not land where the cursor appears. The offset is uncorrected. Segments can be adjusted manually, but the first cut is not precise.
- **Page reload does not restore waveforms or analysis.** Saved tracks reappear but WaveSurfer waveforms and Essentia BPM/key values are not restored. The user must re-trigger analysis manually. Unresolved re-initialization ordering issue.
- **Waveforms break after in-session track reorder.** See Incident 10. Not fixed.
- **Beat snapping and segment magnetization do not exist.** They were planned, built, and removed. See Incident 11.
- **Deceiving track naming leads to mismatch of ID3/AI track finding** If a user names a track to an existing track of another song and artist, uses forein or integer characters, this can mislead results when searching for album art, artist name, etc.

### What the System Has Not Been Verified to Do

- Export audio that accurately reflects all per-track settings (no test for offline render output — NFR-009 gap).
- Confirm that `/api/aiChat`, Firebase Storage, and auth still work after each deployment (no post-deploy smoke tests — NFR-012 not implemented).
- Identify tracks accurately — AudD can fail or return wrong results; Claude filename parsing is a guess; neither is validated.
- Distinguish who or what last changed a track — user edits, AudD enrichment, Essentia analysis, and Claude metadata are indistinguishable in state (NFR-011 not implemented).
- Work correctly on all browsers — Essentia WASM is assumed to run but not tested across targets.
- Give unbiased mixing suggestions — Claude's output reflects training data.

### Architecture Constraints

- Browser-only by design (FR-006) — no desktop API or hardware dependency.
- SoundTouch uses `ScriptProcessorNode`, which may produce artifacts at extreme pitch/tempo values (NFR-006).

---

## Appendix A — Running the Project Locally

**Prerequisites:** Node.js 20 and a `.env` file:

```
REACT_APP_SPOTIFY_CLIENT_ID=
REACT_APP_SPOTIFY_REDIRECT_URI=
REACT_APP_FIREBASE_API_KEY=
REACT_APP_FIREBASE_AUTH_DOMAIN=
REACT_APP_FIREBASE_PROJECT_ID=
REACT_APP_FIREBASE_STORAGE_BUCKET=
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=
REACT_APP_FIREBASE_APP_ID=
ANTHROPIC_API_KEY=
```

```bash
npm install          # install dependencies
npm run dev          # Vercel dev server (required for /api/* routes)
npm test             # run tests
npm run build        # production build
npm run lint         # ESLint
npm run emulators    # Firebase emulators (Firestore)
```

> Use `npm run dev`, not `npm start`. `react-scripts` does not proxy `/api/` requests.

---

## Appendix B — Repository Structure

```
src/
  components/   — AIPanel, AuthScreen, Header, LibraryPanel, MainWorkspace,
                  PlaylistModal, ProfileModal, TrackCard
  firebase/     — firebase.js, FirebaseService.js
  spotify/      — appContext.js, SpotifyService.js, spotifyAuth.js
  audio/        — AudioEngine.js, useAudioEngine.js
  utils/        — helpers.js, trackConfig.js, useSettings.js
  tests/        — 14 test suites
api/            — aiChat.js, identifyTrack.js, parseFilename.js
public/essentia/ — analyzer.worker.js (Essentia WASM worker)
docx/           — Requirements V1.md, Traceability V1.md, Design V1.1.1.md
.github/workflows/ — ci.yml
```

---

## Appendix C — Requirements and Traceability

Full requirements: `docx/Requirements V1.md` (FR-001–FR-029, NFR-001–NFR-012).

Full test-to-requirement mapping: `docx/markdown-versions/Traceability V1.md`.

| Requirement | Status |
|---|---|
| FR-006 (browser-only) | Architecture constraint — verified by design |
| NFR-006 (responsiveness over fidelity) | Subjective quality attribute — not unit-testable |
| NFR-009 (export accuracy) | Coverage gap — no offline render output test |
| NFR-011 (action-origin audit trail) | Not implemented |
| NFR-012 (post-deploy smoke tests) | Not implemented |
