# Conversation Log — Requirement Testing & Traceability

**Project:** DigiDeck
**Branch:** trust-gate-testing
**Topics:** Requirements traceability, Jest test coverage, ESLint fixes, CI/CD readiness

---

## Pre-Compacted Session Summary

> The following is a condensed summary of the earlier portion of this conversation before context compaction occurred.

### What Was Done

#### 1. Inline Requirement ID Annotations
Added `// [FR-xxx]` annotations to describe blocks across:
- `trackCard.test.js` — 9 describe blocks annotated; new `TrackCard — waveform` describe added for FR-026
- `audio.test.js` — 12 nested describes annotated (seek, setVolume, setEQ, setPitch, setSpeed, addEffect, removeEffect, setEffectEnabled, setEffectParam, applyFadeIn, applyFadeOut, EssentiaAnalyzer)
- `profileModal.test.js` — NFR-004 and NFR-003 annotations added

#### 2. Missing Requirements Identified & Implemented
Three UI gaps were implemented in source code:

**(a) Copyright disclaimer in LibraryPanel** (replaced old upload tip):
```jsx
<div className="flex items-center gap-1.5 mt-1 mb-1 px-1.5 py-1.5 bg-red-950/25 border border-red-800/35 rounded-lg">
    <AlertTriangle size={11} className="text-red-400 shrink-0" />
    <span className="text-[10px] text-red-300/90 leading-snug flex-1">
        Only upload files you own or have rights to use. Uploading copyrighted material without permission may violate applicable laws.
    </span>
    <button onClick={() => setUploadTipDismissed(true)} className="text-red-600 hover:text-red-400 transition-colors shrink-0" title="Dismiss">
        <X size={10} />
    </button>
</div>
```

**(b) AI bias warning in AIPanel** (persistent message before chat):
```jsx
<div className="flex items-end gap-2">
    <Avatar size="sm" icon={<Bot size={14} />} classNames={{ base: 'bg-base-700 shrink-0', icon: 'text-base-300' }} />
    <div className="bg-base-800 border border-base-700 rounded-2xl rounded-bl-none px-3.5 py-2.5 max-w-[85%] shadow-sm">
        <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={10} className="text-red-400 shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Heads up</span>
        </div>
        <p className="text-[12px] text-base-200 leading-relaxed">
            Track suggestions are based on training data and may be inaccurate. BPM, key, and energy values shown are measured directly from your audio -- not guessed.
        </p>
    </div>
</div>
```

**(c) User-facing error UI** (replaced `console.error` in LibraryPanel):
- `uploadError` and `deleteError` state variables added
- Red dismissable banners rendered on upload/delete failure
- `setUploadError(null)` / `setDeleteError(null)` called at start of each operation

#### 3. Tests Written for New UI
- `libraryPanel.test.js`: copyright disclaimer (3 tests), upload error notification (3 tests), delete error notification (3 tests)
- `ai.test.js`: bias disclosure (4 tests)

#### 4. Test Fixture — `src/tests/fixtures/120bpm_Fmaj.wav`
User created a WAV fixture in Audacity:
- Rhythm track: 120 BPM, 4/4, 8 measures, "Ping" metronome sound
- Tone layer: sine wave, amplitude 0.3, same duration
- Exported at 44100 Hz
- Originally intended as C major but Audacity's generation shifted the key to F major — renamed accordingly

#### 5. Essentia.js KeyExtractor Bug (Investigated & Reverted)
Initially identified `0.0001` in the KeyExtractor call as a rogue parameter causing a tritone misidentification. The fix (removing it) was applied but immediately broke BPM/key detection in the live app.

**Root cause of revert:** The `0.0001` is `spectralPeaksThreshold` — its correct default value. The full 15-argument signature is:
```
audio, averageDetuningCorrection, frameSize, hopSize, hpcpSize,
maxFrequency, maximumSpectralPeaks, minFrequency, pcpThreshold,
profileType, sampleRate, spectralPeaksThreshold, tuningFrequency,
weightType, windowType
```
Both `public/essentia/analyzer.worker.js` and `build/essentia/analyzer.worker.js` were restored to the original working call.

The F major detection from the fixture is a result of insufficient tonal content in the Audacity-generated tone layer (single quiet sine wave), not a code bug.

#### 6. Requirements Genuinely Untestable with Jest
- FR-023 (WASM): Essentia runs in a Web Worker; JSDOM has no WebAssembly support
- FR-002 (scrub accuracy): requires real AudioContext
- FR-003 (true concurrent audio): requires real WebAudio
- FR-005/FR-017 (audio isolation): requires DSP output verification
- NFR-009 (export accuracy): requires offline render with real AudioBuffer
- FR-024 (real-time DSP): SoundTouch/ScriptProcessorNode not available in JSDOM
- **Recommended:** Playwright with real Chromium for these scenarios

---

## Current Session

---

### Exchange 1

**User:** Renamed fixture to `120bpm_Fmaj.wav`. Let's improve requirement testing.

**Assistant:** Audited all 13 test files against the full FR-001–027 / NFR-001–009 requirements list.

**Gaps found:**

| Gap | Where to add |
|---|---|
| FR-022 `/api/parseFilename` fallback path completely untested | `libraryPanel.test.js` |
| FR-008 no test verifying `addDoc` saves only URL refs (not binary) | `libraryPanel.test.js` |
| FR-008 workspace localStorage never checked for absence of binary fields | `appContext.test.js` |

**Tests added:**

**`appContext.test.js`** — inside `workspace persistence` describe:
```js
it('saves audioUrl as a string reference — no raw audio binary fields', () => { // [FR-008]
    const { result } = renderMix();
    act(() => { capturedAuthCallback({ uid: 'user_persist' }); });
    act(() => {
        result.current.handleAddTrack({
            title: 'Track With Audio',
            audioUrl: 'https://storage.firebase.example/audio.mp3',
        });
    });
    act(() => { jest.advanceTimersByTime(600); });
    const saved = JSON.parse(localStorage.getItem('digideck_workspace_user_persist'));
    const trackWithAudio = saved.find(t => t.audioUrl);
    expect(trackWithAudio).toBeDefined();
    expect(typeof trackWithAudio.audioUrl).toBe('string');
    expect(trackWithAudio.audioBuffer).toBeUndefined();
    expect(trackWithAudio.audioData).toBeUndefined();
});
```

**`libraryPanel.test.js`** — two new describes:

`LibraryPanel — parseFilename fallback` [FR-022]:
- calls `/api/parseFilename` when fingerprinting returns no result
- uses parseResult title/artist in `addDoc` when fingerprinting fails
- falls back to filename stem when both APIs fail

`LibraryPanel — upload metadata structure` [FR-008]:
- `addDoc` is called with `downloadUrl` as a string; no `audioFile`, `audioData`, `audioBuffer`, or `fileContents` fields present

File headers updated: `appContext.test.js` gains `[FR-008]`; `libraryPanel.test.js` gains `[FR-008]`.

**Result:** 87 tests pass across both files.

---

### Exchange 2

**User:** Why are all tests passing but a suite failed when running `npm test -- --coverage --watchAll=false`?

**Assistant:** Ran full coverage run and isolated the failure to `firebase.test.js`:

```
SyntaxError: Unexpected token, expected "," (419:6)
```

**Root cause:** The `// [NFR-004]` inline annotation was placed inside the `describe()` argument list instead of after the opening brace — four times:

```js
// BROKEN — comment sits where the callback argument should be:
describe('useFirebaseAuth — updateDisplayName', // [NFR-004] () => {

// CORRECT:
describe('useFirebaseAuth — updateDisplayName', () => { // [NFR-004]
```

**Lines affected in `firebase.test.js`:**
- Line 415: `updateDisplayName`
- Line 463: `updateProfilePhoto`
- Line 520: `removeProfilePhoto`
- Line 579: `updateUserEmail`

All four fixed. Firebase suite now passes all 40 tests.

---

### Exchange 3

**User:** What other requirements are missing from tests?

**Assistant:** Ran a full cross-file audit of all requirement IDs mentioned in test files.

**Combined covered set:**
- FR: 001–005, 007–027 (all except FR-006)
- NFR: 001–005, 007–009 (all except NFR-002 properly, NFR-006)

**Gaps:**

| ID | Requirement | Testable with Jest? |
|---|---|---|
| FR-006 | Browser-only, no hardware required | No — architecture constraint |
| NFR-002 | No data sharing outside Spotify/Claude/AudD | Partially — can verify fetch URLs |
| NFR-006 | Responsiveness over audio fidelity | No — subjective quality attribute |

FR-006 and NFR-006 are architecture-level and cannot be expressed as unit tests.

NFR-002 is actionable: spy on `global.fetch` and assert only allowed hostnames/routes are called.

---

### Exchange 4

**User:** Yes (add NFR-002 tests).

**Assistant:** Added NFR-002 describe blocks to three files:

**`ai.test.js`** — `AIPanel -- data privacy` [NFR-002] (3 tests):

```js
it('all fetch calls during a conversation go only to /api/aiChat', async () => {
    // ... send message, then:
    const allUrls = global.fetch.mock.calls.map(call => call[0]);
    expect(allUrls.every(url => url === '/api/aiChat')).toBe(true);
});

it('workspace data is not sent to any external URL directly', async () => {
    // ...
    expect(allUrls.every(url => !url.startsWith('http'))).toBe(true);
    expect(allUrls.every(url => !url.includes('anthropic.com'))).toBe(true);
});

it('sending multiple messages still only calls /api/aiChat', async () => {
    // Sets up two sequential mockResolvedValueOnce responses on one mock
    // so call count accumulates correctly across both messages
});
```

**`libraryPanel.test.js`** — `LibraryPanel -- data privacy during upload` [NFR-002] (2 tests):
```js
it('only calls internal proxy routes during upload — no direct third-party API calls', async () => {
    const allowedRoutes = ['/api/identifyTrack', '/api/parseFilename'];
    const allUrls = global.fetch.mock.calls.map(call => call[0]);
    expect(allUrls.every(url => allowedRoutes.includes(url))).toBe(true);
});

it('does not send audio data to any URL outside the internal proxy', async () => {
    expect(allUrls.every(url => !url.startsWith('http'))).toBe(true);
});
```

**`spotify.test.js`** — added to existing `fetchSpotifyApi` describe [NFR-002] (1 test):
```js
it('only sends the Authorization header to api.spotify.com URLs', async () => {
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/api\.spotify\.com\//);
    expect(options.headers.Authorization).toBe('Bearer mock_token');
});
```

**Bug encountered and fixed during this exchange:**

The "sending multiple messages" test initially failed because `mockFetch()` replaces `global.fetch` entirely, resetting the call count to 0. Fix: set up both responses on one mock upfront using chained `mockResolvedValueOnce`:
```js
global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ content: 'first response' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ content: 'second response' }) });
```

**Result:** 201 tests pass across the three files.

---

### Exchange 5

**User:** Build works, tests work. Fix npm lint errors and any other workflow errors to ensure merge to main is successful.

**Assistant:** Checked the CI workflow (`ci.yml`). Pipeline is: `build` → `test` → `analysis` (ESLint via `npm run lint`) → `deploy`.

Ran `npx eslint src --ext .js,.jsx --max-warnings=0`:

```
src/tests/libraryPanel.test.js
  511:15  error  Prefer `findByText` query over using `waitFor` + `getByText`  testing-library/prefer-find-by
  526:15  error  ...
  541:15  error  ...
  572:15  error  ...
  587:15  error  ...
  602:15  error  ...

✖ 6 problems (6 errors, 0 warnings)
```

All 6 errors were the same pattern — `waitFor(() => expect(screen.getByText(...)).toBeInTheDocument())` should be `expect(await screen.findByText(...)).toBeInTheDocument()`.

**Lines fixed** (upload error and delete error notification describes):

| Line | Before | After |
|---|---|---|
| 511 | `await waitFor(() => expect(screen.getByText(/Storage quota exceeded/i)).toBeInTheDocument())` | `expect(await screen.findByText(/Storage quota exceeded/i)).toBeInTheDocument()` |
| 526 | `await waitFor(() => expect(screen.getByText(/Upload failed/i))...)` | `expect(await screen.findByText(/Upload failed/i)).toBeInTheDocument()` |
| 541 | `await waitFor(() => expect(screen.getByText(/First error/i))...)` | `expect(await screen.findByText(/First error/i)).toBeInTheDocument()` |
| 572 | `await waitFor(() => expect(screen.getByText(/Permission denied/i))...)` | `expect(await screen.findByText(/Permission denied/i)).toBeInTheDocument()` |
| 587 | `await waitFor(() => expect(screen.getByText(/Delete failed/i))...)` | `expect(await screen.findByText(/Delete failed/i)).toBeInTheDocument()` |
| 602 | `await waitFor(() => expect(screen.getByText(/First delete error/i))...)` | `expect(await screen.findByText(/First delete error/i)).toBeInTheDocument()` |

Note: Lines using `queryByText(...).not.toBeInTheDocument()` (absence checks) were correctly left as `waitFor` — `findByText` cannot be used for asserting absence.

**Final state:**
- `npm run lint` — 0 errors, 0 warnings
- `npm test -- --coverage --watchAll=false` — 13/13 suites, 720/720 tests pass
- `npm run build` — clean

Branch is ready to merge to main.

---

### Exchange 6

**User:** Update `Traceability V1.md` since extra requirements were added.

**Assistant:** Rewrote the traceability matrix. Changes from previous version:

**Moved out of Gaps (now covered):**

| ID | Test File | Describe Block |
|---|---|---|
| FR-008 | appContext.test.js, libraryPanel.test.js | workspace persistence, LibraryPanel — upload metadata structure |
| FR-014 | trackCard.test.js | TrackCard — pitch controls, TrackCard — speed controls |
| FR-026 | trackCard.test.js | TrackCard — waveform |
| FR-027 | ai.test.js | AIPanel — bias disclosure |
| NFR-007 | libraryPanel.test.js | LibraryPanel — upload error notification, LibraryPanel — delete error notification |
| NFR-008 | libraryPanel.test.js | LibraryPanel — copyright disclaimer |

**Updated entries:**
- **NFR-002** — expanded from firebase.test.js (token scoping only) to 4 files with dedicated privacy describes
- **NFR-005** — now includes `TrackCard — quality (G6) warning` in trackCard.test.js in addition to AI system prompt tests
- **FR-022** — now includes dedicated `LibraryPanel — parseFilename fallback` describe

**Remaining gaps (only 2):**
- FR-006: browser-only constraint — verified by architecture
- NFR-006: responsiveness over fidelity — subjective quality attribute

---

## Final Test Count

| Suite | Tests |
|---|---|
| auth.test.js | — |
| authScreen.test.js | — |
| firebase.test.js | 40 |
| appContext.test.js | — |
| workspace.test.js | — |
| trackCard.test.js | — |
| audio.test.js | — |
| ai.test.js | 91 |
| libraryPanel.test.js | — |
| spotify.test.js | — |
| header.test.js | — |
| profileModal.test.js | — |
| utils.test.js | — |
| **Total** | **720 passing, 13/13 suites** |

## Files Modified This Session

| File | Change |
|---|---|
| `src/tests/appContext.test.js` | Added FR-008 test to workspace persistence; updated header |
| `src/tests/libraryPanel.test.js` | Added FR-022, FR-008, NFR-002 describes; updated header; fixed 6 ESLint prefer-find-by errors |
| `src/tests/ai.test.js` | Added FR-027 bias disclosure describe; added NFR-002 data privacy describe; updated header |
| `src/tests/spotify.test.js` | Added NFR-002 test to fetchSpotifyApi; updated header |
| `src/tests/firebase.test.js` | Fixed 4 broken `// [NFR-004]` annotations (comment inside describe arg list) |
| `public/essentia/analyzer.worker.js` | Reverted incorrect KeyExtractor parameter removal (0.0001 is spectralPeaksThreshold, not a rogue arg) |
| `build/essentia/analyzer.worker.js` | Same revert as public/ copy |
| `docx/markdown-versions/Traceability V1.md` | Full rewrite — 6 requirements moved from Gaps to Coverage; NFR-002, NFR-005, FR-022 entries updated |
