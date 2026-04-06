# Requirements v1.4

## A. Functional Requirements

### Must Have

1. [FR-001] - When a user adds a track from Spotify or uploads a local MP3, the system should display that track's BPM and musical key, so that the user can evaluate tempo and harmonic compatibility.  
	- Trust Hypothesis: BPM and key are displayed for every track in the workspace regardless of source type.

2. [FR-002] - When a track is playing, the system should allow the user to scrub forward or backward in time, so that transition points can be manually aligned.  
	- Trust Hypothesis: Scrubbing updates playback position immediately without restarting the track.

3. [FR-003] - When comparing tracks, the system should support simultaneous playback of at least two tracks, so that alignment and compatibility can be evaluated in real time.  
	- Trust Hypothesis: Playing one track does not stop another track that is already playing.

4. [FR-004] - When working on a mashup, the system should allow the user to pause, resume, and restart individual tracks independently, so that the preparation workflow remains flexible.

5. [FR-005] - When a user modifies EQ or volume settings, the system should apply those changes only to the selected track, so that layered mixing remains controllable.  
	- Trust Hypothesis: EQ and volume changes on one track do not affect the audio output of any other track.

6. [FR-006] - When accessing the system, the user should be able to operate entirely within a web browser without requiring specialized DJ hardware, so that the tool remains accessible to all users.

7. [FR-007] - When a user works on a mashup, the system should automatically persist the current workspace state (track references, audio parameters, effects, and segments) to local storage per user account, so that the active session is restored across page reloads without manual save actions.  
	- Trust Hypothesis: Workspace state is restored on next login without any user action.

8. [FR-008] - When storing workspace data, the system should save track references and configuration settings without storing actual audio stream data, so that storage requirements remain minimal and copyright is respected.  
	- Trust Hypothesis: No raw audio data is written to Firestore or local storage at any point.

9. [FR-009] - When a user saves a mashup, the system should allow them to provide a custom name or label, so that multiple projects can be easily distinguished.

10. [FR-010] - When the user requests mixing guidance, the system should provide conversational AI assistance via Claude with full workspace context (track titles, BPM, key, Camelot notation, energy level, source type, effects state, and segment parameters), so that suggestions are directly informed by the current state of the mix.  
	- Trust Hypothesis: The AI receives the complete current workspace context with every message sent.

11. [FR-011] - When an AI response is shown, the system should present suggestions as chat messages with supporting reasoning (e.g., BPM relationships, key compatibility, effect settings, Camelot transitions), so that users understand the basis for each suggestion.

12. [FR-012] - When AI provides recommendations, the system should not automatically replace or reorder user-selected tracks, so that user creative control is preserved.  
	- Trust Hypothesis: No track is added, removed, or reordered without an explicit user action.

13. [FR-013] - When AI recommendations are unavailable or fail, the system should continue to support full manual mashup functionality, so that creative work is not blocked by AI components.  
	- Trust Hypothesis: All track editing, playback, and effect controls remain fully operational when the AI endpoint is unreachable.

14. [FR-014] - When pitch or tempo adjustments are applied, the system should allow the user to disable or revert those changes, so that users retain creative control.

15. [FR-015] - When a user accesses the system, the system should require authentication via Google OAuth or email/password before displaying any workspace content, so that each user's tracks, uploads, and workspace state remain isolated to their account.  
	- Trust Hypothesis: No workspace content or user data is accessible before a user is authenticated.

16. [FR-016] - When a user uploads a local MP3, the system should extract available ID3 metadata (title, artist, cover art) and store the binary file in Firebase Storage under the user's account, while recording the file's metadata (title, artist, download URL, storage path, cover art) in Firestore, so that uploaded files persist across sessions and can be individually deleted by the user.  
	- Trust Hypothesis: Uploaded files are retrievable across sessions via their Firebase Storage URL without re-uploading.

17. [FR-017] - When a user applies audio effects to a track, the system should support per-track independent control of reverb, delay, compressor, high-pass filter, low-pass filter, stereo panner, and volume, so that each track can be shaped without affecting others in the workspace.  
	- Trust Hypothesis: Enabling or adjusting an effect on one track produces no change in the audio output of any other track.

18. [FR-018] - When a user edits a track, the system should allow them to define a segment with a configurable start point, end point, pitch shift, playback speed, fade-in, and fade-out, so that a precise region of the track can be isolated or looped independently.

19. [FR-019] - When a user reorders tracks in the workspace, the system should support drag-and-drop repositioning, so that the track arrangement reflects the intended mix order.  
	- Trust Hypothesis: After a drag-and-drop operation, track order is updated immediately and persisted to local storage.

20. [FR-020] - When the workspace reaches five tracks, the system should prevent additional tracks from being added and display an error message, so that the workspace limit is clearly communicated.  
	- Trust Hypothesis: The add-track action is blocked and an error is shown when five tracks are already present; no sixth track is ever added.

21. [FR-021] - When an uploaded file is added to the workspace, the system should submit the file's audio URL to the AudD audio fingerprinting API to attempt track identification, so that title and artist can be enriched beyond what ID3 tags alone provide.  
	- Trust Hypothesis: AudD results enrich track metadata only; they do not override values the user has set manually.

22. [FR-022] - When a user uploads a file with an unrecognized or ambiguous filename, the system should send the filename to Claude for metadata parsing, so that a best-effort title and artist can be extracted from non-standard naming conventions.  
	- Trust Hypothesis: Claude-parsed metadata is applied as a fallback only when ID3 and AudD both fail to return usable values.

### May Fail

1. [FR-023] - When a track is loaded into the workspace, the system should analyze its BPM and musical key locally using Essentia.js, so that metadata is available without dependency on an external API.  
	- Trust Hypothesis: BPM and key analysis runs entirely client-side and does not require a network call.

2. [FR-024] - When the user adjusts tempo or pitch controls, the system should update audio playback in near real time, so that the user can hear the effect immediately.

3. [FR-025] - When a user manages AI chat sessions, the system should allow up to five saved chats with the ability to create, rename, and delete individual sessions, so that different mixing contexts can be explored separately.

4. [FR-026] - When displaying audio changes, the system should provide visual feedback via waveform display, so that users can observe playback position and track structure without relying solely on audio output.

### Not Guaranteed

1. [FR-027] - When providing AI recommendations, the system should inform users that suggestions may reflect bias toward popular or well-represented artists, so that users understand potential limitations.

## B. Non-Functional Requirements

### Must Have

1. [NFR-001] - When presenting AI recommendations, the system should treat them as optional suggestions rather than authoritative decisions, so that users maintain agency over creative choices.  
	- Trust Hypothesis: The system does not automatically apply AI-recommended settings or tracks without explicit user action.

2. [NFR-002] - When storing user data, the system should not share workspace configurations, uploaded file metadata, or listening patterns with third parties beyond what is required for Spotify API, Claude API, and AudD API functionality, so that user privacy is protected.  
	- Trust Hypothesis: The system does not transmit user data to any service outside of Spotify API, Claude API, and AudD API endpoints.

3. [NFR-003] - When a user configures application settings, the system should persist keyboard shortcut bindings, animation preferences, and default audio values (volume, fade-in/out, zoom level) per user account, so that preferences are maintained across sessions.  
	- Trust Hypothesis: User settings are applied on login and held until the user explicitly changes them.

4. [NFR-004] - When a user manages their profile, the system should allow updates to display name, email, and profile photo (maximum 5 MB) and reflect those changes immediately across the interface, so that the profile remains accurate without a page reload.  
	- Trust Hypothesis: Profile changes are reflected in the interface immediately after confirmation without requiring a logout and login cycle.

### May Fail

1. [NFR-005] - When pitch shift exceeds +/-3 semitones or tempo change exceeds +/-15%, the system should warn users that audio quality degradation may occur, so that users can make informed decisions about extreme adjustments.  
	- Trust Hypothesis: The system displays a warning before applying pitch shifts beyond +/-3 semitones or tempo changes beyond +/-15%.

2. [NFR-006] - When processing audio, the system should prioritize responsiveness and usability over professional-grade audio fidelity, so that the project remains achievable within semester constraints.  
	- Trust Hypothesis: The system may produce audible artifacts or reduced audio quality in exchange for maintaining responsive playback controls.

3. [NFR-007] - When network latency or API limits affect playback or recommendations, the system should notify the user, so that unexpected behavior is not silently hidden.  
	- Trust Hypothesis: The system displays error notifications when Spotify API, Firebase, AudD API, or Claude API failures prevent successful operations.

4. [NFR-008] - When users create mashups, the system does not guarantee copyright compliance or fair-use validation for user-created content, so that users understand their legal responsibilities.  
	- Trust Hypothesis: The system does not validate copyright status or fair-use compliance of user-created mashups.

5. [NFR-009] - When a user initiates an export or mix preview, the system should perform an offline audio render combining all active tracks with their configured effects, EQ, pitch, speed, and segment settings, so that the exported output accurately reflects the full workspace state.  
	- Trust Hypothesis: The offline render reflects all per-track settings active at the time of export, and the user is informed of render progress.