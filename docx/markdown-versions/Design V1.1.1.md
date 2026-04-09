# Design v1.1.1 — Pipeline-Aware Mapping
**Project:** AI-Enhanced Music Mashup Studio
**Principle:** If the pipeline cannot see it, it cannot evaluate it.

---

# 1. Requirements-to-Components Mapping

| Req ID | Requirement Summary | Component(s) | AI Involved? | Trust Risk |
|--------|---------------------|-------------|--------------|-----------|
| FR-001 | Display BPM & key per track | TrackCard.js, essentiaAnalyzer.js, SpotifyService | No | Low |
| FR-002 | Scrub forward/backward | TrackCard.js (WaveSurfer), AudioEngine.js | No | Low |
| FR-003 | Simultaneous playback 2+ tracks | AudioEngine.js, appContext.js (universalIsPlaying) | No | Med |
| FR-004 | Pause/resume/restart per track | AudioEngine.js, TrackCard.js | No | Low |
| FR-005 | Per-track EQ/volume isolation | AudioEngine.js (setEQ/setVolume), TrackCard.js | No | Med |
| FR-006 | Browser-only, no hardware required | App.js, AudioEngine.js (Web Audio API) | No | Med |
| FR-007 | Auto-persist workspace to localStorage | appContext.js (debounced write, UID-scoped; amber banner on quota failure) | No | High |
| FR-008 | No raw audio data written to storage | appContext.js, LibraryPanel.js | No | Med |
| FR-009 | Custom project name | Header.js (projectName state) | No | Low |
| FR-010 | Conversational AI assistant (Claude) | AIPanel.js, buildSystemPrompt() | Yes | High |
| FR-011 | AI responses with reasoning | AIPanel.js (MarkdownMessage renderer) | Yes | High |
| FR-012 | AI does not auto-replace tracks | AIPanel.js (system prompt constraint) | Yes | High |
| FR-013 | Manual fallback when AI fails | AIPanel.js (catch block → error message in chat) | Yes | High |
| FR-014 | Revert pitch/tempo changes | TrackCard.js (reset buttons per segment) | No | Low |
| FR-015 | Auth — Google OAuth / email+password | AuthScreen.js, firebase.js (useFirebaseAuth) | No | High |
| FR-016 | MP3 upload → Firebase Storage + Firestore | LibraryPanel.js, FirebaseService.js | No | High |
| FR-017 | Per-track audio effects (reverb, delay, compressor, HPF, LPF, panner, volume) | AudioEngine.js, TrackCard.js (EFFECT_CONFIGS) | No | Med |
| FR-018 | Track segmentation (start/end/pitch/speed/fade per region) | TrackCard.js (initialSegments), AudioEngine.js | No | Med |
| FR-019 | Drag-and-drop track reordering | MainWorkspace.js, appContext.js (handleMoveTrack) | No | Low |
| FR-020 | 5-track limit with error message | appContext.js (handleAddTrack), MainWorkspace.js | No | Low |
| FR-021 | AudD fingerprinting on upload | LibraryPanel.js, helpers.js (spotifyConfirmMatch) | No | Med |
| FR-022 | Claude filename metadata parsing | LibraryPanel.js, helpers.js | Yes | Med |
| FR-023 | Local BPM/key analysis via Essentia.js (30 s timeout) | essentiaAnalyzer.js, TrackCard.js | No | Med |
| FR-024 | Near real-time pitch/tempo audio updates | AudioEngine.js (SoundTouch), TrackCard.js | No | Med |
| FR-025 | AI chat session management (up to 5) | AIPanel.js (chats state, localStorage) | Yes | Low |
| FR-026 | Waveform visual feedback | TrackCard.js (WaveSurfer.js) | No | Low |
| FR-027 | AI bias disclosure to users | AIPanel.js (persistent banner above messages) | Yes | Med |
| FR-028 | Cloud project save / load | FirebaseService.js (saveProject/loadProject/getUserProjects/deleteProject), Header.js | No | High |
| FR-029 | AI context timestamp on each reply | AIPanel.js (capturedAt field, "Context at HH:MM" label) | Yes | Low |
| NFR-001 | AI suggestions optional, no auto-apply | AIPanel.js (system prompt constraint) | Yes | Med |
| NFR-002 | Data privacy — no third-party sharing beyond approved APIs | AIPanel.js, LibraryPanel.js, SpotifyService | No | High |
| NFR-003 | Settings/keybind persistence per user | useSettings.js, ProfileModal.js (Controls tab) | No | Med |
| NFR-004 | Profile management (name, email, photo) | ProfileModal.js (AccountModal), firebase.js | No | Med |
| NFR-005 | Pitch/tempo degradation warning | TrackCard.js (G2 warning) | No | Low |
| NFR-006 | Responsiveness over audio fidelity | AudioEngine.js (SoundTouch, ScriptProcessorNode) | No | Med |
| NFR-007 | Error notifications for API/network failures | LibraryPanel.js (upload/delete errors), AIPanel.js | No | Low |
| NFR-008 | Copyright disclaimer on upload | LibraryPanel.js | No | Low |
| NFR-009 | Export / offline render | Header.js (handleExport), AudioEngine.js (renderOffline) | No | Med |
| NFR-010 | APP_CAPABILITIES derived from EFFECT_CONFIGS at runtime | trackConfig.js (buildEffectsCapabilities()), AIPanel.js | No | Med |
| NFR-011 | Action-origin audit trail on handleUpdateTrack | appContext.js (handleUpdateTrack — origin field not yet added) | No | Low |
| NFR-012 | Post-deploy smoke tests for critical API endpoints | CI/CD pipeline (not yet implemented) | No | Med |

---

⚠ Requirements involving AI: FR-010, FR-011, FR-012, FR-013, FR-022, FR-027, FR-029, NFR-001
⚠ Likely silent failures: FR-008, FR-013, NFR-002

---

# 2. AI Entry Points

The AI layer is a conversational Claude interface (claude-haiku-4-5) with full workspace context injected on every request. There is no scoring system, no structured recommendation object, and no separate AI service layer.

| Component | AI Activity | Observable Signal | Risk |
|-----------|-------------|-------------------|------|
| `AIPanel.js` → `handleSend()` | Sends user message + serialized workspace context to Claude API | Response text rendered in chat via MarkdownMessage; "Context at HH:MM" timestamp on each reply | Caught errors appended as chat message; silent only if catch itself throws |
| `buildSystemPrompt(tracks)` | Reconstructs full workspace state (all tracks, BPM, key, Camelot, energy, segments, EQ, effects) into a system prompt string | System prompt passed on every API request | Stale if track state updates between composing a message and hitting send |
| `buildSegmentLines(segs)` | Flattens per-segment state (pitch, speed, fades, EQ, effects) into readable prompt lines | Segment block within system prompt | Mismatch if AudioEngine segment state desyncs from React state |
| `buildEffectsCapabilities()` (trackConfig.js) | Generates effects capabilities block from EFFECT_CONFIGS at runtime; injected into every system prompt | Dynamic string in prompt — reflects current effect definitions | No longer drifts silently when controls change (NFR-010) |
| `LibraryPanel.js` → Claude (FR-022) | Sends filename string to Claude for title/artist parsing when ID3 and AudD both fail | Parsed `{ title, artist }` applied to track as fallback metadata | Claude-parsed metadata may be inaccurate; only applied when both other methods fail |

---

# 3. Components-to-Pipeline Mapping

| Component | Pipeline Stage | Why | Observable Behavior |
|-----------|---------------|-----|---------------------|
| `App.js` | Build, Deploy | Root; renders AuthScreen when unauthenticated | App loads; workspace blocked until sign-in |
| `AuthScreen.js` | Build, Test, Deploy | Auth gate (FR-015) | Auth form renders; workspace inaccessible until authenticated |
| `firebase.js` (useFirebaseAuth) | Build, Test, Deploy | Auth state + profile operations | User object resolves; sign-in/sign-out work |
| `appContext.js` | Build, Test | All workspace state, undo/redo, localStorage persistence, quota error notification | Track mutations persist; undo/redo work across 50 steps; amber banner shown on quota failure |
| `LibraryPanel.js` | Build, Test | MP3 upload, Spotify catalog search, playlist browsing | Files upload to Firebase; Spotify search and playlists return results |
| `PlaylistModal.js` | Build, Test | Playlist track browsing and add-to-workspace | Modal renders playlist tracks; local and non-track items filtered; empty/error states shown |
| `MainWorkspace.js` | Build, Test | Drag-and-drop reorder, track limit enforcement | Track reorder updates state; 6th distinct song add shows error |
| `TrackCard.js` | Build, Test | All per-track UI — playback, EQ, pitch, speed, effects, segments, waveform | Controls render; pitch/speed/EQ/effects update audio in real time |
| `AudioEngine.js` | Build, Test | Playback, SoundTouch pitch/speed, EQ, effects chain, offline render | Playback works; all per-track parameters apply without affecting other tracks |
| `essentiaAnalyzer.js` | Build, Test | Client-side BPM and key analysis; 30 s timeout on worker non-response | BPM and key populated without a network call; analysis failure rejects with timeout error |
| `useAudioEngine.js` | Build, Test | Hook delegating TrackCard controls to AudioEngine | TrackCard state changes reach AudioEngine correctly |
| `AIPanel.js` | Build, Test | Claude chat, session management (up to 5), bias disclosure, context timestamp | Messages render; API errors shown as chat messages; "Context at HH:MM" shown per reply; session create/delete works |
| `Header.js` | Build, Test, Deploy | Transport controls, project name, undo/redo, export, cloud save/load | Export triggers offline render + WAV download; Save writes to Firestore and shows Saved!/Failed; Load modal lists and restores saved projects |
| `ProfileModal.js` | Build, Test | Account tab (name, email, photo) + Controls tab (keybinds, defaults) | Profile changes reflect immediately; keybinds saved and applied |
| `useSettings.js` | Build, Test | Keybind and default settings persistence per user | Keybinds fire on keydown; settings persist across reload |
| `helpers.js` | Build, Test | ID3 parsing, AudD confirm match, Spotify query builder, keybind utils | Utility functions return expected values |
| `trackConfig.js` | Build, Test | EFFECT_CONFIGS definitions; buildEffectsCapabilities() for system prompt | Effects block in system prompt reflects current EFFECT_CONFIGS at runtime |
| `spotifyApi.js` / SpotifyService | Build, Test, Deploy | Spotify OAuth flow, playlist fetch, catalog search | OAuth completes; playlists and search results return data |
| `FirebaseService.js` | Build, Test, Deploy | Firebase Storage upload/download, Firestore metadata CRUD, project save/load/delete | Uploaded files retrievable across sessions; named projects saved and loaded across devices |

---

# 4. Trust Gates

## G1 — Auth Gate (FR-015)
- No workspace content or user data is accessible before a user authenticates.
- `App.js` renders `<AuthScreen />` when `user` is null.
- Workspace localStorage is UID-scoped: `digideck_workspace_${user.uid}`.
- Failure → workspace never loads.

## G2 — Audio Quality Warning (NFR-005)
- Pitch shift beyond ±3 semitones or speed outside [0.85–1.15] triggers a visible warning in `TrackCard.js`.
- Covered by `trackCard.test.js` (quality warning) and `ai.test.js` (system prompt pitch/BPM constraint).

## G3 — AI Non-Replacement Guard (FR-012)
- Claude's system prompt explicitly prohibits any action that would modify tracks without user initiation.
- No track is added, removed, or reordered by the AI; all workspace changes require an explicit user gesture.
- Covered by `ai.test.js` (API call parameters).

## G4 — Track Limit Enforcement (FR-020)
- `handleAddTrack` in `appContext.js` blocks addition of a 6th distinct base song and sets `trackLimitError`.
- `MainWorkspace.js` surfaces the error message to the user.
- Covered by `appContext.test.js` and `workspace.test.js`.

## G5 — API Failure Visibility (NFR-007)
- Upload and delete errors in `LibraryPanel.js` surface as UI notifications.
- Claude API errors are caught in `AIPanel.js` and appended as a chat message — not silently swallowed.
- Covered by `libraryPanel.test.js` (upload/delete error notifications).

## G6 — AI Context Freshness (FR-010, FR-029)
- `buildSystemPrompt(tracks)` is called inside `handleSend()` using the live `tracks` array from `useMix()`.
- Workspace state passed to Claude always reflects the current mix at send time.
- Each AI reply displays a "Context at HH:MM" timestamp so users can judge whether advice reflects their current mix.
- Failure mode: `initialSegments` in React state may lag if a segment is cut after the last track update without a re-render.

---

# 5. Failure Visibility Analysis

| Component | Failure | Detection | Status |
|-----------|---------|-----------|--------|
| `AIPanel.js` | Claude API error (network, key, rate limit) | Yes — error appended as chat message | Covered |
| `AIPanel.js` | Stale workspace context injected | Yes — "Context at HH:MM" timestamp on each AI reply (FR-029) | Covered |
| `LibraryPanel.js` | AudD fingerprint returns no match | Yes — falls back to ID3 / Claude parse | Covered |
| `LibraryPanel.js` | Firebase upload failure | Yes — `uploadError` state shown in UI | Covered |
| `FirebaseService.js` | Partial Firestore metadata write | Partial — no round-trip validation | Open |
| `essentiaAnalyzer.js` | BPM/key analysis worker never responds | Yes — 30 s timeout rejects the promise (FR-023) | Covered |
| `AudioEngine.js` | SoundTouch ScriptProcessorNode drops audio | Partial — audible but no UI signal | Open |
| `Header.js` | Firebase project save fails | Yes — Save button shows Saved! on success, Failed on error (FR-028) | Covered |
| `appContext.js` | localStorage write fails (quota exceeded) | Yes — amber banner shown for 5 s when write throws (FR-007) | Covered |
| `trackConfig.js` / `AIPanel.js` | Effects capabilities description drifts from actual controls | Yes — derived from EFFECT_CONFIGS at runtime via buildEffectsCapabilities() (NFR-010) | Covered |

---

# 6. Gap Identification

## Missing Test Coverage
- Segment cut flow (`Ctrl+S`) — no integration test covering playhead-to-segment creation end-to-end
- `AudioEngine.renderOffline()` — no test verifying output buffer reflects all per-track settings at export time
- `buildSystemPrompt()` — no test asserting prompt content matches actual track state

## Missing Trust Gates
- No gate for AudD → Spotify enrichment accuracy (FR-021)
- No gate for `renderOffline()` output fidelity (NFR-009)

## Not Yet Implemented
- **Action-origin tracing** (NFR-011): `handleUpdateTrack` has no `origin` field. It is not possible to distinguish user edits from programmatic updates (AudD enrichment, Essentia analysis, Claude filename parse).
- **Post-deploy smoke tests** (NFR-012): No automated health check verifies that `/api/aiChat`, Firebase Storage, and the auth endpoint are reachable after each deployment.

---

# 7. Previously Identified Risk Items

| ID | Summary | Resolution | Status |
|----|---------|------------|--------|
| FR-029 | Stale AI context — Claude answers with outdated workspace state if the user edits after composing a message | `capturedAt` timestamp added to every AI reply ("Context at HH:MM") in `AIPanel.js` | Implemented — tested (`ai.test.js — AIPanel — context timestamp`) |
| FR-028 | Cloud save/load absent — `handleSave()` was a UI toast with no Firebase write; work lost on localStorage clear or device switch | `FirebaseService.saveProject / loadProject / getUserProjects / deleteProject` implemented; Save/Load UI wired in `Header.js` | Implemented — tested (`header.test.js — Header — Save project / Load project`) |
| NFR-010 | APP_CAPABILITIES hardcoded — AI knowledge of controls drifted silently whenever `EFFECT_CONFIGS` changed | `buildEffectsCapabilities()` in `trackConfig.js` generates the effects block at runtime; called on every system prompt build | Implemented — tested (`ai.test.js — system prompt — effects derived from trackConfig`) |
| NFR-011 | No action-origin audit trail — user edits and programmatic updates (AudD, Essentia, Claude) indistinguishable in `handleUpdateTrack` | Add `origin` field (`'user' \| 'audd' \| 'claude' \| 'essentia'`) to all `handleUpdateTrack` calls | Not yet implemented |
| NFR-012 | No post-deploy smoke tests — broken `/api/aiChat` proxy, stale Firebase config, or revoked Spotify client ID only caught when a real user encounters it | Add health check: auth endpoint, `/api/aiChat` minimal-payload response, Firebase Storage reachability | Not yet implemented |
