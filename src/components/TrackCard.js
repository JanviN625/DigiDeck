import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Pencil, ChevronDown, ChevronUp, Play, Pause, Volume2, VolumeX, Eye, EyeOff, Move, Copy, Trash2, RotateCcw, AlertTriangle, X, Plus, Power, ZoomIn, Loader2 } from 'lucide-react';
import { Slider } from '@heroui/react';
import { getDynamicInputWidth, spotifyConfirmMatch, buildSpotifyQuery } from '../utils/helpers';
import { searchSpotify, isLoggedIn } from '../spotify/spotifyApi';
import { EFFECT_CONFIGS } from '../utils/trackConfig';
import { useAudioEngine } from '../audio/useAudioEngine';
import AudioEngineService, { audioBufferToWAV } from '../audio/AudioEngine';
import WaveSurfer from 'wavesurfer.js';
import { analyzeAudioBuffer } from '../audio/essentiaAnalyzer';
import { useMix } from '../spotify/appContext';
import { useSettings, matchesKeybind } from '../utils/useSettings';

const SPEED_MIN = 0.25;
const SPEED_MAX = 2.0;

const parseFade = (v) => { const n = parseFloat(String(v)); return isNaN(n) || n < 0 ? 0 : n; };

// Extract downsampled peak data from an AudioBuffer for immediate WaveSurfer rendering.
// Returns an array of Float32Arrays (one per channel) with `numSamples` values each.
// This is ~10x faster than WAV encoding because it's a simple max-abs pass with no I/O.
const computeWaveformPeaks = (audioBuffer, numSamples = 2000) => {
    const channels = audioBuffer.numberOfChannels;
    const totalFrames = audioBuffer.length;
    const blockSize = Math.max(1, Math.floor(totalFrames / numSamples));
    const result = [];
    for (let ch = 0; ch < channels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        const peaks = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            const start = i * blockSize;
            const end = Math.min(start + blockSize, totalFrames);
            let max = 0;
            for (let j = start; j < end; j++) {
                const abs = Math.abs(data[j]);
                if (abs > max) max = abs;
            }
            peaks[i] = max;
        }
        result.push(peaks);
    }
    return result;
};

// Format seconds → MM:SS e.g. 02:30
const formatTimestamp = (seconds) => {
    const total = Math.floor(seconds || 0);
    const sec = total % 60;
    const min = Math.floor(total / 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

function FadeField({ label, value, onChange, onReset }) {
    const [raw, setRaw] = React.useState(String(value));

    // Sync display when value changes externally (segment switch, reset)
    React.useEffect(() => { setRaw(String(value)); }, [value]);

    return (
        <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                {label}
                {value !== 0 && (
                    <button onClick={(e) => { e.stopPropagation(); onReset(); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to 0">
                        <RotateCcw size={12} />
                    </button>
                )}
            </span>
            <input
                type="text"
                value={raw}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                    const str = e.target.value;
                    setRaw(str);
                    const n = parseFloat(str);
                    if (!isNaN(n) && n >= 0) onChange(n);
                }}
                onBlur={() => {
                    const n = parseFloat(raw);
                    const normalized = isNaN(n) || n < 0 ? 0 : n;
                    setRaw(String(normalized));
                    onChange(normalized);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-base-800 border border-base-700 rounded px-2.5 py-1.5 w-24 text-xs font-mono text-base-50 focus:border-base-500 outline-none text-right"
            />
        </div>
    );
}


// EFFECT_CONFIGS is imported from ../utils/trackConfig — shared with AIPanel's system prompt

const makeDefaultSegment = (id, startPct = 0, endPct = 1) => ({
    id, startPct, endPct,
    isDeleted: false,
    isMuted: false,
    fadeIn: 0, fadeOut: 0, pitch: 0, speed: 1.0,
    eqLow: 0, eqMid: 0, eqHigh: 0,
    eqKills: { low: false, mid: false, high: false },
    effects: [],
    masterTimePct: null,
});

// Key names for pitch transposition (chromatic)
const CHROMATIC_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export default function TrackCard({
    trackId,
    initiallyExpanded = false,
    title = "Track Name Placeholder",
    onDelete,
    onDuplicate,
    onDragStart,
    onDragEnd,
    onDragHover,
    isDragged,
    initialVolume = 80,
    initialPitch = 0,
    initialSpeed = 1.0,
    initialFadeIn = "0.0s",
    initialFadeOut = "0.0s",
    initialZoom = 0,
    offsetSec = 0,
    initialSegments = null,
    artistName = "[Artist Name]",
    albumArt = null,
    bpm = "[BPM]",
    trackKey = "[key]",
    spotifyId = null,
    audioUrl = null,
    audioBlob = null,
    beatPositions = null,
    isMissing = false,
}) {
    const { settings } = useSettings();
    const { tracks, handleUpdateTrack, handleUpdateTrackDuration, handleAddTrack, universalIsPlaying, masterStopSignal, globalZoom, masterBpm, masterDuration, masterTimeRef, handleSeekMaster, handleOverwriteTracks } = useMix();
    const {
        play, pause, seek, setVolume: setEngVolume, setPitch: setEngPitch, setSpeed: setEngSpeed,
        setEQ, addEffect, removeEffect, setEffectParam, applyFadeIn, applyFadeOut
    } = useAudioEngine(trackId);

    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [trackName, setTrackName] = useState(title);
    const [isEditing, setIsEditing] = useState(false);
    const [isReidentifying, setIsReidentifying] = useState(false);
    const [missingDismissed, setMissingDismissed] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const isSegmentMutedRef = useRef(false);     // not state — avoids re-triggering setEngVolume on segment transitions
    const [isVisible, setIsVisible] = useState(true);
    const [volume, setVolume] = useState(initialVolume);
    // Sync refs — updated each render so stable callbacks (activateSegment, RAF loop) always read current values
    const volumeRef   = useRef(initialVolume);
    const isMutedRef  = useRef(false);
    const isVisibleRef = useRef(true);
    const [pitch, setPitch] = useState(initialPitch);
    const [speed, setSpeed] = useState(initialSpeed);
    const [speedInputVal, setSpeedInputVal] = useState(null); // null = display mode, string = editing
    const [useTargetBpmMode, setUseTargetBpmMode] = useState(false); // false = speed slider, true = BPM input
    const [fadeIn, setFadeIn] = useState(() => parseFade(initialFadeIn));
    const [fadeOut, setFadeOut] = useState(() => parseFade(initialFadeOut));
    const [audioDuration, setAudioDuration] = useState(0);
    const [displayTimeSec, setDisplayTimeSec] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    // Per-track zoom — must be declared before clipWidthPct (used below).
    // Syncs with globalZoom when the global slider moves; per-track scroll-wheel adjusts independently.
    const [localZoom, setLocalZoom] = useState(globalZoom);
    useEffect(() => { setLocalZoom(globalZoom); }, [globalZoom]);
    // Wall-clock duration at current speed. Slower speed → beat markers spread wider to align with master.
    const effectiveDuration = audioDuration > 0 ? audioDuration / Math.max(0.1, parseFloat(speed)) : 0;
    const clipProportion = masterDuration > 0 && effectiveDuration > 0
        ? Math.min(1, effectiveDuration / masterDuration)
        : 1;
    // DAW-style zoom: exponential scale so low values stay gentle and high values reach deep detail.
    // Slider range 0–400. Ticks 1–5 span 1× → ~2.7× → ~7× → ~19× → 50× (beat-level visible ~150+).
    const zoomMultiplier = Math.pow(50, localZoom / 400);
    // waveformPixelWidth = actual rendered pixel width of the canvas (containerWidth, measured via ResizeObserver).
    // Used for beat-marker visibility threshold and effect-visual positioning.
    const waveformPixelWidth = containerWidth;
    const [effects, setEffects] = useState([]);
    const [showAddEffectMenu, setShowAddEffectMenu] = useState(false);
    const [isDraggable, setIsDraggable] = useState(false);
    const [segments, setSegments] = useState(() => initialSegments ?? [makeDefaultSegment(0)]);
    const [activeSegmentId, setActiveSegmentId] = useState(() => (initialSegments ?? [makeDefaultSegment(0)])[0]?.id ?? 0);
    const [g6Dismissed, setG6Dismissed] = useState(false);
    const [audioDropped, setAudioDropped] = useState(false);
    const [isAnalysing, setIsAnalysing] = useState(false);
    const [eqLow, setEqLow] = useState(0);
    const [eqMid, setEqMid] = useState(0);
    const [eqHigh, setEqHigh] = useState(0);
    const [eqKills, setEqKills] = useState({ low: false, mid: false, high: false });

    const laneRef = useRef(null);
    const waveformRef = useRef(null);
    const wavesurferRef = useRef(null);
    const waveformReadyRef = useRef(false);
    const hasMounted = useRef(false);
    const currentTimePctRef = useRef(0);
    const durationRef = useRef(0);
    const fadeOutTriggeredRef = useRef(false);
    const beatPositionsRef = useRef(beatPositions);
    const adjustedBeatPositionsRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const isHoveredRef = useRef(false);
    const lastTimestampUpdateRef = useRef(0);
    const activeSegmentIdRef = useRef((initialSegments ?? [makeDefaultSegment(0)])[0]?.id ?? 0);
    const segmentsRef = useRef(null);
    const playingSegmentIdRef = useRef(null);
    const effectsRef = useRef([]);
    const activateSegmentRef = useRef(null);
    const playWaitTimerRef = useRef(null);
    const waveBlobUrlRef = useRef(null); // current blob URL loaded into WaveSurfer
    const originalBpmRef = useRef(null); // locked on first valid analysis — never drifts with speed/pitch changes

    // Keep sync refs current each render so stable callbacks always see fresh values
    volumeRef.current    = volume;
    isMutedRef.current   = isMuted;
    isVisibleRef.current = isVisible;

    // Capture the first valid BPM from Essentia analysis as the immutable baseline.
    // All Target BPM calculations divide by this value, preventing compounding drift.
    useEffect(() => {
        if (originalBpmRef.current === null && bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm))) {
            originalBpmRef.current = parseFloat(bpm);
        }
    }, [bpm]);

    // Show audio drop warning if triggered by Engine
    useEffect(() => {
        const handler = (e) => {
            if (e.detail.trackId === trackId) setAudioDropped(true);
        };
        window.addEventListener('audio-drop', handler);
        return () => window.removeEventListener('audio-drop', handler);
    }, [trackId]);

    // Re-show the missing warning if the file is deleted again after being restored
    useEffect(() => { if (isMissing) setMissingDismissed(false); }, [isMissing]);

    // Bind Undo/Redo state rewinds from Context into local visual layout
    useEffect(() => {
        if (initialSegments) {
            setSegments(initialSegments);
        }
    }, [initialSegments]);

    // Derived — always accurate, immune to effect timing issues
    const isDuplicateName = isEditing && tracks.some(t => t.id !== trackId && t.title.trim() === trackName.trim());

    // Keep beatPositionsRef current so the rAF loop always has the latest Essentia data
    // without needing to restart the animation loop when beatPositions arrives async.
    useEffect(() => {
        beatPositionsRef.current = beatPositions;
    }, [beatPositions]);

    // Speed-adjusted beat positions — each beat is shifted relative to its segment's start
    // by dividing its offset into the segment by that segment's speed multiplier.
    // This makes markers reflect the output rhythm (e.g. 1.2x speed → 20% tighter spacing)
    // and keeps Ctrl+S snap points aligned to the actual heard beats.
    const adjustedBeatPositions = useMemo(() => {
        if (!beatPositions || !beatPositions.length || !audioDuration) return beatPositions ?? [];
        return beatPositions.map(t => {
            const pct = t / audioDuration;
            const seg = segments.find(s => pct >= s.startPct && pct < s.endPct);
            if (!seg || seg.speed === 1.0) return t;
            const segStartSec = seg.startPct * audioDuration;
            const segEndSec   = seg.endPct   * audioDuration;
            const adjusted    = segStartSec + (t - segStartSec) / seg.speed;
            return Math.min(segEndSec, Math.max(segStartSec, adjusted));
        });
    }, [beatPositions, segments, audioDuration]);

    useEffect(() => {
        adjustedBeatPositionsRef.current = adjustedBeatPositions;
    }, [adjustedBeatPositions]);

    // Effective BPM = locked original BPM × current speed.
    // Uses originalBpmRef so the display never drifts if the bpm prop is updated by async analysis.
    const effectiveBpm = useMemo(() => {
        const base = originalBpmRef.current ?? parseFloat(bpm);
        if (!base || isNaN(base)) return null;
        return Math.round(base * parseFloat(speed));
    }, [bpm, speed]);

    // Master BPM beat grid — evenly spaced at 60/masterBpm intervals, phase-locked to the master
    // timeline clock by accounting for this track's offsetSec. All tracks share the same phase.
    // Values are in wall-clock (playback) time; rendered only as a fallback when Essentia beats
    // are unavailable. Compare against effectiveDuration (wall-clock) not audioDuration (buffer).
    const masterBeatGrid = useMemo(() => {
        if (!masterBpm || masterBpm <= 0 || !audioDuration) return [];
        const beatSec = 60 / masterBpm;
        const offset = offsetSec || 0;
        const firstBeatIdx = Math.ceil(offset / beatSec);
        const trackWallDuration = effectiveDuration || audioDuration;
        const grid = [];
        for (let i = firstBeatIdx; ; i++) {
            const beatInTrack = i * beatSec - offset;
            if (beatInTrack >= trackWallDuration) break;
            if (beatInTrack >= 0) grid.push(beatInTrack);
        }
        return grid.length > 500 ? [] : grid; // safety cap: avoid rendering 500+ lines
    }, [masterBpm, audioDuration, effectiveDuration, offsetSec]);

    const masterBeatGridRef = useRef([]);
    useEffect(() => { masterBeatGridRef.current = masterBeatGrid; }, [masterBeatGrid]);

    // Warn user when track's effective BPM differs from master (Sync All would override it)
    const isOutOfSyncWithMaster = useMemo(() => {
        if (!effectiveBpm || !masterBpm) return false;
        return Math.abs(effectiveBpm - masterBpm) > 0.5;
    }, [effectiveBpm, masterBpm]);

    // Sync local speed state when the prop changes externally (e.g. Sync All from header).
    useEffect(() => {
        setSpeed(initialSpeed);
    }, [initialSpeed]);

    // Keep refs current for use inside rAF loop and WaveSurfer callbacks that close over stale state.
    useEffect(() => { segmentsRef.current = segments; }, [segments]);
    useEffect(() => { activeSegmentIdRef.current = activeSegmentId; }, [activeSegmentId]);
    useEffect(() => { effectsRef.current = effects; }, [effects]);

    // Sync title prop into local state when a slot gets filled externally (e.g. library drop).
    // On first mount title === trackName so React bails out with no re-render.
    useEffect(() => {
        setTrackName(title);
    }, [title]);

    // Rename → Spotify re-identification for local tracks.
    // prevIsEditingRef tracks the last isEditing value so we can detect true→false.
    // editStartTitleRef captures the track title at the moment editing BEGINS — the
    // settings-sync effect fires on every keystroke and continuously writes trackName
    // back to context, so by commit time `title` prop already equals `trackName`.
    // Comparing against the pre-edit snapshot is the only way to know if it changed.
    const prevIsEditingRef = useRef(false);
    const editStartTitleRef = useRef(null);
    useEffect(() => {
        const wasEditing = prevIsEditingRef.current;
        prevIsEditingRef.current = isEditing;

        if (!wasEditing && isEditing) {
            // Editing just started — snapshot the current title before any keystrokes
            editStartTitleRef.current = title;
            return;
        }
        if (!wasEditing || isEditing) return; // only continue on true→false commit

        const trackData = tracks.find(t => t.id === trackId);
        console.log('[reidentify] rename committed', {
            newTitle: trackName.trim(),
            originalTitle: editStartTitleRef.current,
            isLocal: trackData?.isLocal,
            isLoggedIn: isLoggedIn(),
        });
        if (!trackData?.isLocal) { console.warn('[reidentify] skipped: track is not local'); return; }
        if (!isLoggedIn()) { console.warn('[reidentify] skipped: Spotify not logged in'); return; }

        const newTitle = trackName.trim();
        if (!newTitle || newTitle === editStartTitleRef.current) { console.warn('[reidentify] skipped: title unchanged'); return; }

        const artistName = (trackData.artistName && trackData.artistName !== 'Local File') ? trackData.artistName : null;
        const resolvedBpm = typeof trackData.bpm === 'number' ? trackData.bpm : null;
        const resolvedKey = typeof trackData.trackKey === 'string' && trackData.trackKey !== '[key]' ? trackData.trackKey : null;

        console.log('[reidentify] searching Spotify for:', newTitle, '| artist:', artistName);
        setIsReidentifying(true);
        (async () => {
            try {
                const query = buildSpotifyQuery(newTitle, artistName);
                const results = await searchSpotify(query, ['track'], 5);
                const items = results?.tracks?.items;
                console.log('[reidentify] Spotify returned', items?.length ?? 0, 'candidates');
                let match = spotifyConfirmMatch(newTitle, items);
                if (match) {
                    console.log('[reidentify] trigram matched:', match.name, '-', match.artists?.map(a => a.name).join(', '));
                } else if (items?.length) {
                    console.log('[reidentify] trigram failed, calling LLM with candidates:', items.map(t => t.name));
                    const body = {
                        title: newTitle,
                        artist: artistName,
                        candidates: items.slice(0, 5).map(t => ({
                            id: t.id, name: t.name, artists: t.artists,
                            album: { images: t.album?.images },
                        })),
                    };
                    if (resolvedBpm !== null) body.bpm = resolvedBpm;
                    if (resolvedKey !== null) body.trackKey = resolvedKey;
                    const llmRes = await fetch('/api/findSpotifyTrack', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (llmRes.ok) {
                        const { result } = await llmRes.json();
                        console.log('[reidentify] LLM returned index:', result?.index);
                        if (result?.index != null) match = items[result.index];
                    }
                } else {
                    console.warn('[reidentify] no Spotify candidates returned');
                }
                if (match) {
                    console.log('[reidentify] ✓ updating track with:', match.artists?.map(a => a.name).join(', '));
                    handleUpdateTrack(trackId, {
                        artistName: match.artists?.map(a => a.name).join(', ') || artistName,
                        albumArt: match.album?.images?.[0]?.url || null,
                    }, true);
                } else {
                    console.warn('[reidentify] no match found, track unchanged');
                }
            } catch (err) { console.error('[reidentify] error:', err); }
            finally { setIsReidentifying(false); }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    // Audio initialisation — single network fetch shared between AudioEngine and WaveSurfer.
    // The ArrayBuffer is fetched once; a Blob URL is created for WaveSurfer before
    // decodeAudioData detaches the buffer, eliminating the duplicate download.
    // WaveSurfer is initialised here (not in a separate effect) so both consumers
    // are set up in one place and the cleanup is fully coordinated.
    useEffect(() => {
        if (!audioUrl || !waveformRef.current) return;

        let isCancelled = false;
        let ws = null;
        let blobUrl = null;

        async function loadAndInit() {
            try {
                let arrayBuffer;

                if (audioBlob) {
                    // Bypass emulator network layer fetch for Blobs
                    arrayBuffer = await audioBlob.arrayBuffer();
                    blobUrl = URL.createObjectURL(audioBlob);
                } else {
                    const res = await fetch(audioUrl);
                    arrayBuffer = await res.arrayBuffer();
                    const blob = new Blob([arrayBuffer]);
                    blobUrl = URL.createObjectURL(blob);
                }
                
                if (isCancelled) return;

                // Create Blob URL for WaveSurfer BEFORE decodeAudioData detaches the buffer
                const blob = new Blob([arrayBuffer]);
                blobUrl = URL.createObjectURL(blob);

                // Decode for AudioEngine (detaches arrayBuffer — blob already holds the data)
                const audioBuffer = await AudioEngineService.ctx.decodeAudioData(arrayBuffer);
                if (isCancelled) return;

                await AudioEngineService.loadTrack(trackId, audioBuffer);
                if (isCancelled) return;

                // Apply active segment settings (pitch, speed, EQ, effects) so duplicated
                // or reloaded tracks restore their full per-segment state on mount.
                activateSegmentRef.current?.(activeSegmentIdRef.current);

                // Sync volume/mute (not stored per-segment)
                setEngVolume(isMuted || !isVisible ? 0 : volume / 100);

                // Run Essentia — always runs to populate beatPositions for markers.
                // bpm/trackKey are only updated if Spotify didn't already provide them.
                setIsAnalysing(true);
                analyzeAudioBuffer(audioBuffer).then(results => {
                    setIsAnalysing(false);
                    if (isCancelled) return;
                    const updates = { beatPositions: Array.from(results.beatPositions || []) };
                    if (bpm === '[BPM]') updates.bpm = results.bpm;
                    if (trackKey === '[key]') updates.trackKey = `${results.key} ${results.scale}`;
                    handleUpdateTrack(trackId, updates, true); // true = skipHistory to prevent undo stack overwrite on load
                }).catch(err => {
                    console.warn("Essentia analysis failed:", err);
                    setIsAnalysing(false);
                });

                if (isCancelled || !waveformRef.current) return;

                // WaveSurfer loads from blob URL — no second network fetch.
                // The container div is always in the DOM (CSS-hidden when collapsed), so
                // WaveSurfer's internal ResizeObserver redraws it when the card expands
                // without requiring a re-initialisation.
                ws = WaveSurfer.create({
                    container: waveformRef.current,
                    waveColor: '#6B3D52',
                    progressColor: '#A63A50',
                    cursorColor: '#F8FAFC',
                    barWidth: 2,
                    barRadius: 1,
                    height: 'auto',
                    interact: false,
                });

                ws.on('ready', () => {
                    waveformReadyRef.current = true;
                    const dur = ws.getDuration();
                    durationRef.current = dur;
                    setAudioDuration(dur);
                    handleUpdateTrackDuration(trackId, dur);
                    // Always auto-fit — container width (driven by clipWidthPct) is the zoom
                    ws.zoom(0);
                });

                wavesurferRef.current = ws;
                waveBlobUrlRef.current = blobUrl;
                ws.load(blobUrl);

            } catch (err) {
                if (!isCancelled) console.error("Audio load failed:", err);
            }
        }

        loadAndInit();

        return () => {
            isCancelled = true;
            waveformReadyRef.current = false;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            if (ws) ws.destroy();
            wavesurferRef.current = null;
            waveBlobUrlRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl, trackId, seek]);

    // Handle Engine Volume — only global track mute/visibility triggers this effect.
    // Per-segment muting is applied directly in activateSegment and the RAF boundary handler
    // so it never re-fires the global volume and accidentally interrupts fade ramps.
    useEffect(() => {
        setEngVolume(isMuted || !isVisible ? 0 : volume / 100);
    }, [volume, isMuted, isVisible, setEngVolume]);

    // Handle Engine Pitch
    useEffect(() => {
        setEngPitch(pitch);
    }, [pitch, setEngPitch]);

    // Handle Engine Speed
    useEffect(() => {
        setEngSpeed(speed);
    }, [speed, setEngSpeed]);

    // Universal play/pause signal — orchestrates perfectly synced timeline playback
    useEffect(() => {
        if (!audioUrl) return;
        clearTimeout(playWaitTimerRef.current);

        if (universalIsPlaying) {
            const timeUntilStart = offsetSec - masterTimeRef.current;
            if (timeUntilStart > 0) {
                 playWaitTimerRef.current = setTimeout(() => {
                      if (!waveformReadyRef.current) return;
                      // When the timeout fires, the master clock has reached our clip!
                      const expectedLocalTime = masterTimeRef.current - offsetSec;
                      const currentLocalTime = wavesurferRef.current?.getCurrentTime() || 0;
                      if (Math.abs(currentLocalTime - expectedLocalTime) > 0.1) {
                           seek(0);
                           wavesurferRef.current?.seekTo(0);
                           currentTimePctRef.current = 0;
                           setDisplayTimeSec(0);
                      }
                      setIsPlaying(true);
                 }, timeUntilStart * 1000);
            } else {
                 const expectedLocalTime = masterTimeRef.current - offsetSec;
                 
                 // if track is shorter than expected local time, it is fully in the past, don't play it
                 if (durationRef.current > 0 && expectedLocalTime >= durationRef.current) {
                      setIsPlaying(false);
                      return;
                 }

                 const currentLocalTime = wavesurferRef.current?.getCurrentTime() || 0;
                 if (Math.abs(currentLocalTime - expectedLocalTime) > 0.1) {
                      seek(expectedLocalTime);
                      const norm = durationRef.current ? expectedLocalTime / durationRef.current : 0;
                      wavesurferRef.current?.seekTo(Math.min(1, Math.max(0, norm)));
                      currentTimePctRef.current = norm;
                      setDisplayTimeSec(expectedLocalTime);
                 }
                 setIsPlaying(true);
            }
        } else {
            setIsPlaying(false);
        }
    }, [universalIsPlaying, offsetSec]); // eslint-disable-line react-hooks/exhaustive-deps

    // Universal stop signal — pause + seek every track back to 0:00
    useEffect(() => {
        if (masterStopSignal === 0) return;
        setIsPlaying(false);
        seek(0);
        currentTimePctRef.current = 0;
        wavesurferRef.current?.seekTo(0);
    }, [masterStopSignal, seek]);

    // Handle EQ — kills override the slider value with -40 dB (effective silence)
    useEffect(() => {
        setEQ({
            low:  eqKills.low  ? -40 : eqLow,
            mid:  eqKills.mid  ? -40 : eqMid,
            high: eqKills.high ? -40 : eqHigh,
        });
    }, [eqLow, eqMid, eqHigh, eqKills, setEQ]);

    // Re-fit WaveSurfer immediately when zoom or speed changes (before ResizeObserver fires).
    useEffect(() => {
        if (!waveformReadyRef.current || !wavesurferRef.current) return;
        wavesurferRef.current.zoom(0);
    }, [localZoom, speed]);

    // Re-fit the waveform whenever the container physically resizes (zoom change, masterDuration change,
    // or panel expand). ResizeObserver fires after the browser has computed the new layout — so WaveSurfer
    // reads the correct clientWidth when zoom(0) runs. Active at all zoom levels (clip width changes at any zoom).
    useEffect(() => {
        if (!wavesurferRef.current || !waveformReadyRef.current || containerWidth <= 0) return;
        wavesurferRef.current.zoom(0);
    }, [containerWidth]);

    // Belt-and-suspenders: trigger on masterDuration / effectiveDuration changes using rAF so layout paints first.
    useEffect(() => {
        if (!wavesurferRef.current || !waveformReadyRef.current) return;
        const id = requestAnimationFrame(() => {
            if (wavesurferRef.current && waveformReadyRef.current) wavesurferRef.current.zoom(0);
        });
        return () => cancelAnimationFrame(id);
    }, [masterDuration, effectiveDuration]);

    // Scroll viewport to centre the playhead whenever zoom level changes.
    useEffect(() => {
        const scrollEl = scrollContainerRef.current;
        if (!scrollEl) return;
        if (zoomMultiplier <= 1) { scrollEl.scrollLeft = 0; return; }
        const laneWidth = scrollEl.clientWidth;
        if (!laneWidth) return;
        const clipLeftPx  = masterDuration > 0 ? (offsetSec / masterDuration) * zoomMultiplier * laneWidth : 0;
        const clipWidthPx = clipProportion * zoomMultiplier * laneWidth;
        const playheadPx  = clipLeftPx + (currentTimePctRef.current || 0) * clipWidthPx;
        scrollEl.scrollLeft = Math.max(0, playheadPx - laneWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localZoom]);

    // Scroll-wheel zoom — must be non-passive so preventDefault() actually stops page scroll.
    // RAF-debounced so rapid scroll events are coalesced into one zoom call per frame.
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        let rafId = null;
        let pending = 0;
        const onWheel = (e) => {
            e.preventDefault();
            pending += e.deltaY < 0 ? 20 : -20;
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const delta = pending;
                pending = 0;
                setLocalZoom(z => Math.min(400, Math.max(0, z + delta)));
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('wheel', onWheel);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [audioUrl, isExpanded]); // re-attach when audio loads or card expands

    // Measure container width dynamically using ResizeObserver.
    // Active at all zoom levels — as zoom changes the clip container resizes, and we need
    // containerWidth to stay accurate for beat-marker visibility and overlay positioning.
    useEffect(() => {
        if (!waveformRef.current) return;

        const node = waveformRef.current;
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(node);
        return () => observer.disconnect();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Write a partial update to the currently active segment's stored config.
    // Uses activeSegmentIdRef (always current) to avoid stale closure in concurrent renders.
    const syncActiveSegmentSettings = useCallback((updates) => {
        setSegments(prev => prev.map(s =>
            s.id === activeSegmentIdRef.current ? { ...s, ...updates } : s
        ));
    }, []);

    // Wrapper setters: update React state AND immediately persist to the active segment config.
    // These replace direct useState setters everywhere the user initiates a change.
    // activateSegment uses the plain setters (no write-back needed when loading from a segment).
    const setFadeInWithSync    = useCallback((v) => { setFadeIn(v);  syncActiveSegmentSettings({ fadeIn: v }); },  [syncActiveSegmentSettings]);
    const setFadeOutWithSync   = useCallback((v) => { setFadeOut(v); syncActiveSegmentSettings({ fadeOut: v }); }, [syncActiveSegmentSettings]);

    const setPitchWithSync = useCallback((v) => {
        setPitch(v);
        syncActiveSegmentSettings({ pitch: v });
        // Update displayed key by transposing based on semitones
        if (trackKey && trackKey !== '[key]') {
            const parts = trackKey.trim().split(' ');
            const rootNote = parts[0];
            const mode = parts.slice(1).join(' ');
            const rootIdx = CHROMATIC_KEYS.indexOf(rootNote);
            if (rootIdx !== -1) {
                const semis = Math.round(v);
                const newRoot = CHROMATIC_KEYS[((rootIdx + semis) % 12 + 12) % 12];
                const newKey = mode ? `${newRoot} ${mode}` : newRoot;
                handleUpdateTrack(trackId, { trackKey: newKey }, true);
            }
        }
    }, [syncActiveSegmentSettings, trackKey, trackId, handleUpdateTrack]);

    const setSpeedWithSync = useCallback((v) => {
        setSpeed(v);
        syncActiveSegmentSettings({ speed: v });
    }, [syncActiveSegmentSettings]);
    const setEqLowWithSync     = useCallback((v) => { setEqLow(v);   syncActiveSegmentSettings({ eqLow: v }); },   [syncActiveSegmentSettings]);
    const setEqMidWithSync     = useCallback((v) => { setEqMid(v);   syncActiveSegmentSettings({ eqMid: v }); },   [syncActiveSegmentSettings]);
    const setEqHighWithSync    = useCallback((v) => { setEqHigh(v);  syncActiveSegmentSettings({ eqHigh: v }); },  [syncActiveSegmentSettings]);
    const setEqKillsWithSync   = useCallback((v) => { setEqKills(v); syncActiveSegmentSettings({ eqKills: v }); }, [syncActiveSegmentSettings]);

    // eslint-disable-next-line no-unused-vars
    const handleToggleDelete = useCallback((e) => {
        e.stopPropagation();
        const seg = segmentsRef.current?.find(s => s.id === activeSegmentIdRef.current);
        if (!seg) return;
        const next = !seg.isDeleted;
        syncActiveSegmentSettings({ isDeleted: next });
        const segMuted = next || seg.isMuted;
        isSegmentMutedRef.current = segMuted;
        if (!isMutedRef.current && isVisibleRef.current) setEngVolume(segMuted ? 0 : volumeRef.current / 100);
    }, [syncActiveSegmentSettings, setEngVolume]);

    // eslint-disable-next-line no-unused-vars
    const handleToggleMute = useCallback((e) => {
        e.stopPropagation();
        const seg = segmentsRef.current?.find(s => s.id === activeSegmentIdRef.current);
        if (!seg) return;
        const next = !seg.isMuted;
        syncActiveSegmentSettings({ isMuted: next });
        const segMuted = seg.isDeleted || next;
        isSegmentMutedRef.current = segMuted;
        if (!isMutedRef.current && isVisibleRef.current) setEngVolume(segMuted ? 0 : volumeRef.current / 100);
    }, [syncActiveSegmentSettings, setEngVolume]);

    // Activate a segment: update ref immediately (so concurrent effects target the new segment),
    // apply all its audio settings to the engine, reconcile the effects chain, and sync UI state.
    // Only called on user-initiated segment selection — NOT during rAF playback boundary crossings.
    const activateSegment = useCallback((segId) => {
        const segs = segmentsRef.current;
        const seg = segs?.find(s => s.id === segId);
        if (!seg) return;

        // Update ref immediately before any async work so sync effects target the new segment
        activeSegmentIdRef.current = segId;
        setActiveSegmentId(segId);

        // Apply audio settings to engine — eqKills override the stored dB values with -40
        const kills = seg.eqKills || { low: false, mid: false, high: false };
        AudioEngineService.setPitch(trackId, seg.pitch);
        AudioEngineService.setSpeed(trackId, seg.speed);
        AudioEngineService.setEQ(trackId, {
            low:  kills.low  ? -40 : seg.eqLow,
            mid:  kills.mid  ? -40 : seg.eqMid,
            high: kills.high ? -40 : seg.eqHigh,
        });

        // Reconcile effects chain: clear current live effects, rebuild from new segment's config
        const curr = effectsRef.current;
        curr.forEach(e => AudioEngineService.removeEffect(trackId, e.id));
        const newEffects = seg.effects.map(cfg => {
            const id = AudioEngineService.addEffect(trackId, cfg.type);
            if (id == null) return null;
            AudioEngineService.setEffectEnabled(trackId, id, cfg.enabled);
            Object.entries(cfg.params).forEach(([p, v]) => AudioEngineService.setEffectParam(trackId, id, p, v));
            return { id, type: cfg.type, enabled: cfg.enabled, params: { ...cfg.params } };
        }).filter(Boolean);

        // Batch all UI state updates — plain setters (no write-back, loading from segment)
        setPitch(seg.pitch);
        setSpeed(seg.speed);
        setFadeIn(seg.fadeIn);
        setFadeOut(seg.fadeOut);
        setEqLow(seg.eqLow);
        setEqMid(seg.eqMid);
        setEqHigh(seg.eqHigh);
        setEffects(newEffects);
        setEqKills(kills);
        // Apply segment muting directly — bypasses the volume useEffect so fade ramps aren't interrupted
        const segMuted = seg.isDeleted || seg.isMuted || false;
        isSegmentMutedRef.current = segMuted;
        if (!isMutedRef.current && isVisibleRef.current) setEngVolume(segMuted ? 0 : volumeRef.current / 100);
    }, [trackId, setEngVolume]);

    // Keep activateSegmentRef current for stable access inside WaveSurfer callbacks
    activateSegmentRef.current = activateSegment;

    // ─── Effect handlers ────────────────────────────────────────────────────────

    const handleAddEffect = useCallback((effectType) => {
        const effectId = addEffect(effectType);
        if (effectId == null) return;
        const defaultParams = EFFECT_CONFIGS[effectType].defaultParams;
        const newEff = { id: effectId, type: effectType, enabled: true, params: { ...defaultParams } };
        const updatedEffects = [...effectsRef.current, newEff];
        setEffects(updatedEffects);
        setSegments(prev => prev.map(s => s.id === activeSegmentIdRef.current
            ? { ...s, effects: updatedEffects.map(({ type, enabled, params }) => ({ type, enabled, params })) }
            : s
        ));
        setShowAddEffectMenu(false);
    }, [addEffect]);

    const handleEffectParam = useCallback((effectId, param, value) => {
        setEffectParam(effectId, param, value);
        const updatedEffects = effectsRef.current.map(e => e.id === effectId ? { ...e, params: { ...e.params, [param]: value } } : e);
        setEffects(updatedEffects);
        setSegments(prev => prev.map(s => s.id === activeSegmentIdRef.current
            ? { ...s, effects: updatedEffects.map(({ type, enabled, params }) => ({ type, enabled, params })) }
            : s
        ));
    }, [setEffectParam]);

    const handleRemoveEffect = useCallback((effectId) => {
        removeEffect(effectId);
        const updatedEffects = effectsRef.current.filter(e => e.id !== effectId);
        setEffects(updatedEffects);
        setSegments(prev => prev.map(s => s.id === activeSegmentIdRef.current
            ? { ...s, effects: updatedEffects.map(({ type, enabled, params }) => ({ type, enabled, params })) }
            : s
        ));
    }, [removeEffect]);

    const handleSync = useCallback((e) => {
        e.stopPropagation();
        const baseBpm = originalBpmRef.current ?? (bpm !== '[BPM]' ? parseFloat(bpm) : NaN);
        if (!isNaN(baseBpm) && baseBpm > 0) {
            const targetSpeed = masterBpm / baseBpm;
            const clampedSpeed = Math.min(4.0, Math.max(0.25, targetSpeed));
            // Update display state immediately
            setSpeed(clampedSpeed);
            // Persist to ALL segments so seeking/playhead movement won't revert the synced speed
            setSegments(prev => prev.map(s => ({ ...s, speed: clampedSpeed })));
            // Apply to audio engine so currently-playing audio updates immediately
            AudioEngineService.setSpeed(trackId, clampedSpeed);
        }
    }, [bpm, masterBpm, trackId]);

    // Split track at playhead position — inserts a cut point into the segments array.
    const handleSplit = useCallback(() => {
        if (!audioUrl || !waveformReadyRef.current || !wavesurferRef.current) return;
        const duration = durationRef.current;
        if (!duration) return;

        // Capture pct ONCE — stays stable across the sync state update + re-render cycle.
        let pct = currentTimePctRef.current;
        if (!pct) pct = wavesurferRef.current.getCurrentTime() / duration;
        if (pct <= 0 || pct >= 1) return;

        const prev = segmentsRef.current;
        const idx = prev.findIndex(seg => pct >= seg.startPct && pct < seg.endPct);
        if (idx === -1) return;

        const seg = prev[idx];
        const rightMasterTimePct = seg.masterTimePct !== null && masterDuration > 0
            ? seg.masterTimePct + (pct - seg.startPct) * audioDuration / masterDuration
            : null;
        const next = [...prev];
        next.splice(idx, 1,
            { ...seg, endPct: pct, fadeOut: 0 },
            { ...seg, id: Date.now(), startPct: pct, endPct: seg.endPct, fadeIn: 0, masterTimePct: rightMasterTimePct }
        );

        // Apply state before persisting so UI is instant.
        setSegments(next);
        handleUpdateTrack(trackId, { initialSegments: next });

        // Re-anchor wavesurfer to the exact pre-split position so the re-render
        // cycle triggered by handleUpdateTrack cannot drift the playhead.
        wavesurferRef.current.seekTo(Math.min(1, Math.max(0, pct)));
        currentTimePctRef.current = pct;
    }, [audioUrl, handleUpdateTrack, trackId, masterDuration, audioDuration]);

    // eslint-disable-next-line no-unused-vars
    const handleOffsetDragStart = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!masterDuration) return;
        
        const startX = e.clientX;
        const currentLaneWidth = laneRef.current?.clientWidth || 800;
        const initialOffset = offsetSec;
        
        // Capture static snapshots to prevent runaway math during dragging loops
        const initialMasterDuration = masterDuration || durationRef.current || 1;
        const initialTracksSnapshot = tracks;
        const beatSec = 60 / (masterBpm || 120);
        
        const computeShiftAndOverwrite = (clientX, skipHistory) => {
            const dx = clientX - startX;
            const deltaSec = (dx / currentLaneWidth) * initialMasterDuration;
            let rawOffset = initialOffset + deltaSec;
            
            // Snap offset to the nearest beat
            rawOffset = Math.round(rawOffset / beatSec) * beatSec;
            
            const shiftAmount = rawOffset < 0 ? Math.abs(rawOffset) : 0;
            
            const newlyMapped = initialTracksSnapshot.map(t => {
                if (t.id === trackId) {
                    return { ...t, offsetSec: Math.max(0, rawOffset) };
                }
                return { ...t, offsetSec: (t.offsetSec || 0) + shiftAmount };
            });
            
            handleOverwriteTracks(newlyMapped, skipHistory);
        };
        
        const handleMouseMove = (moveEvent) => {
            computeShiftAndOverwrite(moveEvent.clientX, true); // True = skip history while actively dragging
        };
        
        const handleMouseUp = (upEvent) => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            // Final commit (skipHistory = false)
            computeShiftAndOverwrite(upEvent.clientX, false);
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [masterDuration, offsetSec, trackId, tracks, handleOverwriteTracks, masterBpm]);

    // Click on a segment overlay — seek to the clicked position and activate that segment.
    // Reordering is handled by the segment strip below the waveform, not by dragging on the overlay.
    //
    // Position is calculated at mousedown time using waveformRef.getBoundingClientRect().left.
    // getBoundingClientRect() is viewport-relative and already bakes in the current scrollLeft,
    // so we don't need to read scrollLeft separately. This avoids a race where the RAF auto-scroll
    // loop changes scrollLeft between mousedown and mouseup (causing a shifted seek position).
    const handleSegmentOverlayMouseDown = useCallback((e, seg) => {
        if (seg.isDeleted) return;
        e.stopPropagation();

        const waveformEl = waveformRef.current;
        const scrollEl = scrollContainerRef.current;
        if (!waveformEl || !scrollEl) return;

        // waveformRef is absolute inset-0 inside the clip div. getBoundingClientRect() already
        // accounts for current scroll position, so waveformRect.left is the correct viewport-relative
        // origin and waveformRect.width is the actual rendered clip width (not the viewport width).
        const waveformRect = waveformEl.getBoundingClientRect();
        const totalWidth = waveformRect.width || 1;
        const clickX = e.clientX - waveformRect.left;
        const pct = Math.max(0, Math.min(1, clickX / totalWidth));
        const timeSec = pct * (audioDuration || 0);

        seek(timeSec);
        handleSeekMaster(timeSec + (offsetSec || 0));
        if (durationRef.current > 0) {
            const clickedSeg = segmentsRef.current?.find(s => pct >= s.startPct && pct < s.endPct);
            if (clickedSeg) activateSegmentRef.current?.(clickedSeg.id);
            currentTimePctRef.current = pct;
            if (wavesurferRef.current) wavesurferRef.current.seekTo(pct);
        }
        setDisplayTimeSec(timeSec);
    }, [audioDuration, offsetSec, seek, handleSeekMaster]);

    // Reorder segments — rebuilds the audio buffer in the new ID order.
    // Identical to the drag drop logic, but called directly by the strip's swap buttons.
    const handleReorderSegments = useCallback(async (newOrderIds) => {
        const liveSegs = segmentsRef.current;
        if (!liveSegs || newOrderIds.join(',') === liveSegs.map(s => s.id).join(',')) return;
        setIsAnalysing(true);
        const trackObj = AudioEngineService.tracks.get(trackId);
        if (!trackObj?.audioBuffer) { setIsAnalysing(false); return; }
        const oldBuf = trackObj.audioBuffer;
        const channels = oldBuf.numberOfChannels;
        const totalFrames = oldBuf.length;
        const segById = Object.fromEntries(liveSegs.map(s => [s.id, s]));
        const newBuf = AudioEngineService.ctx.createBuffer(channels, totalFrames, oldBuf.sampleRate);
        for (let ch = 0; ch < channels; ch++) {
            const oldData = oldBuf.getChannelData(ch);
            const newData = newBuf.getChannelData(ch);
            let writePos = 0;
            for (const id of newOrderIds) {
                const s = segById[id];
                const sf = Math.floor(s.startPct * totalFrames);
                const ef = Math.floor(s.endPct * totalFrames);
                const len = ef - sf;
                if (len > 0) { newData.set(oldData.subarray(sf, ef), writePos); writePos += len; }
            }
        }
        let pos = 0;
        const reordered = newOrderIds.map(id => {
            const s = segById[id];
            const sf = Math.floor(s.startPct * totalFrames);
            const ef = Math.floor(s.endPct * totalFrames);
            const size = (ef - sf) / totalFrames;
            const updated = { ...s, startPct: pos, endPct: pos + size };
            pos += size;
            return updated;
        });
        trackObj.audioBuffer = newBuf;
        trackObj.duration = newBuf.duration;
        const peaks = computeWaveformPeaks(newBuf);
        if (wavesurferRef.current && waveBlobUrlRef.current) {
            waveformReadyRef.current = false;
            wavesurferRef.current.load(waveBlobUrlRef.current, peaks, newBuf.duration);
        }
        setSegments(reordered);
        setAudioDuration(newBuf.duration);
        setIsAnalysing(false);
        setTimeout(() => {
            const wavObj = audioBufferToWAV(newBuf);
            const newBlob = new Blob([wavObj], { type: 'audio/wav' });
            if (waveBlobUrlRef.current) URL.revokeObjectURL(waveBlobUrlRef.current);
            waveBlobUrlRef.current = URL.createObjectURL(newBlob);
            handleUpdateTrack(trackId, { initialSegments: reordered, audioBlob: newBlob, beatPositions: [] });
        }, 0);
    }, [trackId, handleUpdateTrack]);

    // Swap a segment one position left or right in the strip.
    const handleSwapSegment = useCallback((segId, direction) => {
        const liveSegs = segmentsRef.current;
        if (!liveSegs) return;
        const idx = liveSegs.findIndex(s => s.id === segId);
        if (idx === -1) return;
        const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= liveSegs.length) return;
        const newOrder = liveSegs.map(s => s.id);
        [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
        handleReorderSegments(newOrder);
    }, [handleReorderSegments]);

    // CTRL+S — split at playhead only for the card currently under the cursor.
    // CTRL+C / CTRL+V to copy/paste the active segment.
    useEffect(() => {
        if (!isExpanded || !audioUrl) return;
        const onKeyDown = (e) => {
            if (!isHoveredRef.current) return;
            
            if (matchesKeybind(e, settings.keybinds.splitAtPlayhead)) {
                e.preventDefault();
                handleSplit();
            }

            // Copy segment
            if (matchesKeybind(e, settings.keybinds.copySegment)) {
                const activeSeg = segments.find(s => s.id === activeSegmentIdRef.current);
                if (!activeSeg) return;
                
                const trackObj = AudioEngineService.tracks.get(trackId);
                if (!trackObj || !trackObj.audioBuffer) return;
                
                const buf = trackObj.audioBuffer;
                const sf = Math.floor(activeSeg.startPct * buf.length);
                const ef = Math.floor(activeSeg.endPct * buf.length);
                const len = ef - sf;
                if (len <= 0) return;
                
                const clipBuf = AudioEngineService.ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
                for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                    clipBuf.copyToChannel(buf.getChannelData(ch).subarray(sf, ef), ch);
                }
                
                const wavObj = audioBufferToWAV(clipBuf);
                const blob = new Blob([wavObj], { type: 'audio/wav' });
                
                window.__digideck_clipboard = {
                    blob,
                    buffer: clipBuf,
                    title: `Copied Segment (${trackName || 'Clip'})`,
                    bpm,
                    trackKey
                };
            }
            
            // Paste segment
            if (matchesKeybind(e, settings.keybinds.pasteSegment)) {
                const clip = window.__digideck_clipboard;
                if (!clip || !clip.buffer) return;
                e.preventDefault();
                
                setIsAnalysing(true);
                const trackObj = AudioEngineService.tracks.get(trackId);
                if (!trackObj || !trackObj.audioBuffer) {
                    setIsAnalysing(false);
                    return;
                }
                
                const oldBuf = trackObj.audioBuffer;
                const sr = oldBuf.sampleRate;
                const channels = oldBuf.numberOfChannels;
                
                const clipBuf = clip.buffer;
                const insertSec = Math.max(0, masterTimeRef.current - offsetSec);
                const insertFrame = Math.floor(insertSec * sr);
                const gapFrames = clipBuf.length;
                const gapSec = clipBuf.duration;
                
                // Account for pasting beyond the end of the current buffer
                const newLen = Math.max(insertFrame + gapFrames, oldBuf.length + gapFrames);
                const newBuf = AudioEngineService.ctx.createBuffer(channels, newLen, sr);
                
                for (let ch = 0; ch < channels; ch++) {
                    const newData = newBuf.getChannelData(ch);
                    const oldData = oldBuf.getChannelData(ch);
                    const clipData = clipBuf.getChannelData(ch);
                    
                    const safeFront = Math.min(insertFrame, oldBuf.length);
                    newData.set(oldData.subarray(0, safeFront), 0);
                    newData.set(clipData, insertFrame);
                    
                    if (insertFrame < oldBuf.length) {
                        newData.set(oldData.subarray(insertFrame), insertFrame + gapFrames);
                    }
                }
                
                const newDuration = newLen / sr;

                // Patch AudioEngine immediately
                trackObj.audioBuffer = newBuf;
                trackObj.duration = newBuf.duration;

                // Shift downstream segments right
                const updatedSegments = segments.map(s => {
                    const oldStartSec = s.startPct * oldBuf.duration;
                    const oldEndSec = s.endPct * oldBuf.duration;
                    let newStartSec = oldStartSec;
                    let newEndSec = oldEndSec;
                    if (oldStartSec >= insertSec - 0.00001) {
                        newStartSec += gapSec;
                        newEndSec += gapSec;
                    }
                    return { ...s, startPct: newStartSec / newDuration, endPct: newEndSec / newDuration };
                });

                // Add new pasted segment
                const newSegId = Date.now();
                updatedSegments.push({
                    id: newSegId,
                    startPct: insertSec / newDuration,
                    endPct: (insertSec + gapSec) / newDuration,
                    pitch: 0, speed: 1.0, fadeIn: 0, fadeOut: 0,
                    eqLow: 0, eqMid: 0, eqHigh: 0,
                    eqKills: { low: false, mid: false, high: false },
                    effects: []
                });

                const sortedSegments = updatedSegments.sort((a,b) => a.startPct - b.startPct);

                // Render waveform immediately from peaks
                const pastePeaks = computeWaveformPeaks(newBuf);
                if (wavesurferRef.current && waveBlobUrlRef.current) {
                    waveformReadyRef.current = false;
                    wavesurferRef.current.load(waveBlobUrlRef.current, pastePeaks, newDuration);
                }

                setSegments(sortedSegments);
                setAudioDuration(newDuration);
                setIsAnalysing(false);

                const newBeats = (beatPositions || []).map(b => b >= insertSec ? b + gapSec : b);

                // Defer WAV encode for persistence only
                setTimeout(() => {
                    const wavObj = audioBufferToWAV(newBuf);
                    const newBlob = new Blob([wavObj], { type: 'audio/wav' });
                    if (waveBlobUrlRef.current) URL.revokeObjectURL(waveBlobUrlRef.current);
                    waveBlobUrlRef.current = URL.createObjectURL(newBlob);
                    handleUpdateTrack(trackId, {
                        beatPositions: newBeats,
                        initialSegments: sortedSegments,
                        audioBlob: newBlob,
                        duration: newDuration,
                    });
                }, 0);
            }

            // Delete segment — physically splices audio region out of the buffer
            if (matchesKeybind(e, settings.keybinds.deleteSegment)) {
                const activeId = activeSegmentIdRef.current;
                const activeSeg = segments.find(s => s.id === activeId);
                if (!activeSeg) return;
                // Must have at least one other segment remaining
                if (segments.length <= 1) return;
                e.preventDefault();

                const trackObj = AudioEngineService.tracks.get(trackId);
                if (!trackObj?.audioBuffer) return;

                const oldBuf = trackObj.audioBuffer;
                const sr = oldBuf.sampleRate;
                const channels = oldBuf.numberOfChannels;
                const totalFrames = oldBuf.length;
                const sf = Math.floor(activeSeg.startPct * totalFrames);
                const ef = Math.floor(activeSeg.endPct * totalFrames);
                const segLen = ef - sf;
                if (segLen <= 0) return;

                const newTotalFrames = totalFrames - segLen;
                const newBuf = AudioEngineService.ctx.createBuffer(channels, newTotalFrames, sr);
                for (let ch = 0; ch < channels; ch++) {
                    const oldData = oldBuf.getChannelData(ch);
                    const newData = newBuf.getChannelData(ch);
                    if (sf > 0) newData.set(oldData.subarray(0, sf), 0);
                    if (ef < totalFrames) newData.set(oldData.subarray(ef), sf);
                }

                // Remap remaining segments: before deleted region keeps its frames;
                // after deleted region shifts left by segLen frames.
                const remaining = segments
                    .filter(s => s.id !== activeId)
                    .map(s => {
                        const oldSF = Math.floor(s.startPct * totalFrames);
                        const oldEF = Math.floor(s.endPct * totalFrames);
                        const newSF = oldSF >= ef ? oldSF - segLen : oldSF;
                        const newEF = oldEF >= ef ? oldEF - segLen : oldEF;
                        return { ...s, startPct: newSF / newTotalFrames, endPct: newEF / newTotalFrames };
                    });

                // Patch AudioEngine immediately so audio is correct
                trackObj.audioBuffer = newBuf;
                trackObj.duration = newBuf.duration;

                // Activate the first remaining segment
                const nextSeg = remaining[0];
                if (nextSeg) {
                    activeSegmentIdRef.current = nextSeg.id;
                    setActiveSegmentId(nextSeg.id);
                }

                // Render waveform immediately from peaks — segment vanishes from display at once
                const delPeaks = computeWaveformPeaks(newBuf);
                if (wavesurferRef.current && waveBlobUrlRef.current) {
                    waveformReadyRef.current = false;
                    wavesurferRef.current.load(waveBlobUrlRef.current, delPeaks, newBuf.duration);
                }

                setSegments(remaining);
                setAudioDuration(newBuf.duration);

                // Defer WAV encode purely for persistence
                setTimeout(() => {
                    const wavObj = audioBufferToWAV(newBuf);
                    const newBlob = new Blob([wavObj], { type: 'audio/wav' });
                    if (waveBlobUrlRef.current) URL.revokeObjectURL(waveBlobUrlRef.current);
                    waveBlobUrlRef.current = URL.createObjectURL(newBlob);
                    handleUpdateTrack(trackId, {
                        initialSegments: remaining,
                        audioBlob: newBlob,
                        duration: newBuf.duration,
                        beatPositions: [],
                    });
                }, 0);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isExpanded, audioUrl, handleSplit, settings.keybinds.splitAtPlayhead, settings.keybinds.copySegment, settings.keybinds.pasteSegment, settings.keybinds.deleteSegment, segments, trackId, bpm, trackKey, handleAddTrack, trackName, settings, masterTimeRef, beatPositions, handleUpdateTrack, offsetSec]);

    // Play Pause Sync
    useEffect(() => {
        if (!audioUrl) return;
        if (isPlaying && isVisible) {
            play();
            // Find which segment the playhead is currently in and apply its fadeIn.
            // Pre-set playingSegmentIdRef so the rAF loop doesn't double-apply on the first frame.
            const dur = durationRef.current;
            const segs = segmentsRef.current;
            if (dur > 0 && segs?.length > 0 && wavesurferRef.current) {
                const pct = wavesurferRef.current.getCurrentTime() / dur;
                const startSeg = segs.find(s => pct >= s.startPct && pct < s.endPct) ?? segs[0];
                playingSegmentIdRef.current = startSeg?.id ?? null;
                if (startSeg?.fadeIn > 0) applyFadeIn(startSeg.fadeIn);
            }
            fadeOutTriggeredRef.current = false;
        } else {
            pause();
        }
    }, [isPlaying, isVisible, play, pause, applyFadeIn, audioUrl]);

    // Sync per-track settings back to MixContext so they are captured by localStorage persistence.
    // hasMounted guard skips the initial render to avoid overwriting hydrated values with prop defaults.
    useEffect(() => {
        if (!hasMounted.current) {
            hasMounted.current = true;
            return;
        }
        handleUpdateTrack(trackId, {
            // Only persist the title if it's unique — don't overwrite good state with a duplicate
            ...(!isDuplicateName && { title: trackName.trim() }),
            initialVolume: volume,
            initialSpeed: speed,
            initialZoom: localZoom,
            initiallyExpanded: isExpanded,
            initialSegments: segmentsRef.current,
        }, true); // TRUE: Skip generic tracker history stack pollution for visual layout syncs!
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trackName, volume, speed, localZoom, isExpanded, segments, handleUpdateTrack, trackId]);

    // Setup polling for playhead sync + fade-out trigger.
    // Position is read from SoundTouch's stSource.position (in samples) so it
    // stays accurate when tempo != 1.0 — wall-clock time would drift at other speeds.
    useEffect(() => {
        let frameId;
        const updatePlayhead = () => {
            if (isPlaying && wavesurferRef.current && AudioEngineService.tracks.has(trackId)) {
                const track = AudioEngineService.tracks.get(trackId);

                // True audio position — stFilter.sourcePosition is the end-of-read cursor,
                // accurate at any tempo (wall-clock would drift at speed != 1.0).
                let audioPosSec = track.stFilter
                    ? track.stFilter.sourcePosition / track.audioBuffer.sampleRate
                    : (AudioEngineService.ctx.currentTime - track.startTime);

                // Stop at the end of the longest track in the workspace
                if (offsetSec + audioPosSec >= masterDuration && masterDuration > 0) {
                    setIsPlaying(false);
                    audioPosSec = masterDuration - offsetSec;
                    masterTimeRef.current = masterDuration;
                }

                // Smooth continuous playhead — no beat-floor snapping so the cursor moves
                // fluidly every frame. Beat-grid quantization is applied only on Ctrl+S splits.
                const displayProportion = Math.min(1, Math.max(0, audioPosSec / track.audioBuffer.duration));
                currentTimePctRef.current = displayProportion;
                wavesurferRef.current.seekTo(displayProportion);

                // Keep master clock in sync with local play so global play resumes from here.
                // Only when NOT universally playing — the master clock RAF owns masterTimeRef then.
                if (!universalIsPlaying) {
                    masterTimeRef.current = offsetSec + audioPosSec;
                }

                // Throttle timestamp display to ~10 fps to avoid excessive re-renders.
                const now = performance.now();
                if (now - lastTimestampUpdateRef.current >= 100) {
                    lastTimestampUpdateRef.current = now;
                    setDisplayTimeSec(audioPosSec);
                }

                // Determine which segment is currently playing — used for both
                // boundary detection and per-segment fade logic below.
                const segs = segmentsRef.current;
                let playingSeg = null;
                if (segs && segs.length > 0 && durationRef.current > 0) {
                    const pct = audioPosSec / durationRef.current;
                    playingSeg = segs.find(s => pct >= s.startPct && pct < s.endPct) ?? segs[segs.length - 1];
                }

                // Segment boundary detection — fires when the playhead enters a new segment.
                // Applies all per-segment audio settings (pitch, speed, EQ, effects, fade).
                if (playingSeg && playingSeg.id !== playingSegmentIdRef.current) {
                    playingSegmentIdRef.current = playingSeg.id;
                    fadeOutTriggeredRef.current = false;
                    const segKills = playingSeg.eqKills || { low: false, mid: false, high: false };
                    AudioEngineService.setPitch(trackId, playingSeg.pitch);
                    AudioEngineService.setSpeed(trackId, playingSeg.speed);
                    AudioEngineService.setEQ(trackId, {
                        low:  segKills.low  ? -40 : playingSeg.eqLow,
                        mid:  segKills.mid  ? -40 : playingSeg.eqMid,
                        high: segKills.high ? -40 : playingSeg.eqHigh,
                    });

                    // Reconcile effects chain for the incoming segment
                    const currEffects = effectsRef.current;
                    currEffects.forEach(e => AudioEngineService.removeEffect(trackId, e.id));
                    const newEffects = (playingSeg.effects || []).map(cfg => {
                        const id = AudioEngineService.addEffect(trackId, cfg.type);
                        if (id == null) return null;
                        AudioEngineService.setEffectEnabled(trackId, id, cfg.enabled);
                        Object.entries(cfg.params).forEach(([p, v]) => AudioEngineService.setEffectParam(trackId, id, p, v));
                        return { id, type: cfg.type, enabled: cfg.enabled, params: { ...cfg.params } };
                    }).filter(Boolean);
                    effectsRef.current = newEffects;

                    // Apply segment muting first — must be outside the activeSegmentId guard
                    // so it always fires on boundary crossing (the inner guard skips UI sync when
                    // activeSegmentId already tracks the playing segment).
                    const segMuted = playingSeg.isDeleted || playingSeg.isMuted || false;
                    isSegmentMutedRef.current = segMuted;
                    if (!isMutedRef.current && isVisibleRef.current) {
                        if (!segMuted) {
                            // Entering an unmuted segment — cancel any scheduled gain automation
                            // (e.g. from a previous mute or fade-out) before restoring volume.
                            const t = AudioEngineService.tracks.get(trackId);
                            if (t) {
                                t.gain.gain.cancelScheduledValues(AudioEngineService.ctx.currentTime);
                                t.gain.gain.setValueAtTime(t.targetVolume ?? (volumeRef.current / 100), AudioEngineService.ctx.currentTime);
                            }
                        }
                        setEngVolume(segMuted ? 0 : volumeRef.current / 100);
                    }

                    if (playingSeg.fadeIn > 0) {
                        applyFadeIn(playingSeg.fadeIn);
                    } else if (!segMuted) {
                        // Restore gain in case the previous segment faded out (only for unmuted
                        // segments — muted segments already set gain to 0 above).
                        const t = AudioEngineService.tracks.get(trackId);
                        if (t) {
                            t.gain.gain.cancelScheduledValues(AudioEngineService.ctx.currentTime);
                            t.gain.gain.setValueAtTime(t.targetVolume, AudioEngineService.ctx.currentTime);
                        }
                    }
                    // Sync UI to reflect the playing segment
                    if (playingSeg.id !== activeSegmentIdRef.current) {
                        activeSegmentIdRef.current = playingSeg.id;
                        setActiveSegmentId(playingSeg.id);
                        setPitch(playingSeg.pitch);
                        setSpeed(playingSeg.speed);
                        setFadeIn(playingSeg.fadeIn);
                        setFadeOut(playingSeg.fadeOut);
                        setEqLow(playingSeg.eqLow);
                        setEqMid(playingSeg.eqMid);
                        setEqHigh(playingSeg.eqHigh);
                        setEqKills(playingSeg.eqKills || { low: false, mid: false, high: false });
                        setEffects(newEffects);
                    }
                }

                // Per-segment fade-out: trigger when within fadeOut seconds of THIS segment's end,
                // not the track end — so every segment's fade-out fires at the right time.
                if (playingSeg && !fadeOutTriggeredRef.current && playingSeg.fadeOut > 0) {
                    const segEndSec = playingSeg.endPct * track.audioBuffer.duration;
                    const remaining = segEndSec - audioPosSec;
                    if (remaining <= playingSeg.fadeOut && remaining > 0) {
                        fadeOutTriggeredRef.current = true;
                        applyFadeOut(remaining);
                    }
                }

                // No auto-scroll needed: the waveform always auto-fits within the clip (no horizontal overflow).
            }
            frameId = requestAnimationFrame(updatePlayhead);
        };
        if (isPlaying) updatePlayhead();
        return () => cancelAnimationFrame(frameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying, trackId, applyFadeIn, applyFadeOut, waveformPixelWidth, offsetSec]);

    // ── Memoized effect visuals ─────────────────────────────────────────────────
    // Isolated from RAF/displayTimeSec updates — only rebuilds when segment data,
    // zoom, or duration change.
    const segmentEffectVisuals = useMemo(() => {
        if (!audioUrl || audioDuration <= 0) return null;
        // Canvas always fills clip via auto-fit — percentage positioning is always correct.
        const toLeft  = (pct) => `${pct * 100}%`;
        const toWidth = (pct) => `${pct * 100}%`;

        return segments.map(seg => {
            // For muted segments: render a mute overlay (hatching) but skip other effects
            if (seg.isDeleted) return null;

            const segL = toLeft(seg.startPct);
            const segW = toWidth(seg.endPct - seg.startPct);

            if (seg.isMuted) {
                return (
                    <div key={`segfx-${seg.id}`}
                        className="absolute top-0 bottom-0 pointer-events-none z-[5]"
                        style={{ left: segL, width: segW }}>
                        {/* Muted region — cross-hatch pattern + VolumeX icon overlay */}
                        <div className="absolute inset-0" style={{
                            backgroundImage: 'repeating-linear-gradient(135deg, rgba(8,10,14,0.20) 0px, rgba(8,10,14,0.20) 2px, transparent 2px, transparent 8px)',
                        }} />
                        <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-base-200"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                        </div>
                    </div>
                );
            }

            const fx    = seg.effects || [];
            const volFx = fx.find(e => e.type === 'volume' && e.enabled);

            // Volume line — always visible; position encodes gain (0→bottom, 1.0→center, 2.0→top)
            const gain   = volFx ? (volFx.params?.gain ?? 1.0) : 1.0;
            const volTop = `${(1 - Math.max(0, Math.min(1, gain / 2.0))) * 100}%`;

            // EQ — hidden when all bands at 0 and no kills
            const eqBands = [
                { v: seg.eqLow,  k: seg.eqKills?.low,  label: 'Low'  },
                { v: seg.eqMid,  k: seg.eqKills?.mid,  label: 'Mid'  },
                { v: seg.eqHigh, k: seg.eqKills?.high, label: 'High' },
            ];
            const hasEq = eqBands.some(b => b.k || b.v !== 0);

            // Fades — hidden when 0
            const fiFrac = seg.fadeIn  > 0 ? Math.min(seg.fadeIn  / audioDuration, seg.endPct - seg.startPct) : 0;
            const foFrac = seg.fadeOut > 0 ? Math.min(seg.fadeOut / audioDuration, seg.endPct - seg.startPct) : 0;

            return (
                <React.Fragment key={`segfx-${seg.id}`}>
                    {/* Fade In — dark triangle, right angle at top-left */}
                    {fiFrac > 0 && (
                        <div className="absolute top-0 bottom-0 pointer-events-none z-[5]"
                            style={{ left: toLeft(seg.startPct), width: toWidth(fiFrac) }}>
                            <div className="absolute inset-0" style={{ background: 'rgba(8,10,14,0.55)', clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' }} />
                        </div>
                    )}
                    {/* Fade Out — dark triangle, right angle at top-right */}
                    {foFrac > 0 && (
                        <div className="absolute top-0 bottom-0 pointer-events-none z-[5]"
                            style={{ left: toLeft(seg.endPct - foFrac), width: toWidth(foFrac) }}>
                            <div className="absolute inset-0" style={{ background: 'rgba(8,10,14,0.55)', clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' }} />
                        </div>
                    )}

                    {/* Segment-scoped overlays — volume line and EQ bars only, no colour tints */}
                    <div className="absolute top-0 bottom-0 pointer-events-none overflow-hidden z-[4]"
                        style={{ left: segL, width: segW }}>

                        {/* Volume line — always visible */}
                        <div className="absolute left-0 right-0 pointer-events-none"
                            style={{ top: volTop, height: '2px', backgroundColor: 'rgba(251,146,60,0.9)' }} />

                        {/* EQ bars — only when non-default */}
                        {hasEq && (
                            <div className="absolute top-0 left-0 right-0 flex pointer-events-none" style={{ height: 10 }}>
                                {eqBands.map(({ v, k, label }, i) => {
                                    if (k)    return <div key={i} title={`${label}: Killed`} className="flex-1 mx-px" style={{ backgroundColor: 'rgba(239,68,68,0.85)' }} />;
                                    if (!v)   return null;
                                    const op  = Math.max(0.45, Math.min(0.90, Math.abs(v) / 15));
                                    return <div key={i} title={`${label}: ${v > 0 ? '+' : ''}${v} dB`} className="flex-1 mx-px" style={{ backgroundColor: v > 0 ? `rgba(74,222,128,${op})` : `rgba(239,68,68,${op})` }} />;
                                })}
                            </div>
                        )}
                    </div>
                </React.Fragment>
            );
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segments, audioDuration, audioUrl]);

    return (
        <div className="relative">
            <div
                draggable={isDraggable}
                onMouseEnter={() => { isHoveredRef.current = true; }}
                onMouseLeave={() => { isHoveredRef.current = false; }}
                onDragStart={(e) => {
                    setTimeout(() => { e.target.classList.add('opacity-50'); }, 0);
                    if (onDragStart) onDragStart(e);
                }}
                onDragEnd={(e) => {
                    e.target.classList.remove('opacity-50');
                    if (onDragEnd) onDragEnd(e);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!isDragged && onDragHover) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onDragHover(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
                    }
                }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget) && onDragHover) onDragHover(null);
                }}
                className={`border-2 rounded-lg p-4 transition-all ${isExpanded || isMissing ? 'h-auto' : 'h-24'} cursor-pointer ${!isVisible || isMissing ? 'bg-base-900 border-base-800 opacity-60 grayscale-[0.5]' : 'bg-base-800'} ${isDragged ? 'opacity-50' : ''} ${isExpanded ? 'border-base-500' : 'border-base-700'}`}
                onClick={() => !isEditing && setIsExpanded(!isExpanded)}
            >
                <div className="flex justify-between items-center mb-4 gap-2">
                    <div
                        className="flex items-center gap-2 relative group min-w-0"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <input
                            type="text"
                            value={trackName}
                            onChange={(e) => setTrackName(e.target.value)}
                            disabled={!isEditing}
                            style={{ width: getDynamicInputWidth(trackName, 7), maxWidth: '20ch' }}
                            className={`text-base-50 font-semibold px-1 py-1 rounded outline-none transition-colors cursor-text text-lg text-ellipsis overflow-hidden ${isEditing ? (isDuplicateName ? 'bg-danger-900/30 ring-1 ring-danger-500/60' : 'bg-base-900') : 'bg-transparent'}`}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !isDuplicateName) { setTrackName(t => t.trim()); setIsEditing(false); } }}
                        />
                        <button
                            onClick={() => { if (!isDuplicateName) { setTrackName(t => t.trim()); setIsEditing(e => !e); } }}
                            className={`transition-colors p-1 rounded border ${isEditing ? (isDuplicateName ? 'bg-danger-900/30 text-danger-400 border-danger-500/60 cursor-not-allowed' : 'bg-base-900 text-base-50 border-base-500') : 'bg-transparent border-transparent text-base-300 hover:text-base-50 hover:border-base-400'}`}
                            title={isDuplicateName ? 'Track name already in use' : 'Rename track'}
                        >
                            <Pencil size={16} />
                        </button>
                        {isEditing && isDuplicateName && (
                            <span className="text-xs font-medium text-danger-400 whitespace-nowrap truncate shrink-0">Name already in use</span>
                        )}
                        {isReidentifying && (
                            <Loader2 size={13} className="animate-spin text-base-400 shrink-0" title="Finding on Spotify…" />
                        )}

                        {audioUrl && (
                        <div className="flex flex-wrap items-center text-xs text-base-400 ml-2 md:ml-4 gap-2 md:gap-3 min-w-0 shrink">
                            <span className="flex items-center gap-1 min-w-0 shrink">
                                <span className="text-base-300 font-medium whitespace-nowrap hidden sm:inline">Artist:</span>
                                {artistName === '[Artist Name]' && isAnalysing
                                    ? <span className="w-3 h-3 rounded-full border border-base-600 border-t-base-300 animate-spin inline-block" />
                                    : <span className="text-base-200 truncate" title={artistName}>{artistName}</span>
                                }
                            </span>
                            <div className="w-1 h-1 shrink-0 rounded-full bg-base-600 hidden xs:block"></div>
                            <span className="flex items-center gap-1 shrink-0">
                                <span className="text-base-300 font-medium whitespace-nowrap hidden md:inline">BPM:</span>
                                {bpm === '[BPM]' && isAnalysing
                                    ? <span className="w-3 h-3 rounded-full border border-base-600 border-t-base-300 animate-spin inline-block" />
                                    : <span className="text-base-200 whitespace-nowrap">{bpm}</span>
                                }
                            </span>
                            <div className="w-1 h-1 shrink-0 rounded-full bg-base-600 hidden xs:block"></div>
                            <span className="flex items-center gap-1 shrink-0">
                                <span className="text-base-300 font-medium whitespace-nowrap hidden lg:inline">Key:</span>
                                {trackKey === '[key]' && isAnalysing
                                    ? <span className="w-3 h-3 rounded-full border border-base-600 border-t-base-300 animate-spin inline-block" />
                                    : <span className="text-base-200 whitespace-nowrap">{trackKey}</span>
                                }
                            </span>
                            {isOutOfSyncWithMaster && (
                                <>
                                    <div className="w-1 h-1 shrink-0 rounded-full bg-base-600 hidden xs:block"></div>
                                    <div
                                        className="flex items-center gap-1 text-[11px] text-caution-400/80"
                                        title={`Track is at ≈${effectiveBpm} BPM — Sync or Sync All will set speed to match Master BPM (${masterBpm})`}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <AlertTriangle size={11} className="shrink-0" />
                                        <span className="whitespace-nowrap">Not synced to master ({effectiveBpm} BPM)</span>
                                    </div>
                                </>
                            )}
                        </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                        <div className="flex items-center gap-1 bg-base-900 rounded border border-base-700 p-0.5" onClick={(e) => e.stopPropagation()}>
                            <button
                                onMouseEnter={() => setIsDraggable(true)}
                                onMouseLeave={() => setIsDraggable(false)}
                                className="p-1.5 rounded transition-colors text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95 cursor-grab active:cursor-grabbing"
                                title="Drag to move track"
                            >
                                <Move size={14} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onDuplicate) {
                                        onDuplicate({
                                            title: trackName,
                                            initialVolume: volume,
                                            initialZoom: globalZoom,
                                            initialSegments: segmentsRef.current,
                                        });
                                    }
                                }}
                                className="p-1.5 rounded transition-colors text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95"
                                title="Duplicate track"
                            >
                                <Copy size={14} />
                            </button>
                            <div className="w-px h-4 bg-base-700 mx-0.5"></div>
                            <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete && onDelete();
                                    }}
                                    className="p-1.5 rounded transition-colors text-base-500 hover:text-base-50 hover:bg-base-400 active:scale-95"
                                    title="Delete track"
                                >
                                    <Trash2 size={14} />
                                </button>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }}
                            className="text-xs font-semibold text-base-300 px-3 py-1.5 bg-base-900 rounded hover:text-base-50 hover:bg-base-700 active:scale-95 transition-all"
                        >
                            {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                    </div>
                </div>

                {isMissing && !missingDismissed && (
                    <div className="flex items-start gap-2 mt-3 px-3 py-2 rounded border border-danger-500/30 bg-danger-500/10" onClick={(e) => e.stopPropagation()}>
                        <AlertTriangle size={13} className="text-danger-400 shrink-0 mt-px" />
                        <span className="text-[11px] text-danger-300 leading-snug flex-1">File missing from imports. Re-upload the exact file to restore.</span>
                        <button
                            onClick={() => setMissingDismissed(true)}
                            className="text-danger-500 hover:text-danger-200 transition-colors shrink-0"
                            title="Dismiss"
                        >
                            <X size={13} />
                        </button>
                    </div>
                )}

                {/* Controls & Visualizer — only rendered when audio is attached.
                     Kept in DOM when collapsed (CSS hidden) so WaveSurfer's ResizeObserver redraws on expand.
                     items-stretch (default) makes both columns the same height so zoom aligns with volume. */}
                {audioUrl && <div className={`flex gap-4 w-full mt-2${isExpanded ? '' : ' hidden'}`} onClick={(e) => e.stopPropagation()}>
                    {/* Track Controls Left Panel */}
                    <div className="flex flex-col w-32 shrink-0 gap-2 overflow-hidden">
                        {/* Image Placeholder / Album Art — fixed square so loaded art never expands the row */}
                        <div
                            className={`w-full aspect-square shrink-0 bg-base-900 border border-base-700 rounded flex items-center justify-center overflow-hidden transition-colors shadow-sm ${!isVisible ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-base-500'}`}
                            title={`[${trackName}]`}
                        >
                            {albumArt ? (
                                <img src={albumArt} alt={trackName} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-xs text-base-300 font-medium select-none">No Art</span>
                            )}
                        </div>

                        {/* Toggle Buttons */}
                        <div className="flex justify-between gap-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isPlaying) {
                                        // Sync master clock before the RAF loop starts so that
                                        // pressing global play immediately after picks up this position.
                                        const localSec = (currentTimePctRef.current || 0) * (durationRef.current || 0);
                                        masterTimeRef.current = offsetSec + localSec;
                                    }
                                    if (!isPlaying) {
                                        if (masterTimeRef.current >= masterDuration && masterDuration > 0) {
                                            masterTimeRef.current = 0;
                                            handleSeekMaster(0);
                                        }
                                    }
                                    setIsPlaying(!isPlaying);
                                }}
                                disabled={!isVisible || !audioUrl || isMissing}
                                title={isMissing ? 'File missing from imports' : !audioUrl ? 'No preview available' : undefined}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible || !audioUrl || isMissing ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed' : isPlaying ? 'bg-base-500 text-base-50 border-base-400' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                            >
                                {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (segments.length > 1) {
                                        // Multi-segment: mute only the active segment
                                        const activeSeg = segmentsRef.current?.find(s => s.id === activeSegmentIdRef.current);
                                        if (!activeSeg) return;
                                        const next = !activeSeg.isMuted;
                                        syncActiveSegmentSettings({ isMuted: next });
                                        const segMuted = activeSeg.isDeleted || next;
                                        if (!isMutedRef.current && isVisibleRef.current) setEngVolume(segMuted ? 0 : volumeRef.current / 100);
                                    } else {
                                        // Single segment: mute the whole track as before
                                        setIsMuted(!isMuted);
                                    }
                                }}
                                disabled={!isVisible}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border font-bold text-xs gap-1 ${
                                    !isVisible
                                        ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed'
                                        : (segments.length > 1
                                            ? (segments.find(s => s.id === activeSegmentId)?.isMuted)
                                            : isMuted)
                                            ? 'bg-mark text-mark-fg border-mark-border shadow-mark'
                                            : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'
                                }`}
                            >
                                {(segments.length > 1
                                    ? (segments.find(s => s.id === activeSegmentId)?.isMuted)
                                    : isMuted) ? <VolumeX size={14} /> : <Volume2 size={14} />}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsVisible(!isVisible); }}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible ? 'bg-base-800 text-base-50 border-base-600 hover:border-base-400' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                            >
                                {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                        </div>

                        {/* Volume Slider */}
                        <div className="flex items-center gap-1.5 w-full mt-1" onClick={(e) => e.stopPropagation()}>
                            <Volume2 size={12} className="text-base-300 shrink-0" />
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={volume}
                                disabled={!isVisible}
                                onChange={(e) => setVolume(e.target.value)}
                                className={`w-full h-1 bg-base-700 rounded-lg appearance-none accent-base-500 outline-none ${!isVisible ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                            />
                        </div>



                        {/* Sync + Extract */}
                        <div className="flex gap-1.5 w-full mt-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={handleSync}
                                disabled={!isVisible || !audioUrl || bpm === '[BPM]' || isNaN(parseFloat(bpm))}
                                className="flex-1 min-w-0 text-[10px] font-bold tracking-wider uppercase rounded py-2 transition-colors border bg-base-900 border-base-700 text-base-300 hover:text-base-50 hover:border-base-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 text-center truncate"
                                title={bpm === '[BPM]' ? 'Waiting for analysis...' : `Sync segment to Master BPM (${masterBpm})`}
                            >
                                Sync
                            </button>
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    const seg = segmentsRef.current.find(s => s.id === activeSegmentIdRef.current);
                                    if (!seg) return;

                                    const trackObj = AudioEngineService.tracks.get(trackId);
                                    if (!trackObj || !trackObj.audioBuffer) return;

                                    const oldBuf = trackObj.audioBuffer;
                                    const startFrame = Math.floor(seg.startPct * oldBuf.length);
                                    const endFrame = Math.floor(seg.endPct * oldBuf.length);
                                    const newLen = endFrame - startFrame;
                                    if (newLen <= 0) return;

                                    const newBuf = AudioEngineService.ctx.createBuffer(oldBuf.numberOfChannels, newLen, oldBuf.sampleRate);
                                    for (let i = 0; i < oldBuf.numberOfChannels; i++) {
                                        newBuf.getChannelData(i).set(oldBuf.getChannelData(i).subarray(startFrame, endFrame));
                                    }

                                    const wavObj = audioBufferToWAV(newBuf);
                                    const segOffsetSec = seg.startPct * oldBuf.duration;
                                    const newBeats = (beatPositions || [])
                                        .filter(b => b >= segOffsetSec && b <= seg.endPct * oldBuf.duration)
                                        .map(b => b - segOffsetSec);

                                    const extractedBlob = new Blob([wavObj], { type: 'audio/wav' });
                                    // Deep copy — extracted track shares no object references with the source
                                    handleAddTrack({
                                        title: `${trackName} (Extracted)`,
                                        audioUrl: URL.createObjectURL(extractedBlob),
                                        audioBlob: extractedBlob,
                                        spotifyId: null,
                                        originalSourceId: spotifyId || audioUrl,
                                        artistName,
                                        albumArt,
                                        bpm,
                                        trackKey,
                                        beatPositions: [...newBeats],
                                        initialVolume: volume,
                                        initialSegments: [{
                                            ...seg,
                                            id: Date.now(),
                                            startPct: 0,
                                            endPct: 1,
                                            fadeIn: 0,
                                            fadeOut: 0,
                                            eqKills: { ...(seg.eqKills || {}) },
                                            effects: (seg.effects || []).map(ef => ({ ...ef, params: { ...ef.params } })),
                                        }],
                                    });
                                }}
                                disabled={!isVisible || !audioUrl}
                                className="flex-1 min-w-0 text-[10px] font-bold tracking-wider uppercase rounded py-2 transition-colors border bg-base-900 border-base-700 text-base-300 hover:text-base-50 hover:border-base-500 disabled:opacity-40 active:scale-95 text-center truncate"
                                title="Extract this segment into a new track (carries all effects & settings)"
                            >
                                Extract
                            </button>
                        </div>
                    </div>

                    {/* Right column (Timeline Lane) — fixed-width TIMELINE reference. All clips share this same lane width.
                         Shorter tracks occupy a proportional slice with trailing whitespace (DAW-style). */}
                    <div ref={laneRef} className="flex flex-col flex-1 min-w-0 bg-lane-bg border-l border-base-700/50 shadow-inner relative overflow-hidden">
                        {/* Scrollable viewport — wheel events change zoom (preventDefault stops browser scroll).
                             scrollLeft is set programmatically to follow the playhead on zoom changes. */}
                        <div
                            ref={scrollContainerRef}
                            className="absolute inset-0 overflow-x-hidden"
                        >
                        {/* Timeline content — zoomMultiplier × lane width. Clip is positioned within. */}
                        <div
                            className="h-full relative"
                            style={{ width: `${zoomMultiplier * 100}%`, minWidth: '100%' }}
                        >
                        {/* Track clip — proportional slice of the timeline */}
                        <div
                            className="absolute top-0 bottom-0 flex flex-col bg-base-900 border border-base-700 shadow-xl rounded overflow-hidden"
                            style={{
                                left: masterDuration > 0 ? `${(offsetSec / masterDuration) * 100}%` : '0%',
                                width: masterDuration > 0 ? `${clipProportion * 100}%` : '100%',
                                transition: isDragged ? 'none' : 'left 0.1s ease-out'
                            }}
                        >
                            {/* Inner canvas — fills the clip. WaveSurfer auto-fits to this width. */}
                            <div
                                className="flex flex-col flex-1 overflow-x-hidden overflow-y-hidden bg-base-900"
                            >
                                <div style={{ width: '100%', minWidth: '100%', flex: '1 0 0', position: 'relative' }}>
                                    
                                    {/* WaveSurfer rendering target */}
                                    <div ref={waveformRef} className="absolute inset-0"></div>
                                    
                                    {/* Locked Visual Overlay Target */}
                                    <div className="absolute inset-0 pointer-events-none z-[15]">
                                        
                                        {/* Per-segment effect visuals — memoized, isolated from RAF ticks */}
                                        {segmentEffectVisuals}

                                        {/* Beat markers — single set, visible at localZoom >= 65.
                                            Essentia beats (raw buffer-time positions) are preferred: the waveform
                                            display already applies speed via effectiveDuration, so these naturally
                                            compress/expand to align with master BPM after a sync — no separate
                                            adjustment needed. Fall back to the master beat grid only when Essentia
                                            analysis hasn't produced beat data yet. */}
                                        {localZoom >= 120 && audioDuration > 0 && containerWidth > 0 && (
                                            beatPositions && beatPositions.length > 0 ? (
                                                <div className="absolute inset-0 pointer-events-none z-[13]">
                                                    {beatPositions.map((t, i) => (
                                                        <div
                                                            key={`beat-${i}`}
                                                            className="absolute top-0 bottom-0 w-px bg-base-700"
                                                            style={{ left: `${(t / audioDuration) * 100}%` }}
                                                        />
                                                    ))}
                                                </div>
                                            ) : masterBeatGrid.length > 0 ? (
                                                <div className="absolute inset-0 pointer-events-none z-[13]">
                                                    {masterBeatGrid.map((t, i) => (
                                                        <div
                                                            key={`mbg-${i}`}
                                                            className="absolute top-0 bottom-0 w-px bg-base-600/30"
                                                            style={{ left: `${(t * parseFloat(speed) / audioDuration) * 100}%` }}
                                                        />
                                                    ))}
                                                </div>
                                            ) : null
                                        )}


                                        {/* Segment region highlights — click to seek + activate. Reorder via strip below. */}
                                        {audioUrl && segments.map(seg => {
                                            const isActive = seg.id === activeSegmentId;
                                            const left  = `${seg.startPct * 100}%`;
                                            const width = `${(seg.endPct - seg.startPct) * 100}%`;
                                            return (
                                                <div
                                                    key={`hl-${seg.id}`}
                                                    className={`absolute top-0 bottom-0 pointer-events-auto rounded-sm z-[3]
                                                        ${seg.isDeleted ? '' : 'cursor-pointer'}
                                                        ${isActive && !seg.isDeleted && !seg.isMuted ? 'border-2 border-base-450/80'
                                                            : !seg.isDeleted && !seg.isMuted ? 'border border-base-100/20'
                                                            : ''}
                                                        ${seg.isDeleted ? 'bg-base-900/95 border-y-2 border-dashed border-base-600 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]'
                                                            : seg.isMuted ? 'bg-black/60 grayscale backdrop-brightness-50'
                                                            : ''}`}
                                                    style={{ left, width }}
                                                    onMouseDown={(e) => handleSegmentOverlayMouseDown(e, seg)}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Segment strip — always fills clip width (100%). Canvas has no horizontal overflow. */}
                                {audioUrl && segments.length > 0 && (
                                    <div className="flex items-stretch border-t border-base-700/50 bg-lane-strip shrink-0"
                                        style={{ width: '100%', minWidth: '100%', height: 32 }}>
                                        {segments.map((seg, idx) => {
                                            const canLeft  = idx > 0 && segments.length > 1;
                                            const canRight = idx < segments.length - 1;
                                            const blockW   = `${(seg.endPct - seg.startPct) * 100}%`;
                                            return (
                                                <div
                                                    key={`strip-${seg.id}`}
                                                    className={`relative flex items-center justify-center select-none group
                                                        border-r border-base-700/30 last:border-r-0 overflow-hidden transition-colors shrink-0
                                                        ${seg.isDeleted ? 'opacity-20 cursor-default' : 'cursor-pointer'}
                                                        ${seg.isMuted ? 'opacity-40' : ''}
                                                        hover:bg-base-800/60`}
                                                    style={{ width: blockW, minWidth: 24 }}
                                                    onClick={(e) => { e.stopPropagation(); if (!seg.isDeleted) activateSegmentRef.current?.(seg.id); }}
                                                    title={`Segment ${idx + 1}${seg.isMuted ? ' (muted)' : ''}${seg.isDeleted ? ' (deleted)' : ''}`}
                                                >
                                                    {canLeft && (
                                                        <button
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            onClick={(e) => { e.stopPropagation(); handleSwapSegment(seg.id, 'left'); }}
                                                            className="absolute left-0 top-0 bottom-0 px-1 flex items-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-r from-base-700/80 to-transparent text-base-200 hover:text-white text-sm font-bold z-10"
                                                            title="Move segment left"
                                                        >‹</button>
                                                    )}
                                                    <span className="text-[11px] font-mono font-bold leading-none z-[1] pointer-events-none text-base-400">
                                                        {seg.isDeleted ? '✕' : seg.isMuted ? `${idx + 1}M` : idx + 1}
                                                    </span>
                                                    {canRight && (
                                                        <button
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            onClick={(e) => { e.stopPropagation(); handleSwapSegment(seg.id, 'right'); }}
                                                            className="absolute right-0 top-0 bottom-0 px-1 flex items-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-base-700/80 to-transparent text-base-200 hover:text-white text-sm font-bold z-10"
                                                            title="Move segment right"
                                                        >›</button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                        </div>{/* end timeline content */}
                        </div>{/* end scrollable viewport */}

                    </div>
                </div>}

                {/* Below-waveform bar: Settings toggle + timestamp + per-track zoom — same horizontal axis */}
                {isExpanded && (
                    <div className="flex items-center w-full mt-2 gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                            disabled={!isVisible}
                            className={`flex items-center gap-2 text-sm font-bold transition-colors outline-none p-1 rounded shrink-0 ${!isVisible ? 'text-base-700 cursor-not-allowed' : 'text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95'}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsSettingsExpanded(!isSettingsExpanded);
                            }}
                        >
                            Settings
                            {isSettingsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>

                        {/* Per-track zoom slider */}
                        {audioUrl && (
                            <div className="flex items-center gap-1.5 group shrink-0" onClick={(e) => e.stopPropagation()}>
                                <ZoomIn size={11} className="text-base-600 group-hover:text-base-400 transition-colors shrink-0" />
                                <div className="flex flex-col gap-0">
                                    <input
                                        type="range"
                                        min="0"
                                        max="400"
                                        step="10"
                                        value={localZoom}
                                        disabled={!isVisible}
                                        onChange={(e) => setLocalZoom(parseInt(e.target.value, 10))}
                                        className={`w-28 h-1 bg-base-700 rounded-lg appearance-none accent-base-500 outline-none ${!isVisible ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                    />
                                    <div className="flex justify-between w-28 px-px mt-0.5">
                                        {[1,2,3,4,5].map(n => (
                                            <span key={n} className="text-[7px] font-mono text-base-700 leading-none">{n}</span>
                                        ))}
                                    </div>
                                </div>
                                <span className="text-[10px] font-mono text-base-600 group-hover:text-base-400 transition-colors w-8 text-right tabular-nums">
                                    {(1 + localZoom / 100).toFixed(1)}×
                                </span>
                            </div>
                        )}

                        <span className="text-[10px] font-mono text-base-50 tabular-nums select-none ml-auto">
                            {formatTimestamp(displayTimeSec)} / {formatTimestamp((audioDuration || 0) + (offsetSec || 0))}
                        </span>
                    </div>
                )}

                {/* Collapsible Settings panel — toggle button lives in the bar above */}
                {isExpanded && isSettingsExpanded && (
                    <div className={`w-full bg-base-900 rounded-lg p-5 border border-base-700 flex flex-col gap-6 transition-opacity ${!isVisible ? 'opacity-50 pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>

                                {/* Segment indicator — shows which segment's settings are active */}
                                {segments.length > 1 && (() => {
                                    const activeSeg = segments.find(s => s.id === activeSegmentId);

                                    return (
                                        <div className="flex items-center gap-2 pb-1 border-b border-base-700/60">
                                            <span className="text-xs font-bold text-base-400 uppercase tracking-wider">Editing:</span>
                                            <div className="flex gap-1">
                                                {segments.map((seg, idx) => (
                                                    <button
                                                        key={seg.id}
                                                        onClick={(e) => { e.stopPropagation(); activateSegmentRef.current?.(seg.id); }}
                                                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-colors
                                                            ${seg.id === activeSegmentId
                                                                ? 'bg-base-500 text-base-50'
                                                                : 'bg-base-800 text-base-400 hover:text-base-100 hover:bg-base-700'}
                                                            ${seg.isMuted ? 'ring-1 ring-caution-400/60' : ''}`}
                                                        title={`Switch to Segment ${idx + 1}${seg.isMuted ? ' (muted)' : ''}`}
                                                    >
                                                        {idx + 1}{seg.isMuted ? 'M' : ''}
                                                    </button>
                                                ))}
                                            </div>
                                            {activeSeg?.isMuted && (
                                                <span className="text-[11px] text-caution-400 font-semibold ml-1">· muted</span>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="grid grid-cols-2 gap-8 pt-2">
                                    {/* Fades */}
                                    <div className="flex flex-col gap-3">
                                        <h4 className="text-xs font-bold text-base-400 uppercase tracking-wider">Basic Controls</h4>
                                        <FadeField label="Fade In"  value={fadeIn}  onChange={setFadeInWithSync}  onReset={() => setFadeInWithSync(0)} />
                                        <FadeField label="Fade Out" value={fadeOut} onChange={setFadeOutWithSync} onReset={() => setFadeOutWithSync(0)} />
                                    </div>

                                    {/* Audio Adjustments */}
                                    <div className="flex flex-col gap-3">
                                        <h4 className="text-xs font-bold text-base-400 uppercase tracking-wider">Audio Adjustments</h4>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                                                Pitch
                                                {pitch !== 0 && (
                                                    <button onClick={(e) => { e.stopPropagation(); setPitchWithSync(0); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to default">
                                                        <RotateCcw size={12} />
                                                    </button>
                                                )}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setPitchWithSync(pitch - 1); }}
                                                    className="bg-base-800 border border-base-700 rounded w-7 h-7 flex items-center justify-center text-base-300 hover:text-base-50 hover:border-base-500 active:scale-95 font-mono leading-none"
                                                >
                                                    -
                                                </button>
                                                <span className="text-sm font-mono text-base-50 w-8 text-center bg-base-800/50 py-1 rounded">{pitch}st</span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setPitchWithSync(pitch + 1); }}
                                                    className="bg-base-800 border border-base-700 rounded w-7 h-7 flex items-center justify-center text-base-300 hover:text-base-50 hover:border-base-500 active:scale-95 font-mono leading-none"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="flex items-center gap-2 text-sm font-medium text-base-300">
                                                {/* Label is the toggle: click to switch Speed ↔ Target BPM */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm))) {
                                                            setUseTargetBpmMode(v => !v);
                                                        }
                                                    }}
                                                    className={`transition-colors text-base-300 ${
                                                        bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm))
                                                            ? 'hover:text-base-100 cursor-pointer'
                                                            : 'cursor-default'
                                                    }`}
                                                    title={
                                                        bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm))
                                                            ? useTargetBpmMode
                                                                ? 'Click to switch to Speed slider'
                                                                : 'Click to switch to Target BPM input'
                                                            : 'Speed'
                                                    }
                                                >
                                                    {useTargetBpmMode ? 'Target BPM' : 'Speed'}
                                                </button>
                                                {!useTargetBpmMode && parseFloat(speed) !== 1.0 && (
                                                    <button onClick={(e) => { e.stopPropagation(); setSpeedWithSync(1.0); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to 1.0x">
                                                        <RotateCcw size={12} />
                                                    </button>
                                                )}
                                            </span>

                                            {/* Speed slider mode */}
                                            {!useTargetBpmMode && (
                                                <div className="flex items-center gap-3 justify-end">
                                                    {speedInputVal !== null ? (
                                                        <input
                                                            type="text"
                                                            value={speedInputVal}
                                                            autoFocus
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => setSpeedInputVal(e.target.value)}
                                                            onBlur={(e) => {
                                                                e.stopPropagation();
                                                                const parsed = parseFloat(speedInputVal);
                                                                if (!isNaN(parsed)) setSpeedWithSync(Math.min(SPEED_MAX, Math.max(SPEED_MIN, parsed)));
                                                                setSpeedInputVal(null);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                e.stopPropagation();
                                                                if (e.key === 'Enter') e.target.blur();
                                                                if (e.key === 'Escape') setSpeedInputVal(null);
                                                            }}
                                                            className="bg-base-800 border border-base-700 rounded px-2.5 py-1 w-16 text-xs font-mono text-base-50 focus:border-base-500 outline-none text-right"
                                                        />
                                                    ) : (
                                                        <span
                                                            className="text-xs font-mono text-base-300 w-10 text-right cursor-text hover:text-base-100 transition-colors mt-0.5"
                                                            title="Click to edit speed"
                                                            onClick={(e) => { e.stopPropagation(); setSpeedInputVal(Number(speed).toFixed(2)); }}
                                                        >
                                                            {Number(speed).toFixed(2)}x
                                                        </span>
                                                    )}
                                                    <input
                                                        type="range"
                                                        min={SPEED_MIN}
                                                        max={SPEED_MAX}
                                                        step="0.01"
                                                        value={speed}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => { e.stopPropagation(); setSpeedWithSync(parseFloat(e.target.value)); }}
                                                        className="w-20 h-1 bg-base-700 rounded-lg appearance-none cursor-pointer accent-base-500 outline-none"
                                                    />
                                                </div>
                                            )}

                                            {/* Target BPM mode — type a desired BPM, speed auto-calculates from original BPM */}
                                            {useTargetBpmMode && bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm)) && (
                                                <div className="flex items-center justify-end gap-2">
                                                    <input
                                                        type="number"
                                                        min="20"
                                                        max="300"
                                                        step="1"
                                                        defaultValue={effectiveBpm ?? Math.round(parseFloat(bpm))}
                                                        key={`${bpm}-${speed}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }}
                                                        onBlur={(e) => {
                                                            e.stopPropagation();
                                                            const targetBpm = parseFloat(e.target.value);
                                                            const originalBpm = originalBpmRef.current ?? parseFloat(bpm);
                                                            if (!isNaN(targetBpm) && originalBpm > 0) {
                                                                const newSpeed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, targetBpm / originalBpm));
                                                                setSpeedWithSync(newSpeed);
                                                            }
                                                        }}
                                                        className="bg-base-800 border border-base-700 rounded px-2.5 py-1 w-24 text-xs font-mono text-base-50 focus:border-base-500 outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        title="Type target BPM — speed adjusts automatically from original BPM"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Gate G6 — warn when pitch or speed exceed quality thresholds.
                                     Once dismissed on this card it never reappears, regardless of
                                     value changes. Each card tracks dismissal independently. */}
                                {!g6Dismissed && (Math.abs(pitch) > 3 || parseFloat(speed) < 0.85 || parseFloat(speed) > 1.15) && (
                                    <div className="flex items-center gap-2 bg-base-800 border border-base-400/60 rounded-lg px-3 py-2 mt-4" onClick={(e) => e.stopPropagation()}>
                                        <AlertTriangle size={11} className="text-caution-400/80 shrink-0" />
                                        <span className="text-[10px] text-base-300 leading-snug flex-1">
                                            Audible artefacts may occur at this setting:{' '}
                                            <span className="text-base-200 font-medium">
                                                {[
                                                    Math.abs(pitch) > 3 && `Pitch (${pitch > 0 ? '+' : ''}${pitch}st)`,
                                                    (parseFloat(speed) < 0.85 || parseFloat(speed) > 1.15) && `Speed (${Number(speed).toFixed(2)}x)`,
                                                ].filter(Boolean).join(', ')}
                                            </span>
                                        </span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setG6Dismissed(true); }}
                                            className="text-base-500 hover:text-base-200 transition-colors shrink-0 ml-1"
                                            title="Dismiss warning"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                )}

                                {audioDropped && (
                                    <div className="flex items-center gap-2 bg-caution-900/20 border border-caution-500/30 rounded-lg px-3 py-2 mt-4" onClick={(e) => e.stopPropagation()}>
                                        <AlertTriangle className="text-caution-400 mt-0.5 shrink-0" size={16} />
                                        <div className="flex-1">
                                            <p className="text-xs text-caution-300 font-medium leading-relaxed">Audio Processing Drop</p>
                                            <p className="text-[10px] text-caution-400/80 mt-1">High CPU load caused an audio buffer underrun. The audio may stutter or drop briefly.</p>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); setAudioDropped(false); }} className="text-caution-500 hover:text-caution-300 p-1" title="Dismiss">
                                            <X size={14} />
                                        </button>
                                    </div>
                                )}

                                {/* EQ + Effects — always visible, side by side */}
                                <div className={`flex gap-4 pt-4 border-t border-base-800 items-stretch ${effects.length > 0 ? 'h-[19rem]' : ''}`} onClick={(e) => e.stopPropagation()}>

                                    {/* Equalizer */}
                                    <div className="shrink-0 w-60 p-4 bg-base-800 border border-base-700 rounded-lg">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-[10px] font-bold text-base-400 uppercase tracking-wider">Equalizer</span>
                                            {(eqLow !== 0 || eqMid !== 0 || eqHigh !== 0 || eqKills.low || eqKills.mid || eqKills.high) && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEqLowWithSync(0); setEqMidWithSync(0); setEqHighWithSync(0); setEqKillsWithSync({ low: false, mid: false, high: false }); }}
                                                    className="flex items-center gap-1 text-[9px] text-base-400 hover:text-base-50 transition-colors"
                                                    title="Reset EQ"
                                                >
                                                    <RotateCcw size={9} /> Reset
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex justify-around items-start gap-2">
                                            {[
                                                { label: 'Lo',  freq: '200Hz', value: eqLow,  set: setEqLowWithSync,  killKey: 'low'  },
                                                { label: 'Mid', freq: '1kHz',  value: eqMid,  set: setEqMidWithSync,  killKey: 'mid'  },
                                                { label: 'Hi',  freq: '8kHz',  value: eqHigh, set: setEqHighWithSync, killKey: 'high' },
                                            ].map(({ label, freq, value, set, killKey }) => {
                                                const killed = eqKills[killKey];
                                                return (
                                                    <div key={label} className={`flex flex-col items-center gap-1.5 flex-1 rounded-md px-1.5 py-2 transition-colors ${killed ? 'bg-base-500/50 ring-1 ring-base-400' : 'bg-base-900'}`}>
                                                        <span className={`text-[11px] font-mono font-semibold tabular-nums ${killed ? 'text-base-50' : value > 0 ? 'text-base-100' : value < 0 ? 'text-base-300' : 'text-base-600'}`}>
                                                            {killed ? 'KILL' : `${value > 0 ? '+' : ''}${value}dB`}
                                                        </span>
                                                        <Slider
                                                            aria-label={`EQ ${label}`}
                                                            orientation="vertical"
                                                            minValue={-12}
                                                            maxValue={12}
                                                            step={0.5}
                                                            value={value}
                                                            onChange={set}
                                                            size="sm"
                                                            className={`h-28 transition-opacity ${killed ? 'opacity-20' : ''}`}
                                                            classNames={{
                                                                track: 'bg-base-700',
                                                                filler: 'bg-base-500',
                                                                thumb: 'bg-base-200 border-base-500 w-3.5 h-3.5',
                                                            }}
                                                        />
                                                        <div className="flex items-center gap-1 mt-0.5">
                                                            <span className={`text-xs font-medium ${killed ? 'text-base-100' : 'text-base-300'}`}>{label}</span>
                                                            {value !== 0 && !killed && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); set(0); }}
                                                                    className="text-base-500 hover:text-base-50 transition-colors"
                                                                    title={`Reset ${label} to 0dB`}
                                                                >
                                                                    <RotateCcw size={10} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <span className={`text-[9px] tabular-nums ${killed ? 'text-base-300' : 'text-base-600'}`}>{freq}</span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setEqKillsWithSync({ ...eqKills, [killKey]: !eqKills[killKey] }); }}
                                                            className={`w-full mt-1 px-2 rounded flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors border ${killed ? 'bg-base-400 text-base-50 border-base-300' : 'bg-base-800 text-base-300 border-base-600 hover:text-base-50 hover:border-base-400'}`}
                                                            title={`${killed ? 'Restore' : 'Kill'} ${label} band`}
                                                        >
                                                            <Power size={9} />
                                                            {killed ? 'On' : 'Kill'}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Audio Effects */}
                                    <div className="flex-1 flex flex-col p-4 bg-base-800 border border-base-700 rounded-lg overflow-hidden min-w-0">
                                        <div className="flex items-center justify-between mb-3 shrink-0">
                                            <span className="text-[10px] font-bold text-base-400 uppercase tracking-wider">Audio Effects</span>
                                            <div className="relative">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setShowAddEffectMenu(s => !s); }}
                                                    className="flex items-center gap-1 text-[10px] text-base-400 hover:text-base-200 transition-colors"
                                                    title="Add effect"
                                                >
                                                    <Plus size={11} strokeWidth={2.5} />
                                                    <span className="font-medium">Add Effect</span>
                                                </button>
                                                {showAddEffectMenu && (
                                                    <div className="absolute right-0 top-full mt-2 bg-base-900 border border-base-700 rounded-lg shadow-2xl z-20 overflow-hidden" style={{ minWidth: '150px' }}>
                                                        {Object.entries(EFFECT_CONFIGS).map(([type, cfg]) => (
                                                            <button
                                                                key={type}
                                                                onClick={(e) => { e.stopPropagation(); handleAddEffect(type); }}
                                                                className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 text-base-300 hover:text-base-50 hover:bg-base-800 transition-colors group"
                                                            >
                                                                <span className="w-1 h-1 rounded-full bg-base-600 group-hover:bg-base-400 transition-colors shrink-0" />
                                                                <span className="text-xs font-medium">{cfg.label}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto bg-base-900 border border-base-700 rounded-lg p-2 flex flex-col gap-1.5">
                                            {effects.length === 0 ? (
                                                <p className="text-[11px] text-base-500 text-center py-4">No effects added.</p>
                                            ) : (
                                                effects.map(effect => {
                                                    const cfg = EFFECT_CONFIGS[effect.type];
                                                    return (
                                                        <div key={effect.id} className="shrink-0 border-l-2 border-base-500 bg-base-800/60 rounded-r-md pl-3 pr-2 pt-2 pb-2.5">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-[10px] font-bold text-base-300 uppercase tracking-wide">{cfg.label}</span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleRemoveEffect(effect.id); }}
                                                                    className="text-base-500"
                                                                    title="Remove effect"
                                                                >
                                                                    <X size={12} strokeWidth={2.5} />
                                                                </button>
                                                            </div>
                                                            <div className="flex flex-col gap-2">
                                                                {cfg.paramDefs.map(def => (
                                                                    <div key={def.key} className="flex items-center gap-2">
                                                                        <span className="text-[10px] text-base-400 w-16 shrink-0">{def.label}</span>
                                                                        {def.type === 'select' ? (
                                                                            <div className="flex gap-1 flex-1">
                                                                                {def.options.map(opt => (
                                                                                    <button
                                                                                        key={opt.value}
                                                                                        disabled={!effect.enabled}
                                                                                        onClick={(e) => { e.stopPropagation(); handleEffectParam(effect.id, def.key, opt.value); }}
                                                                                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${effect.params[def.key] === opt.value ? 'bg-base-500 text-base-50 border-base-400' : 'bg-base-800 text-base-400 border-base-600 hover:text-base-200 hover:border-base-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
                                                                                    >
                                                                                        {opt.label}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <Slider
                                                                                    aria-label={`${cfg.label} ${def.label}`}
                                                                                    minValue={def.min} maxValue={def.max} step={def.step}
                                                                                    value={effect.params[def.key]}
                                                                                    onChange={(v) => handleEffectParam(effect.id, def.key, v)}
                                                                                    size="sm"
                                                                                    className="flex-1"
                                                                                    isDisabled={!effect.enabled}
                                                                                    classNames={{ track: 'bg-base-700', filler: 'bg-base-500', thumb: 'bg-base-200 border-base-500 w-3.5 h-3.5' }}
                                                                                />
                                                                                <span className="text-[10px] font-mono text-base-300 w-12 text-right shrink-0">
                                                                                    {typeof effect.params[def.key] === 'number'
                                                                                        ? (Number.isInteger(effect.params[def.key]) ? effect.params[def.key] : effect.params[def.key].toFixed(2))
                                                                                        : effect.params[def.key]
                                                                                    }{def.unit ?? ''}
                                                                                </span>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>

                                </div>

                    </div>
                )}
            </div>
        </div>
    );
}
