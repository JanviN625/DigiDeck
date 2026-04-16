# Plan 02 — Playback & Audio Engine (Extended Reference)

> Full-detail reference for `02-playback-and-audio.md`.
> Read the short file first, consult this for rationale, component-level specs,
> and implementation guidance.

---

## Component & Style Rules
- **Components:** HeroUI first → Lucide (icons only) → plain Tailwind
- **Colors:** `base` scale from `tailwind.config.js` only (`base-50` … `base-900`)

---

## 1. Why Each Spotify Feature Was Lost & What Replaces It

### `/audio-features` — BPM, key, mode, time signature
Deprecated November 2024 for all new developer apps (403 for new credentials).
Previously used in `spotifyApi.js` (`getAudioFeatures()` and
`getMultipleAudioFeatures()`) to populate the `bpm` and `trackKey` props on
`TrackCard`.

**Replacement: Essentia.js**
- Open-source audio analysis library by Music Technology Group (UPF Barcelona)
- Compiled to WebAssembly — runs entirely in-browser, no server, no API key
- Analyses a raw `AudioBuffer` directly — the same buffer used for playback
- Outputs: BPM, key + mode, beat positions, energy, danceability
- ~4 MB WASM bundle — lazy-loaded only when the first track is added

### `/audio-analysis` — beat grid, waveform segments, section markers
Same deprecation. Previously the intended source for `WaveformDisplay.js`
(which was never fully implemented).

**Replacement: WaveSurfer.js + Essentia.js beat positions**
- WaveSurfer renders waveform directly from the `AudioBuffer`
- Beat positions from Essentia.js are overlaid as markers
- No separate analysis API call needed — everything derives from the buffer

### Spotify Web Playback SDK — playback, volume, device control
The SDK's developer policy explicitly prohibits pitch shifting, tempo changes,
EQ, mixing, and simultaneous multi-track playback. It also requires Spotify
Premium. These constraints make it incompatible with DigiDeck's core purpose.

**Replacement: Web Audio API (native browser)**
- One shared `AudioContext`; each track gets its own node chain
- All tracks feed into `AudioContext.destination` simultaneously
- Full control over pitch, speed, EQ, effects, volume, and fade via node params
- No Premium requirement; no policy constraints on audio manipulation

---

## 2. New Dependencies

### `wavesurfer.js`
Waveform visualisation library. Accepts an `AudioBuffer` or a URL.
Provides a canvas-based waveform, playhead, click-to-seek, and a Regions
plugin for drawing interactive segments. Replaces the static progress bar
overlay in `TrackCard.js`.

### `@mtg/essentia.js`
WebAssembly port of the Essentia C++ audio analysis library.
Provides `BpmHistogram`, `KeyExtractor`, `BeatTrackerMultiFeature`, and
other algorithms. Loaded lazily via dynamic `import()` and run in a
Web Worker to keep the UI thread unblocked during analysis.

### `soundtouchjs`
JavaScript port of the SoundTouch C++ DSP library.
Implements pitch-shifting and time-stretching independently — you can change
pitch without affecting tempo and vice versa.
Integrates with Web Audio API as a `ScriptProcessorNode` or `AudioWorkletNode`.

### No installs needed
`BiquadFilterNode`, `GainNode`, `ConvolverNode`, `DelayNode`,
`DynamicsCompressorNode`, `AnalyserNode`, `OfflineAudioContext` —
all native Web Audio API, available in every modern browser.

---

## 3. AudioBuffer Source Resolution

Every feature in this plan depends on having an `AudioBuffer`. The resolution
order is:

```
Track source = "spotify"
  └─ previewUrl is non-null?
       YES → fetch(previewUrl)
               → response.arrayBuffer()
               → AudioContext.decodeAudioData()
               → AudioBuffer ✓
       NO  → no audio state; TrackCard shows "No audio available" notice
             (HeroUI Chip, bg-base-800, Lucide AlertCircle icon)
             Track remains in mix for metadata/reference but no playback controls

Track source = "upload"
  └─ FileReader.readAsArrayBuffer(file)
       → AudioContext.decodeAudioData()
       → AudioBuffer ✓  (full track length, fully seekable)
```

After `AudioBuffer` is obtained, three things happen in parallel:
1. Essentia.js Worker analyzes it → `{ bpm, key, beatPositions }`
2. WaveSurfer instance is initialized with the buffer
3. `AudioEngine.loadTrack(trackId, audioBuffer)` builds the node chain

---

## 4. AudioEngine Service — `src/audio/AudioEngine.js`

A singleton class managing the shared `AudioContext` and per-track node chains.

### Shared context
```js
const ctx = new AudioContext();
const masterGain = ctx.createGain(); // master volume, feeds ctx.destination
```

### Per-track node chain
Built in `loadTrack(trackId, audioBuffer)`:

```
source  = ctx.createBufferSource()      // AudioBufferSourceNode
st      = new SoundTouchNode(ctx)       // SoundTouchJS — pitch + speed
eqLow   = ctx.createBiquadFilter()     // type: lowshelf,  freq: 200 Hz
eqMid   = ctx.createBiquadFilter()     // type: peaking,   freq: 1000 Hz
eqHigh  = ctx.createBiquadFilter()     // type: highshelf, freq: 8000 Hz
effects = []                           // optional: ConvolverNode, DelayNode, etc.
gain    = ctx.createGain()             // volume + fade automation
analyser= ctx.createAnalyser()         // feeds WaveSurfer playhead sync

source → st → eqLow → eqMid → eqHigh → [effects...] → gain → analyser → masterGain → ctx.destination
```

### Public API
```js
AudioEngine.loadTrack(trackId, audioBuffer)
AudioEngine.play(trackId)
AudioEngine.pause(trackId)
AudioEngine.seek(trackId, timeSeconds)
AudioEngine.setVolume(trackId, value)       // 0.0 – 1.0
AudioEngine.setPitch(trackId, semitones)    // -12 to +12
AudioEngine.setSpeed(trackId, multiplier)   // 0.5 to 2.0
AudioEngine.setEQ(trackId, { low, mid, high }) // dB values -12 to +12
AudioEngine.addEffect(trackId, type, params)
AudioEngine.removeEffect(trackId, effectId)
AudioEngine.applyFadeIn(trackId, seconds)
AudioEngine.applyFadeOut(trackId, seconds)
AudioEngine.unloadTrack(trackId)
AudioEngine.renderOffline(tracks)           // returns Promise<AudioBuffer> for export
```

### `src/audio/useAudioEngine.js`
React hook that gives each `TrackCard` access to its track's engine controls:
```js
const { play, pause, seek, setVolume, setPitch, setSpeed, setEQ, addEffect } =
  useAudioEngine(trackId);
```

---

## 5. BPM + Key Detection — Essentia.js

### `src/audio/essentiaAnalyzer.js`

```js
// Lazy-load Essentia WASM only when first needed
async function analyzeAudioBuffer(audioBuffer) {
  const Essentia = await import('@mtg/essentia.js');
  const essentia = new Essentia(EssentiaWASM);

  const channelData = audioBuffer.getChannelData(0); // mono

  const bpmResult  = essentia.PercivalBpmEstimator(...);
  const keyResult  = essentia.KeyExtractor(...);
  const beats      = essentia.BeatTrackerMultiFeature(...);

  return {
    bpm:           Math.round(bpmResult.bpm),
    key:           pitchClassToKey(keyResult.key, keyResult.scale),
    beatPositions: beats.ticks,        // Float32Array, seconds
  };
}
```

Runs inside a Web Worker (via `new Worker(...)` or Comlink) to avoid
blocking the main thread during the ~1–3 second analysis.

On completion, results are stored in the track object in `MixContext`:
```js
{ ...track, bpm: 128, key: "A minor", beatPositions: Float32Array(...) }
```

`bpm` and `key` populate the existing display slots in `TrackCard`'s header
row (Artist / BPM / Key metadata strip — already rendered, just fed `"[BPM]"`
and `"[key]"` placeholder strings today).

---

## 6. Waveform + Scrubbing — WaveSurfer.js

### Mounting
`WaveSurfer.create()` is called inside a `useEffect` after the `AudioBuffer`
is ready. It mounts into the existing visualizer `div` (the `flex-1 h-full`
container that currently shows the progress bar overlay).

```js
const ws = WaveSurfer.create({
  container: waveformRef.current,
  waveColor:      '#6B3D52',   // base-600
  progressColor:  '#A63A50',   // base-400
  cursorColor:    '#F8FAFC',   // base-50
  barWidth: 2,
  barRadius: 1,
  height: 'auto',
  backend: 'WebAudio',
  audioContext: AudioEngine.ctx,
});
ws.loadDecodedBuffer(audioBuffer);
```

### Beat markers
After Essentia.js returns `beatPositions`, each beat is rendered as a
thin vertical marker on the waveform using WaveSurfer's Markers plugin
(or the Regions plugin with zero-width regions):
- Colour: `base-700` (`#59546C`)
- Non-interactive; purely visual alignment aid

### Scrubbing
`ws.on('seek', (progress) => AudioEngine.seek(trackId, progress * duration))`
Click and drag on the waveform calls `seek()` on the audio engine.
The existing static progress bar overlay is removed entirely.

### Playhead sync
`AnalyserNode` current time is polled on `requestAnimationFrame` and passed
to `ws.setCurrentTime()` to keep the playhead in sync.

---

## 7. Pitch + Speed — SoundTouchJS

### Current state in `TrackCard.js`
- `pitch` state: set by -/+ buttons, stored, never applied to audio
- `speed` state: set by range slider `min=0.85 max=1.15`, stored, never applied

### After
Both controls call `AudioEngine.setPitch()` and `AudioEngine.setSpeed()`
on change, which update the SoundTouchJS node parameters live.

**Speed range expanded:**
- From: `min="0.85" max="1.15" step="0.01"`
- To: `min="0.5" max="2.0" step="0.01"` (matches Design V1 spec; `0.75x`, `1.0x`, `1.25x` as labelled detents)

### Warning Gate G6 (Design V1.1 requirement)
When either threshold is exceeded, show an inline warning:

| Condition | Threshold |
|---|---|
| Pitch warning | `abs(pitch) > 3` semitones |
| Speed warning | `speed < 0.85 or speed > 1.15` |

Warning element: HeroUI `Chip variant="flat"` with Lucide `AlertTriangle`
(`size={12}`) in `startContent`, `classNames={{ base: "bg-base-800 border border-base-400", content: "text-base-300 text-[10px]" }}`.
Message: `"Audible artefacts may occur at this setting."` Audio still applies.

---

## 8. EQ — Web Audio API `BiquadFilterNode`

### Fills `[TODO: find equalizers]` placeholder

Three `BiquadFilterNode` instances already in the audio graph (§4).
The UI connects their `gain.value` to three vertical sliders.

### UI spec (inside the Equalizer collapsible)

```
┌─────────────────────────────────────────┐
│  EQUALIZER                  [ Reset ]   │
│                                         │
│    Lo        Mid       Hi               │
│    ┃         ┃         ┃               │
│    ┃         ┃         ┃  ← HeroUI     │
│    ┃         ┃         ┃    Slider     │
│    ┃         ┃         ┃    vertical   │
│   -12       0dB       +12              │
└─────────────────────────────────────────┘
```

- Three HeroUI `Slider` components, `orientation="vertical"`, `minValue={-12}`,
  `maxValue={12}`, `step={0.5}`, `defaultValue={0}`
- Labels: `"Lo"`, `"Mid"`, `"Hi"` — `text-xs text-base-300 text-center`
- dB readout below each slider: `text-[10px] font-mono text-base-400`
- Reset button: HeroUI `Button variant="light" size="sm"` with Lucide `RotateCcw`
  — sets all three sliders to 0

---

## 9. Effects Chain — Web Audio API

### Fills `[TODO: find audio effects]` placeholder

### Available effects

**Reverb — `ConvolverNode`**
- Impulse response buffer generated programmatically (no audio file needed)
  using a simple exponential decay algorithm
- Control: Dry/Wet mix slider (0–100%), HeroUI `Slider`

**Delay — `DelayNode` + feedback `GainNode`**
- `DelayNode.delayTime.value` in seconds
- Feedback loop: `DelayNode → GainNode(feedback) → DelayNode`
- Controls: Delay time (0–1s), Feedback (0–90%) — HeroUI `Slider` × 2

**Compressor — `DynamicsCompressorNode`**
- Controls: Threshold (-60–0 dB), Ratio (1–20) — HeroUI `Slider` × 2
- Useful for levelling loud uploads before mixing

### Effects section UI spec

```
AUDIO EFFECTS                    [ + Add Effect ▾ ]
┌─────────────────────────────────────────────────┐
│  ≡  Reverb           ● ON    Wet: ──●────  60%  │
│  ≡  Delay            ● ON    Time: ─●────  0.3s │
│                               FB: ──●───  45%   │
└─────────────────────────────────────────────────┘
```

- `[ + Add Effect ]` — HeroUI `Button size="sm" variant="bordered"` →
  HeroUI `Dropdown` with three `DropdownItem` options (Reverb, Delay, Compressor)
- Effect row: drag handle (`≡`, reuses existing drag logic) + name +
  HeroUI `Switch` (on/off) + parameter `Slider`(s)
- Remove: Lucide `X` button, `variant="light" size="sm"`
- Effects chain order matches node graph insertion order

---

## 10. Segment Manager

New UI section inside the expanded TrackCard, appearing between the waveform
and the Settings collapsible.

### Purpose
Define which portion(s) of a track to use in the mix. Mirrors how DJs use
intro/chorus/outro segments rather than full tracks.

### UI

```
SEGMENTS                         [ + Add Segment ]
┌──────────────────────────────────────────────────┐
│  Segment 1   Start: 0:04.200   End: 0:18.700  [✕]│
│  Segment 2   Start: 0:45.000   End: 1:02.500  [✕]│
└──────────────────────────────────────────────────┘
```

- `[ + Add Segment ]` — HeroUI `Button size="sm" variant="bordered"` with
  Lucide `Plus` in `startContent`; creates a default 10-second region
  starting at playhead position
- Each segment row shows `start` and `end` times (formatted as `m:ss.mmm`)
- Times update in real-time as the user drags the region edges in WaveSurfer
- Delete: Lucide `X` HeroUI `Button variant="light" size="sm"`

### WaveSurfer integration
Each segment maps to a WaveSurfer `Region`:
```js
ws.addRegion({ id: seg.id, start: seg.startTime, end: seg.endTime,
               color: 'rgba(140,31,56,0.3)' }); // base-500 at 30% opacity
```
Dragging a region edge fires `ws.on('region-update-end', ...)` → updates
`seg.startTime` / `seg.endTime` in track state → saved to Firestore on next Save.

### Data shape (per segment, stored in track object)
```js
{ id: string, startTime: number, endTime: number }  // seconds
```
Replaces the old `{ startBar, endBar }` bar-based spec — seconds are more
practical given we derive beat grids at runtime from Essentia.js.

---

## 11. Simultaneous Playback

All tracks share one `AudioContext`. Each track's `GainNode` connects to the
shared `masterGain`, which connects to `ctx.destination`. Web Audio API mixes
all connected signals automatically — no additional logic needed.

```
Track 1 gain ─┐
Track 2 gain ─┤─→ masterGain → ctx.destination
Track 3 gain ─┘
```

Play/Pause on each track independently starts/stops its `AudioBufferSourceNode`
without affecting others. This is structurally impossible with the Spotify SDK
(single-device, single-track player).

---

## 12. Export / Preview Full Mix

### Preview Full Mix

Triggered by the Header "Preview Full Mix" button (already present, currently a stub).

```js
const offlineCtx = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
// schedule all tracks, apply all settings (pitch, speed, EQ, effects, fades, segments)
const mixBuffer = await offlineCtx.startRendering();
// play mixBuffer via a new AudioBufferSourceNode on the live AudioContext
```

Loading state: Header button shows HeroUI `Spinner` while rendering.

### Export

Same `OfflineAudioContext` render → encode `AudioBuffer` to WAV:
```js
function audioBufferToWAV(buffer) { /* standard WAV encoding */ }
const blob = new Blob([audioBufferToWAV(mixBuffer)], { type: 'audio/wav' });
const url  = URL.createObjectURL(blob);
const a    = document.createElement('a');
a.href = url; a.download = `${projectName}.wav`; a.click();
```

MP3 encoding via `lamejs` can be added as a follow-up — WAV is sufficient
for an initial implementation and requires no extra dependency.

---

## 13. Files Affected

### Add

| File | Purpose |
|---|---|
| `src/audio/AudioEngine.js` | Singleton Web Audio API graph manager — all playback, pitch, speed, EQ, effects, fade, export |
| `src/audio/useAudioEngine.js` | React hook — exposes per-track engine controls to TrackCard |
| `src/audio/essentiaAnalyzer.js` | Lazy-loads Essentia.js WASM, runs BPM/key/beat analysis in Web Worker |

### Modify

| File | Changes |
|---|---|
| `src/components/TrackCard.js` | Replace progress bar with WaveSurfer waveform; wire all controls to AudioEngine; add Segment Manager UI; expand speed range to 0.5–2.0x; add Gate G6 warnings; fill EQ and Effects placeholders |
| `src/spotify/spotifyContext.js` | Remove `playTrack` export (no longer needed); keep all search, playlist, and metadata functions |
| `src/utils/helpers.js` | Add `pitchClassToKey()` for Essentia key output |
| `package.json` | Add `wavesurfer.js`, `@mtg/essentia.js`, `soundtouchjs` |

### Unchanged

`Header.js`, `LibraryPanel.js`, `MainWorkspace.js`, `AIPanel.js`,
`PlaylistModal.js`, `firebase.js`, `spotifyApi.js` (search, playlist, and track metadata calls remain in use)
