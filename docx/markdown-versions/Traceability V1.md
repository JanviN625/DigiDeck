# Requirements Traceability Matrix

Maps each requirement ID to the test file(s) and describe block(s) that cover it.
Requirements with no entry are not yet covered by any test — see the Gaps section at the bottom.

---

## Coverage by Requirement

| Requirement ID | Description (brief) | Test File(s) | Describe Block(s) |
|---|---|---|---|
| FR-001 | BPM/key display per track | trackCard.test.js, libraryPanel.test.js, spotify.test.js | TrackCard — rendering, LibraryPanel — Spotify search results, fetchSpotifyApi |
| FR-002 | Scrub forward/backward | trackCard.test.js, audio.test.js, utils.test.js | TrackCard — audio controls, AudioEngine (seek), useAudioEngine — delegation |
| FR-003 | Simultaneous playback 2+ tracks | appContext.test.js, workspace.test.js, header.test.js | universalIsPlaying, triggerMasterStop, MainWorkspace — rendering, Header — transport controls |
| FR-004 | Pause/resume/restart per track | appContext.test.js, workspace.test.js, trackCard.test.js, header.test.js | handleAddTrack, handleDeleteTrack, handleDuplicateTrack, MainWorkspace — Add New Track button, TrackCard — audio controls, Header — transport controls |
| FR-005 | Per-track EQ/volume isolation | appContext.test.js, trackCard.test.js, audio.test.js, utils.test.js | handleUpdateTrack, TrackCard — volume slider, TrackCard — EQ controls, AudioEngine (setEQ/setVolume), useAudioEngine — delegation |
| FR-007 | Workspace auto-persistence (localStorage) | appContext.test.js | workspace persistence |
| FR-008 | No raw audio data written to storage | appContext.test.js, libraryPanel.test.js | workspace persistence — "saves audioUrl as a string reference", LibraryPanel — upload metadata structure |
| FR-009 | Custom project name/label | header.test.js | Header — project name |
| FR-010 | Conversational AI assistant (Claude) | ai.test.js | AIPanel — rendering, AIPanel — welcome messages, AIPanel — input behaviour, AIPanel — message flow, AIPanel — markdown rendering, system prompt — (all) |
| FR-011 | AI chat responses with reasoning | ai.test.js | AIPanel — message flow, AIPanel — markdown rendering |
| FR-012 | AI does not auto-replace tracks | ai.test.js | API call parameters |
| FR-013 | Manual functionality when AI fails | ai.test.js | API call parameters |
| FR-014 | User can revert pitch/tempo changes | trackCard.test.js | TrackCard — pitch controls, TrackCard — speed controls |
| FR-015 | Authentication (Google OAuth / email) | auth.test.js, authScreen.test.js, firebase.test.js, libraryPanel.test.js, spotify.test.js, header.test.js | Authentication Flow Tests (full file), AuthScreen (full file), useFirebaseAuth (all), LibraryPanel — Spotify section, processCallbackCode, Header — user profile |
| FR-016 | MP3 upload to Firebase Storage + Firestore metadata | firebase.test.js, libraryPanel.test.js, utils.test.js | updateProfilePhoto (storage path), LibraryPanel — file upload, readId3Tags |
| FR-017 | Per-track audio effects | ai.test.js, audio.test.js, trackCard.test.js, utils.test.js | system prompt — effects constraints, AudioEngine (effects), TrackCard — audio effects, useAudioEngine — delegation |
| FR-018 | Track segmentation (start/end/pitch/speed/fade) | ai.test.js, trackCard.test.js, audio.test.js | system prompt — segment data, TrackCard — pitch controls, TrackCard — speed controls, AudioEngine (applyFadeIn/applyFadeOut) |
| FR-019 | Drag-and-drop track reordering | appContext.test.js, workspace.test.js, trackCard.test.js | handleMoveTrack, MainWorkspace — drag and drop, GapZone toIndex calculation, TrackCard — drag state |
| FR-020 | 5-track limit with error message | appContext.test.js, workspace.test.js | handleAddTrack — track limit (max 5), MainWorkspace — Add New Track button, MainWorkspace — track limit error notification |
| FR-021 | AudD audio fingerprinting on upload | libraryPanel.test.js, utils.test.js | LibraryPanel — file upload, spotifyConfirmMatch |
| FR-022 | Claude filename metadata parsing | libraryPanel.test.js, utils.test.js | LibraryPanel — parseFilename fallback, LibraryPanel — file upload, readId3Tags |
| FR-023 | Local BPM/key analysis via Essentia.js | trackCard.test.js, audio.test.js, utils.test.js | TrackCard (essentiaAnalyzer mock), EssentiaAnalyzer (full describe), useAudioEngine — delegation |
| FR-024 | Near real-time audio updates (tempo/pitch) | trackCard.test.js, audio.test.js, utils.test.js | TrackCard — pitch controls, TrackCard — speed controls, AudioEngine (setPitch/setSpeed), useAudioEngine — delegation |
| FR-025 | AI chat session management (up to 5 chats) | ai.test.js | AIPanel — chat management |
| FR-026 | Waveform visual feedback | trackCard.test.js | TrackCard — waveform |
| FR-027 | AI bias disclosure to users | ai.test.js | AIPanel — bias disclosure |
| NFR-001 | AI suggestions are optional / no auto-apply | ai.test.js | API call parameters |
| NFR-002 | Data privacy (Spotify, Claude, AudD only) | ai.test.js, libraryPanel.test.js, spotify.test.js, firebase.test.js | AIPanel — data privacy, LibraryPanel — data privacy during upload, fetchSpotifyApi — "only sends the Authorization header to api.spotify.com URLs", saveSpotifyToken / deleteSpotifyToken |
| NFR-003 | User settings persistence (keybinds, defaults) | workspace.test.js, header.test.js, utils.test.js, profileModal.test.js | MainWorkspace — settings defaults on Add New Track, DEFAULT_SETTINGS shape, matchesKeybind, formatKeybind, useSettings, ProfileModal — Controls tab |
| NFR-004 | Profile management (name, email, photo) | firebase.test.js, header.test.js, profileModal.test.js | useFirebaseAuth — updateDisplayName, updateProfilePhoto, removeProfilePhoto, updateUserEmail, Header — user profile, ProfileModal — General tab |
| NFR-005 | Pitch/tempo degradation warning | trackCard.test.js, ai.test.js | TrackCard — quality (G6) warning, system prompt — pitch constraint, system prompt — BPM constraint |
| NFR-007 | Error notifications for API/network failures | libraryPanel.test.js | LibraryPanel — upload error notification, LibraryPanel — delete error notification |
| NFR-008 | Copyright disclaimer shown on upload | libraryPanel.test.js | LibraryPanel — copyright disclaimer |
| NFR-009 | Export / offline render | header.test.js | Header — Export and Mix Preview |

---

## Coverage by Test File

| Test File | Requirement IDs Covered |
|---|---|
| auth.test.js | FR-015 |
| authScreen.test.js | FR-015 |
| firebase.test.js | FR-015, FR-016, NFR-002, NFR-004 |
| appContext.test.js | FR-003, FR-004, FR-005, FR-007, FR-008, FR-019, FR-020 |
| workspace.test.js | FR-003, FR-004, FR-019, FR-020, NFR-003 |
| trackCard.test.js | FR-001, FR-002, FR-004, FR-005, FR-014, FR-017, FR-018, FR-019, FR-023, FR-024, FR-026, NFR-005 |
| audio.test.js | FR-002, FR-005, FR-017, FR-018, FR-023, FR-024 |
| ai.test.js | FR-010, FR-011, FR-012, FR-013, FR-017, FR-018, FR-025, FR-027, NFR-001, NFR-002, NFR-005 |
| libraryPanel.test.js | FR-001, FR-008, FR-015, FR-016, FR-021, FR-022, NFR-002, NFR-007, NFR-008 |
| spotify.test.js | FR-001, FR-015, NFR-002 |
| header.test.js | FR-003, FR-004, FR-009, FR-015, NFR-003, NFR-004, NFR-009 |
| profileModal.test.js | FR-015, NFR-003, NFR-004 |
| utils.test.js | FR-002, FR-005, FR-016, FR-017, FR-021, FR-022, FR-023, FR-024, NFR-003 |

---

## Gaps — No Test Coverage

| Requirement ID | Description | Reason |
|---|---|---|
| FR-006 | Browser-only operation, no hardware required | Architecture-level constraint — verified by design, not unit-testable |
| NFR-006 | Responsiveness prioritized over audio fidelity | Subjective quality attribute — not unit-testable with Jest |
