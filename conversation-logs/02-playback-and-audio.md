# Plan 02 — Playback & Audio Engine

## Component & Style Rules
- **Components:** HeroUI first → Lucide (icons only) → plain Tailwind
- **Colors:** `base` scale from `tailwind.config.js` only (`base-50` … `base-900`)

---

## 1. Spotify Deprecation Replacements

| What Spotify Removed | Replacement | Cost | Runs Where |
|---|---|---|---|
| `/audio-features` (BPM, key) | **Essentia.js** | Free | In-browser (WASM) |
| `/audio-analysis` (waveform, beats) | **WaveSurfer.js** + Essentia.js | Free | In-browser |
| Web Playback SDK (playback, volume) | **Web Audio API** | Free | Native browser |
| SDK pitch/tempo/EQ | **SoundTouchJS** + Web Audio API | Free | In-browser |

> AI recommendations replacement is covered later.

---

## 2. New Dependencies

```
wavesurfer.js       — waveform rendering, scrubbing, region/segment display
@mtg/essentia.js    — BPM, key, beat detection via WASM (lazy-loaded ~4MB)
soundtouchjs        — pitch shifting + time stretching via Web Audio API
```
Web Audio API nodes (`BiquadFilterNode`, `GainNode`, `ConvolverNode`, etc.)
are native to the browser — no install needed.

---

## 3. Audio Source Resolution

Every track needs an `AudioBuffer` before anything else runs.

```
Spotify track  →  preview_url present?
                    YES → fetch(preview_url) → decodeAudioData → AudioBuffer
                    NO  → no audio; show "No audio available" state in TrackCard

Uploaded file  →  FileReader / File API → decodeAudioData → AudioBuffer
```

Once an `AudioBuffer` exists:
1. **Essentia.js** analyzes it → stores `bpm`, `key`, `beatPositions` in track state
2. **WaveSurfer.js** renders waveform from it
3. `AudioBufferSourceNode` created and routed through the audio graph

---

## 4. Per-Track Audio Graph

All tracks share one `AudioContext`. Each track owns its own node chain,
all feeding into the same destination — simultaneous playback natively.

```
AudioBufferSourceNode
  └─→ SoundTouchJS node       (pitch shift + time stretch)
        └─→ BiquadFilterNode  (Low shelf EQ)
              └─→ BiquadFilterNode  (Mid peaking EQ)
                    └─→ BiquadFilterNode  (High shelf EQ)
                          └─→ Effects chain
                          │     ConvolverNode  (reverb, optional)
                          │     DelayNode      (delay, optional)
                          │     DynamicsCompressorNode  (compressor, optional)
                          └─→ GainNode         (volume + fade automation)
                                └─→ AnalyserNode   (feeds WaveSurfer playhead sync)
                                      └─→ AudioContext.destination
```

`src/audio/AudioEngine.js` manages this graph and exposes:
`loadTrack()`, `play()`, `pause()`, `seek()`, `setVolume()`, `setPitch()`,
`setSpeed()`, `setEQ()`, `addEffect()`, `removeEffect()`, `applyFade()`,
`renderOffline()`.

---

## 5. BPM + Key — Essentia.js

Replaces deprecated Spotify `/audio-features`.

- Lazy-loaded when first track is added (avoids ~4MB WASM on initial load)
- Runs on `AudioBuffer` via a Web Worker — no UI thread blocking
- Outputs stored in track state: `bpm`, `key` (e.g. `"A minor"`), `beatPositions`
- Beat positions passed to WaveSurfer.js as waveform markers
- `bpm` and `key` displayed in existing TrackCard header slots

**Key format:** Essentia output → `pitchClassToKey()` to be added back to `helpers.js`.

---

## 6. Waveform + Scrubbing — WaveSurfer.js

Replaces the static progress bar in the TrackCard visualizer area.

- Mounts into the existing `flex-1 h-full` visualizer container
- Initialised from the track's `AudioBuffer`
- Beat markers from Essentia.js overlaid as thin vertical lines
- **Scrubbing:** click/drag on waveform → `AudioEngine.seek(time)`
- **Regions plugin:** powers the Segment Manager (§10)

| Waveform element | Color token |
|---|---|
| Waveform fill | `base-600` |
| Played portion | `base-400` |
| Playhead cursor | `base-50` |
| Beat markers | `base-700` |
| Segment regions | `base-500` at 30% opacity |

---

## 7. Pitch + Speed — SoundTouchJS

Wires up the existing no-op controls in TrackCard.

| Control | Before | After |
|---|---|---|
| Pitch `-/+` buttons | Stored, not applied | `AudioEngine.setPitch(semitones)` |
| Speed slider | Stored, not applied | `AudioEngine.setSpeed(multiplier)` |

- Speed range expands: `0.85–1.15x` → `0.5–2.0x` (Design V1 spec)
- **Gate G6 warning:** pitch > ±3st or speed outside `[0.85, 1.15]` → inline
  HeroUI `Chip variant="flat"` with Lucide `AlertTriangle`, `border-base-400 text-base-300`.
  Informational only — audio still applies.

---

## 8. EQ — Web Audio API `BiquadFilterNode`

Fills the `[TODO: find equalizers]` placeholder.

| Band | Node type | Frequency | Range |
|---|---|---|---|
| Low | `lowshelf` | 200 Hz | -12 to +12 dB |
| Mid | `peaking` | 1000 Hz | -12 to +12 dB |
| High | `highshelf` | 8000 Hz | -12 to +12 dB |

**UI:** Three vertical HeroUI `Slider` (`orientation="vertical"`, `-12` to `12`, step `0.5`),
labelled `"Lo"` / `"Mid"` / `"Hi"`. Lucide `RotateCcw` reset button → all to 0 dB.

---

## 9. Effects Chain — Web Audio API

Fills the `[TODO: find audio effects]` placeholder.

| Effect | Node | Controls |
|---|---|---|
| Reverb | `ConvolverNode` | Dry/wet mix (0–100%) |
| Delay | `DelayNode` + feedback `GainNode` | Time (0–1s), feedback (0–90%) |
| Compressor | `DynamicsCompressorNode` | Threshold (-60–0 dB), ratio (1–20) |

Each effect row: name + HeroUI `Switch` (on/off) + HeroUI `Slider` params.
HeroUI `Button variant="bordered" size="sm"` → HeroUI `Dropdown` to add effect.
Drag to reorder (reuses existing TrackCard drag logic).

---

## 10. Other Settings

**Volume** — move from `player.setVolume()` → `AudioEngine.setVolume()`. UI unchanged.

**Fade In / Out** — move from stored strings → `AudioEngine.applyFade()` via
`GainNode.gain.linearRampToValueAtTime()`. UI text inputs unchanged.

**Segment Manager** — new section below waveform, above Settings collapsible.

```
SEGMENTS                         [ + Add Segment ]
┌──────────────────────────────────────────────────┐
│  Segment 1   Start: 0:04   End: 0:18        [✕]  │
│  Segment 2   Start: 0:45   End: 1:02        [✕]  │
└──────────────────────────────────────────────────┘
```

- Each segment = a WaveSurfer region (drag edges to resize)
- Stored as `{ id, startTime, endTime }` (seconds) in track's `segments` array
- Add → HeroUI `Button size="sm" variant="bordered"` + Lucide `Plus`
- Delete → Lucide `X` HeroUI `Button variant="light" size="sm"`

---

## 11. Simultaneous Playback

All tracks share one `AudioContext` → all `GainNode`s connect to the same
`masterGain` → `ctx.destination`. Web Audio API mixes natively.
Spotify SDK single-player constraint fully removed.

---

## 12. Export / Preview Full Mix

Both client-side — no server, no storage cost.

**Preview Full Mix:** `OfflineAudioContext` renders all tracks with all settings
→ plays result via `AudioBufferSourceNode`. Header button shows HeroUI `Spinner` while rendering.

**Export:** Same render → WAV `Blob` → `URL.createObjectURL()` →
`<a download="mix.wav">` click. MP3 via `lamejs` optional later.

---

## 13. Files Affected

| Action | File | Notes |
|---|---|---|
| **Add** | `src/audio/AudioEngine.js` | Web Audio API graph manager |
| **Add** | `src/audio/useAudioEngine.js` | React hook per track |
| **Add** | `src/audio/essentiaAnalyzer.js` | Lazy Essentia.js WASM + Web Worker |
| **Modify** | `src/components/TrackCard.js` | Wire controls to AudioEngine; WaveSurfer waveform; Segment Manager; speed range 0.5–2.0x; Gate G6 warnings; EQ + Effects UI |
| **Modify** | `src/spotify/spotifyContext.js` | Remove `playTrack`; keep search/playlist/metadata |
| **Modify** | `src/utils/helpers.js` | Add `pitchClassToKey()` for Essentia key output |
| **Modify** | `package.json` | Add `wavesurfer.js`, `@mtg/essentia.js`, `soundtouchjs` |

**Unchanged:** `Header.js`, `LibraryPanel.js`, `MainWorkspace.js`, `AIPanel.js`,
`PlaylistModal.js`, `firebase.js`, `spotifyApi.js`
