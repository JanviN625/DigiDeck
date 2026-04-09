# DigiDeck — AI-Enhanced Music Mashup Studio

**License:** AGPL-3.0 | **Stack:** React 19 · Firebase · Vercel · Anthropic claude-haiku-4-5 · WaveSurfer.js · Essentia.js · SoundTouch.js · Spotify API · AudD API

---

## 1. System Overview

DigiDeck is a browser-based music mashup tool that lets authenticated users load tracks from Spotify or upload local MP3s, arrange them in a workspace, apply per-track DSP controls (EQ, reverb, delay, compressor, pitch shift, tempo change, fade in/out, segmentation), and receive conversational AI mixing guidance backed by the current workspace state.

The system operates entirely in the browser. There is no native app, no DJ hardware requirement, and no audio data stored in the cloud — only URLs and metadata are persisted. Firebase Authentication controls access; Firebase Firestore and Storage back cloud saves and file uploads; all AI calls are routed through a Vercel serverless proxy to keep credentials server-side.

**Core components:**

| Component | Role |
|---|---|
| `App.js` + `AuthScreen.js` | Root routing and auth gate |
| `firebase.js` (`useFirebaseAuth`) | Firebase Auth state, profile operations |
| `appContext.js` | All workspace state, UID-scoped localStorage, undo/redo (50 steps), quota error notification |
| `LibraryPanel.js` | MP3 upload pipeline (ID3 → AudD → Claude fallback), Spotify catalog |
| `MainWorkspace.js` | Drag-and-drop reorder, track limit enforcement |
| `TrackCard.js` | Per-track playback, EQ, pitch, speed, effects, segmentation, waveform |
| `AudioEngine.js` | Web Audio API, SoundTouch pitch/speed, effects chain, offline render |
| `essentiaAnalyzer.js` | Client-side BPM and key analysis (Essentia WASM, 30 s timeout) |
| `AIPanel.js` | Claude chat, session management (up to 5), bias disclosure, context timestamp |
| `Header.js` | Transport, project name, undo/redo, export (WAV), cloud save/load |
| `ProfileModal.js` | Account info + settings (keybinds, defaults) |
| `api/aiChat.js` | Vercel serverless proxy — holds `ANTHROPIC_API_KEY` server-side |
| `FirebaseService.js` | Firebase Storage upload/download, Firestore CRUD, project save/load/delete |

---

## 2. AI Usage

### 2.1 Development Methodology

AI was used at every stage of this project, not as a passive autocomplete tool but as an active development partner. The methodology followed three repeating phases:

**Phase 1 — Plan generation.**
Before implementing any non-trivial feature, a detailed markdown specification was drafted in an external LLM session (Claude or ChatGPT). The plan described what to build, what files to touch, and what the expected behavior and edge cases were. The plan was iterated conversationally until it was sufficiently precise before being used as a prompt.

**Phase 2 — IDE-level implementation.**
Plans were fed into an IDE-integrated LLM alongside relevant source files:

- **Claude Sonnet 4.6 (VS Code / Claude Code)** was the primary tool for logic-heavy work: auth flows, workspace state, test suites, ESLint fixes, CI/CD validation, trust gate implementation, requirements traceability, and the AI panel backend.
- **Gemini 3.1 Low (Antigravity IDE)** was used for design and layout tasks. Antigravity can control the browser directly — allowing the model to navigate the live app at `http://127.0.0.1:3000`, visually inspect the rendered output, and verify that layout changes matched the design document before confirming the edit. This was specifically used during the auth redesign and design document reconciliation.

**Phase 3 — Conversational refinement.**
After initial implementation, natural language follow-ups corrected mismatches, fixed bugs the LLM introduced, and narrowed down design decisions (e.g., which HeroUI component variants to use, how to scope Firestore security rules, whether to use Firebase Storage vs. IndexedDB).

### 2.2 AI Features in the Application

Three distinct AI capabilities are live in DigiDeck:

**Conversational mixing assistant (FR-010, FR-011, FR-012, FR-013).**
`AIPanel.js` sends every user message to `/api/aiChat` (Vercel proxy → Anthropic API, `claude-haiku-4-5`). Each request includes a structured system prompt built by `buildSystemPrompt(tracks)` containing the full current workspace state: track titles, BPM, musical key, Camelot notation, energy level, source type, segment parameters, EQ settings, and active effects. The model responds as a DJ assistant. It is explicitly constrained by the system prompt not to issue commands that would automatically modify workspace state; all suggestions are advisory only. If the API call fails, the error is appended as a chat message — no silent failure.

**Filename metadata parsing (FR-022).**
When a user uploads an MP3 with an unrecognized filename (ID3 tags absent and AudD fingerprinting returns no match), the filename string is sent to Claude for best-effort title and artist extraction. This is a fallback of last resort and applies only when both other methods fail.

**Runtime effects capabilities (NFR-010).**
`buildEffectsCapabilities()` in `trackConfig.js` derives the AI system prompt's effects description block from `EFFECT_CONFIGS` at call time. This prevents the AI's knowledge of available controls from drifting silently when effect definitions change.

### 2.3 AI Bias Disclosure (FR-027)

A persistent banner above the chat log informs users that "Track suggestions are based on training data and may be inaccurate. BPM, key, and energy values shown are measured directly from your audio — not guessed." This disclosure is non-dismissible and appears before any AI response.

### 2.4 External API Data Flow

All third-party API communication is proxied through Vercel serverless functions. No API key ever reaches the browser.

| Upstream | Route | Data Sent | Stored |
|---|---|---|---|
| Anthropic (Claude) | `/api/aiChat` | User message + workspace context string | Not stored |
| AudD | `/api/identifyTrack` | Audio URL (not binary) | Not stored |
| Claude (filename parse) | `/api/parseFilename` | Filename string | Applied to track metadata if both ID3 and AudD fail |
| Spotify | `api.spotify.com` | Auth token + search query | Playlist/track metadata cached in component state |

---

## 3. CI/CD Pipeline and Trust Gates

### 3.1 Pipeline

Every push or pull request to `main` triggers a four-job GitHub Actions pipeline:

```
build  →  test  →  analysis  →  deploy (production + preview)
         ↓             ↓
     coverage      ESLint
```

- **build:** `npm ci` + `npm run build` — fails on any compilation error or ESLint warning during bundling.
- **test:** `npm test -- --coverage --watchAll=false` — 767 tests across 14 suites must pass. Coverage artifacts are uploaded.
- **analysis:** `npm run lint` — zero ESLint errors permitted; `continue-on-error: false` enforces this.
- **deploy:** Only runs when all three prior jobs pass. Production deployments are gated on push to `main` only.

The pipeline does not run on changes to `docx/**` or `**.md` files.

Current test count: **767 passing tests, 14/14 suites.**

### 3.2 Trust Gates

**G1 — Auth Gate (FR-015)**
No workspace content is rendered until Firebase Auth resolves with an authenticated user. `App.js` renders `<AuthScreen />` when `user` is null. Workspace localStorage is UID-scoped (`digideck_workspace_${user.uid}`), making one user's data unreachable by another.
*Evidence:* `auth.test.js`, `authScreen.test.js`, `firebase.test.js` — full auth flow; `libraryPanel.test.js` — Spotify section gated; `header.test.js` — user profile.

**G2 — Audio Quality Warning (NFR-005)**
When pitch shift exceeds ±3 semitones or tempo change exceeds ±15%, `TrackCard.js` surfaces a visible degradation warning before the user can proceed.
*Evidence:* `trackCard.test.js — TrackCard — quality (G6) warning`; `ai.test.js — system prompt — pitch constraint, BPM constraint`.

**G3 — AI Non-Replacement Guard (FR-012)**
The Claude system prompt explicitly prohibits issuing actions that add, remove, or reorder tracks without an explicit user gesture. No `tool_use` block is returned; responses are plain text only. The system has no mechanism to apply AI suggestions automatically.
*Evidence:* `ai.test.js — API call parameters` asserts `tool_choice` is absent and `tools` is an empty array.

**G4 — Track Limit Enforcement (FR-020)**
`handleAddTrack` in `appContext.js` prevents adding a sixth distinct base song. When the limit is hit, `trackLimitError` is set and `MainWorkspace.js` renders an error notification. The sixth track is never added to state.
*Evidence:* `appContext.test.js — handleAddTrack — track limit`; `workspace.test.js — MainWorkspace — track limit error notification`.

**G5 — API Failure Visibility (NFR-007)**
- Upload and delete failures in `LibraryPanel.js` set `uploadError` / `deleteError` state and render dismissible red banners.
- Claude API errors in `AIPanel.js` are caught and appended to the chat as an error message — not swallowed.
- Firebase project save failures in `Header.js` show a "Failed" toast.
*Evidence:* `libraryPanel.test.js — LibraryPanel — upload error notification, delete error notification`; `ai.test.js — AIPanel — message flow`.

**G6 — AI Context Freshness (FR-010, FR-029)**
`buildSystemPrompt(tracks)` is called inside `handleSend()` using the live `tracks` array at the moment the user sends a message. Each AI reply includes a "Context at HH:MM" timestamp so users can judge whether the advice reflects their current mix.
*Evidence:* `ai.test.js — AIPanel — context timestamp`.

---

## 4. Key Incidents and Failures

The following are real failures encountered during development. They are documented here because a README without failures is not credible.

**Incident 1 — Forever loading screen after deploy.**
After deploying to Vercel and adding it as an authorized Firebase domain, login appeared to work but the app hung on a loading screen for authenticated users. Root cause: `firebase.js` called `getDoc()` inside `onAuthStateChanged` with no error handling. Firestore security rules blocked the read and threw an error, which bypassed `setLoading(false)` entirely. Fix: wrapped the Firestore calls in `try/catch/finally` so `setLoading(false)` always executes. The Firestore rules were also tightened to `request.auth.uid == userId` scope.

**Incident 2 — Firebase Storage CORS blocking uploads.**
After the Firestore fix, uploading MP3s from the Vercel domain failed with a CORS policy error. Firebase Storage requires an explicit CORS configuration per storage bucket — it is not inherited from Firebase Console domain allowlists. Fix: created `cors.json` and applied it with `gsutil cors set` targeting the production bucket.

**Incident 3 — Spotify tokens blocked by Firestore subcollection rules.**
After enabling Spotify connect, token storage failed with a permissions error. Root cause: Firestore rules only covered the top-level `users/{userId}` document; subcollections (`users/{userId}/tokens/spotify`) were still denied. Fix: added a wildcard subcollection rule (`{subcollection}/{document=**}`) scoped to authenticated users.

**Incident 4 — Essentia KeyExtractor parameter incorrectly identified as a bug.**
During test development, the value `0.0001` in the `KeyExtractor` call was flagged as a rogue parameter causing tritone misidentification. The fix (removing it) was applied to `analyzer.worker.js`, which immediately broke BPM/key detection in the live app. Root cause: `0.0001` is `spectralPeaksThreshold` — the correct positional default in a 15-argument signature. Both the `public/` and `build/` copies of the worker were reverted. The F major detection from the test fixture was not a code bug but a consequence of insufficient tonal content in the Audacity-generated audio.

**Incident 5 — AI responses cut off mid-sentence.**
During live testing of the AI chat panel, responses were truncated at awkward points. Root cause: `max_tokens` was set to `400` in both `api/aiChat.js` and the fallback path in `AIPanel.js`. Fix: raised to `1024`. This was an oversight from the initial plan draft that used a conservative placeholder.

**Incident 6 — AI gave impossible control values.**
The Claude assistant advised users to "set speed to 0.91" — a value that does not exist in the speed preset dropdown. Root cause: the system prompt described track state but did not convey which controls are fixed presets vs. continuous sliders, nor the valid ranges. Fix: added an `APP_CAPABILITIES` block to the system prompt detailing available controls, valid ranges, and preset values. This was later made fully runtime-derived via `buildEffectsCapabilities()` (NFR-010).

**Incident 7 — 172 ESLint errors and 21 test failures in pre-merge CI check.**
When the full CI workflow was first run locally (`npm run lint` + `npm test -- --coverage --watchAll=false`), the test suite had 21 failures across 5 suites and lint reported 172 errors entirely in test files. Test failures were caused by: `ResizeObserver` not mocked in JSDOM, `Slider` missing from the HeroUI mock, wrong expected keybind values (test had `s + ctrl` but source used `x`), incorrect `handleDuplicateTrack` expectation, and insufficient `fetch` mocks in `spotify.test.js`. Lint errors were exclusively `testing-library` rule violations (`prefer-find-by`, `no-unnecessary-act`, `no-node-access`, `render-result-naming-convention`). All were fixed before merging.

**Incident 8 — Syntax error from inline requirement annotation placement.**
`// [NFR-004]` comments were placed inside the `describe()` argument list instead of after the opening brace in four places in `firebase.test.js`. This caused a `SyntaxError: Unexpected token, expected ","` that prevented the entire suite from running. Fix: moved all four annotations to after the opening `{`.

---

## 5. Trust Claims

Each claim below is stated precisely, followed by the evidence that supports it and the known limitations on that evidence.

---

**Claim 1: No workspace content or user data is accessible before a user authenticates.**

*Evidence:* `App.js` renders `<AuthScreen />` when `user` is null. Workspace localStorage is keyed to `digideck_workspace_${user.uid}`. Test files `auth.test.js` and `authScreen.test.js` verify that the workspace is not rendered before auth resolves, and `firebase.test.js` covers all auth state transitions. Firestore rules are strictly bound, effectively shutting down Incident 3 as validated by `firestore.rules.test.js`.

---

**Claim 2: The AI assistant does not modify workspace tracks without an explicit user action.**

*Evidence:* The Claude system prompt contains an explicit prohibition. No `tool_use` response format is requested. `ai.test.js — API call parameters` asserts that `tools` is an empty array and no `tool_choice` key is present in the request body. Post-render, structural command interception blocks the AI from injecting unrecognized JSON-like directives to internal component methods.

---

**Claim 3: The workspace cannot exceed five tracks; the user is notified when the limit is reached.**

*Evidence:* `handleAddTrack` and `handleDuplicateTrack` strictly cap tracks using `filter(t => t.audioUrl || t.spotifyId).length >= 5`. Duplicate tracks fundamentally adhere to the workspace capacity checks alongside individual base tracks in `appContext.js`.

---

**Claim 4: API and network failures are surfaced to the user; none are silently swallowed.**

*Evidence:* Firebase upload/delete errors render dismissible banners (tested in `libraryPanel.test.js`). Claude API errors are appended to the chat as a visible message (tested in `ai.test.js`). Firebase project save shows a "Failed" toast (`header.test.js`). The `appContext.js` localStorage quota failure shows an amber banner for 5 seconds. `ScriptProcessorNode` audio drops dynamically dispatch `audio-drop` signals caught by `TrackCard.js` UI warnings. `LibraryPanel.js` isolates DB-side `addDoc` uploads inside transactional rollbacks against Storage orphans.

---

**Claim 5: The AI receives the workspace state as it exists at message send time.**

*Evidence:* `buildSystemPrompt(getLiveTracks())` retrieves a synchronous buffer reference to the exact moment of the dispatch command (`tracksRef`), natively eliminating the segment modification race condition tied to `Ctrl+S` operations in standard layout event loops. Each reply displays a "Context at HH:MM" timestamp generated from `capturedAt` set at send time.

---

## 6. Limitations and Risks

**What this system cannot be trusted to do:**

- **Export audio accurately for all configurations.** `AudioEngine.renderOffline()` performs an offline render for WAV export, but there is no test verifying the output buffer reflects all per-track settings at export time (gap in coverage — see NFR-009).
- **Guarantee post-deploy correctness.** There are no automated smoke tests that confirm `/api/aiChat`, Firebase Storage, and the auth endpoint are reachable and returning valid responses after each deployment (NFR-012 — not yet implemented).
- **Produce verified track identifications.** AudD fingerprinting accuracy is not gated. A failed or incorrect fingerprint result falls back to Claude filename parsing, which is itself a best-effort inference. Neither is validated against ground truth.
- **Trace which entity made a track change.** `handleUpdateTrack` has no `origin` field. User edits, AudD enrichment, Essentia analysis, and Claude filename parsing are all indistinguishable in state (NFR-011 — not yet implemented).
- **Provide real-time BPM/key analysis in all environments.** Essentia WASM runs in a Web Worker. JSDOM does not support WebAssembly; these tests mock the analyzer. Browser compatibility with WASM is assumed but not tested across all target browsers.
- **Produce unbiased AI mixing suggestions.** The bias disclosure (FR-027) is explicit: Claude's suggestions reflect its training data and may favor well-represented artists and genres.

**Architecture-level constraints verified by design, not by tests:**

- FR-006 (browser-only operation): confirmed by the technology choices; no desktop API or hardware interface exists.
- NFR-006 (responsiveness over fidelity): SoundTouch's `ScriptProcessorNode` is a known trade-off — it may introduce audible artifacts at extreme pitch/tempo values in exchange for real-time responsiveness.

---

## 7. Running the Project Locally

### Prerequisites

- Node.js 20
- A `.env` file at project root with the following variables:

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

### Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vercel dev server (required for /api/* proxy routes)
npm test             # Run test suite
npm run build        # Production build
npm run lint         # ESLint (zero warnings enforced)
npm run emulators    # Start Firebase emulators (Firestore)
```

> **Note:** `npm start` (react-scripts) does not proxy `/api/` requests. Use `npm run dev` (Vercel CLI) for local development with AI and fingerprinting features working.

---

## 8. Repository Structure (Abbreviated)

```
src/
  components/       — AIPanel, AuthScreen, Header, LibraryPanel, MainWorkspace,
                      PlaylistModal, ProfileModal, TrackCard
  firebase/         — firebase.js (useFirebaseAuth), FirebaseService.js
  spotify/          — appContext.js, SpotifyService.js, spotifyAuth.js
  audio/            — AudioEngine.js, useAudioEngine.js
  utils/            — helpers.js, trackConfig.js, useSettings.js
  tests/            — 14 test suites (767 tests)
api/                — Vercel serverless functions (aiChat.js, identifyTrack.js, parseFilename.js)
public/essentia/    — analyzer.worker.js (Essentia WASM worker)
docx/               — Requirements V1.md, Traceability V1.md, Design V1.1.1.md
.github/workflows/  — ci.yml (build → test → analysis → deploy)
```

---

## 9. Requirements and Traceability

Full requirement definitions are in `docx/Requirements V1.md` (FR-001–FR-029, NFR-001–NFR-012).

Full test-to-requirement mapping is in `docx/markdown-versions/Traceability V1.md`.

**Summary of coverage gaps:**

| Requirement | Reason |
|---|---|
| FR-006 (browser-only) | Architecture constraint — verified by design |
| NFR-006 (responsiveness over fidelity) | Subjective quality attribute — not unit-testable |
| NFR-011 (action-origin audit trail) | Feature not yet implemented |
| NFR-012 (post-deploy smoke tests) | Infrastructure not yet implemented |
