import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Pencil, ChevronDown, ChevronUp, Play, Pause, Volume2, VolumeX, Eye, EyeOff, Move, Copy, Trash2, RotateCcw, AlertTriangle, X, Plus, Power } from 'lucide-react';
import { Slider } from '@heroui/react';
import { getDynamicInputWidth } from '../utils/helpers';
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
    const { tracks, handleUpdateTrack, handleAddTrack, universalIsPlaying, masterStopSignal, globalZoom, masterBpm, masterDuration, masterTimeRef, handleSeekMaster, handleOverwriteTracks } = useMix();
    const {
        play, pause, seek, setVolume: setEngVolume, setPitch: setEngPitch, setSpeed: setEngSpeed,
        setEQ, addEffect, removeEffect, setEffectParam, applyFadeIn, applyFadeOut
    } = useAudioEngine(trackId);

    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [trackName, setTrackName] = useState(title);
    const [isEditing, setIsEditing] = useState(false);
    const [missingDismissed, setMissingDismissed] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isSegmentMuted, setIsSegmentMuted] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [volume, setVolume] = useState(initialVolume);
    const [pitch, setPitch] = useState(initialPitch);
    const [speed, setSpeed] = useState(initialSpeed);
    const [speedInputVal, setSpeedInputVal] = useState(null); // null = display mode, string = editing
    const [fadeIn, setFadeIn] = useState(() => parseFade(initialFadeIn));
    const [fadeOut, setFadeOut] = useState(() => parseFade(initialFadeOut));
    const [audioDuration, setAudioDuration] = useState(0);
    const [displayTimeSec, setDisplayTimeSec] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    // Derived synchronously — no state lag when zoom changes.
    // zoom > 0: WaveSurfer pxPerSec = zoom * 2, so total canvas width = zoom * 2 * duration.
    // zoom = 0: WaveSurfer auto-fits to container; containerWidth is measured via rAF.
    const waveformPixelWidth = globalZoom > 0 && audioDuration ? globalZoom * 2 * audioDuration : containerWidth;
    const [effects, setEffects] = useState([]);
    const [showAddEffectMenu, setShowAddEffectMenu] = useState(false);
    const [isDraggable, setIsDraggable] = useState(false);
    const [draggedSegmentState, setDraggedSegmentState] = useState(null);
    const [dragPreviewOrder, setDragPreviewOrder] = useState(null); // null = no drag in progress, else array of seg ids
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

    // Keep refs current for use inside rAF loop and WaveSurfer callbacks that close over stale state.
    useEffect(() => { segmentsRef.current = segments; }, [segments]);
    useEffect(() => { activeSegmentIdRef.current = activeSegmentId; }, [activeSegmentId]);
    useEffect(() => { effectsRef.current = effects; }, [effects]);

    // Sync title prop into local state when a slot gets filled externally (e.g. library drop).
    // On first mount title === trackName so React bails out with no re-render.
    useEffect(() => {
        setTrackName(title);
    }, [title]);

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
                });

                // 'interaction' fires only on user-initiated seek (click or drag),
                // never on programmatic ws.seekTo() calls from the playhead sync loop.
                ws.on('ready', () => {
                    waveformReadyRef.current = true;
                    durationRef.current = ws.getDuration();
                    setAudioDuration(ws.getDuration());
                    if (globalZoom > 0) ws.zoom(globalZoom * 2);
                });

                ws.on('interaction', (newTime) => {
                    const absTime = newTime + offsetSec;
                    handleSeekMaster(absTime);

                    if (durationRef.current > 0) {
                        currentTimePctRef.current = newTime / durationRef.current;
                        // Detect which segment the user clicked and activate it
                        const pct = newTime / durationRef.current;
                        const clickedSeg = segmentsRef.current?.find(s => pct >= s.startPct && pct < s.endPct);
                        if (clickedSeg && clickedSeg.id !== activeSegmentIdRef.current) {
                            activateSegmentRef.current?.(clickedSeg.id);
                        }
                    }
                    setDisplayTimeSec(newTime);
                    seek(newTime);
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

    // Handle Engine Volume
    useEffect(() => {
        setEngVolume(isMuted || !isVisible || isSegmentMuted ? 0 : volume / 100);
    }, [volume, isMuted, isVisible, isSegmentMuted, setEngVolume]);

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

    // Waveform Zoom — ref guard ensures audio is loaded before calling zoom().
    // Initial zoom is applied inside the 'ready' handler; this effect handles
    // subsequent slider changes only.
    // After zoom(), we compute the scroll position that centers the playhead in the
    // visible container, then apply it to both the WaveSurfer scroll element and the
    // overlay container so all overlays remain pinned to their correct time positions.
    useEffect(() => {
        if (!waveformReadyRef.current || !wavesurferRef.current) return;
        wavesurferRef.current.zoom(globalZoom * 2);
        requestAnimationFrame(() => {
            if (!scrollContainerRef.current) return;
            if (globalZoom > 0 && waveformRef.current) {
                // Center the view on the current playhead position.
                // totalWidth = pxPerSec * duration (same formula as waveformPixelWidth).
                const totalWidth  = globalZoom * 2 * durationRef.current;
                const containerW  = scrollContainerRef.current.clientWidth;
                const playheadPx  = currentTimePctRef.current * totalWidth;
                const scrollTo    = Math.max(0, Math.min(playheadPx - containerW / 2, totalWidth - containerW));
                scrollContainerRef.current.scrollLeft = scrollTo;
            } else {
                // zoom = 0: full track fits in container, no scroll needed.
                scrollContainerRef.current.scrollLeft = 0;
            }
        });
    }, [globalZoom]);

    // Measure container width dynamically using ResizeObserver.
    // This handles zoom = 0 (auto-fit mode) and any flex shrinking if masterDuration extends.
    useEffect(() => {
        if (!waveformRef.current || globalZoom > 0) return;
        
        const node = waveformRef.current;
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        
        observer.observe(node);
        return () => observer.disconnect();
    }, [globalZoom]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Update displayed BPM proportionally to speed
        if (bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm))) {
            const newBpm = Math.round(parseFloat(bpm) * v);
            handleUpdateTrack(trackId, { bpm: String(newBpm) }, true);
        }
    }, [syncActiveSegmentSettings, bpm, trackId, handleUpdateTrack]);
    const setEqLowWithSync     = useCallback((v) => { setEqLow(v);   syncActiveSegmentSettings({ eqLow: v }); },   [syncActiveSegmentSettings]);
    const setEqMidWithSync     = useCallback((v) => { setEqMid(v);   syncActiveSegmentSettings({ eqMid: v }); },   [syncActiveSegmentSettings]);
    const setEqHighWithSync    = useCallback((v) => { setEqHigh(v);  syncActiveSegmentSettings({ eqHigh: v }); },  [syncActiveSegmentSettings]);
    const setEqKillsWithSync   = useCallback((v) => { setEqKills(v); syncActiveSegmentSettings({ eqKills: v }); }, [syncActiveSegmentSettings]);

    const handleToggleDelete = useCallback((e) => {
        e.stopPropagation();
        const seg = segmentsRef.current?.find(s => s.id === activeSegmentIdRef.current);
        if (!seg) return;
        const next = !seg.isDeleted;
        syncActiveSegmentSettings({ isDeleted: next });
        setIsSegmentMuted(next || seg.isMuted);
    }, [syncActiveSegmentSettings]);

    const handleToggleMute = useCallback((e) => {
        e.stopPropagation();
        const seg = segmentsRef.current?.find(s => s.id === activeSegmentIdRef.current);
        if (!seg) return;
        const next = !seg.isMuted;
        syncActiveSegmentSettings({ isMuted: next });
        setIsSegmentMuted(seg.isDeleted || next);
    }, [syncActiveSegmentSettings]);

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
        setIsSegmentMuted(seg.isDeleted || false);
    }, [trackId]);

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
        if (bpm !== '[BPM]' && !isNaN(parseFloat(bpm))) {
            const parsedBpm = parseFloat(bpm);
            if (parsedBpm > 0) {
                const targetSpeed = masterBpm / parsedBpm;
                const clampedSpeed = Math.min(4.0, Math.max(0.25, targetSpeed));
                setSpeedWithSync(clampedSpeed);
                // After sync, display the master BPM since the track is now matching it
                handleUpdateTrack(trackId, { bpm: String(masterBpm) });
            }
        }
    }, [bpm, masterBpm, setSpeedWithSync, handleUpdateTrack, trackId]);

    // Split track at playhead position — inserts a cut point into the segments array.
    // Cut snaps to the nearest beat/half-beat when Essentia data is available.
    const handleSplit = useCallback(() => {
        if (!audioUrl || !waveformReadyRef.current || !wavesurferRef.current) return;
        const duration = durationRef.current;
        if (!duration) return;

        let timeSec = wavesurferRef.current.getCurrentTime();

        // Snap to nearest beat or half-beat (speed-adjusted so cuts land on heard beats)
        const beats = adjustedBeatPositionsRef.current;
        if (beats && beats.length > 1) {
            const grid = [];
            for (let i = 0; i < beats.length; i++) {
                grid.push(beats[i]);
                if (i < beats.length - 1) grid.push((beats[i] + beats[i + 1]) / 2);
            }
            let nearest = grid[0];
            let minDist = Math.abs(grid[0] - timeSec);
            for (let i = 1; i < grid.length; i++) {
                const d = Math.abs(grid[i] - timeSec);
                if (d < minDist) { minDist = d; nearest = grid[i]; }
            }
            timeSec = nearest;
        }

        const pct = timeSec / duration;
        if (pct <= 0 || pct >= 1) return;
        setSegments(prev => {
            // >= for startPct so a split right after an existing cut point (where
            // pct === seg.startPct) correctly targets the segment to the right.
            const idx = prev.findIndex(seg => pct >= seg.startPct && pct < seg.endPct);
            if (idx === -1) return prev;
            const seg = prev[idx];
            const next = [...prev];
            next.splice(idx, 1,
                { ...seg, startPct: seg.startPct, endPct: pct, fadeOut: 0 },
                { ...seg, id: Date.now(), startPct: pct, endPct: seg.endPct, fadeIn: 0 }
            );
            handleUpdateTrack(trackId, { initialSegments: next });
            return next;
        });
    }, [audioUrl, handleUpdateTrack, trackId]);

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

    // Reorder segments by dragging their handle bar. Segments snap together with no gaps.
    const handleSegmentDragStart = useCallback((e, seg) => {
        e.stopPropagation();
        e.preventDefault();

        const liveSegs = segmentsRef.current; // snapshot at drag start (sorted by startPct)
        if (liveSegs.length < 2) return; // nothing to reorder with a single segment

        const startX = e.clientX;
        const laneWidth = laneRef.current?.clientWidth || 800;
        const draggedIdx = liveSegs.findIndex(s => s.id === seg.id);
        if (draggedIdx === -1) return;

        // Build initial preview order from current segment order
        let currentPreviewIds = liveSegs.map(s => s.id);
        setDraggedSegmentState({ id: seg.id, dx: 0 });
        setDragPreviewOrder(currentPreviewIds);

        const handleMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            setDraggedSegmentState({ id: seg.id, dx });

            // Determine where the dragged segment's center would land as a pct of the lane
            const draggedSize = seg.endPct - seg.startPct;
            const newCenterPct = seg.startPct + draggedSize / 2 + dx / laneWidth;

            // Compute cumulative midpoints of all other segments (in current order without dragged)
            const others = liveSegs.filter(s => s.id !== seg.id);
            let cursor = 0;
            const positions = []; // {id, midPct}
            for (const s of others) {
                const size = s.endPct - s.startPct;
                positions.push({ id: s.id, midPct: cursor + size / 2 });
                cursor += size;
            }

            // Find insert position: insert before the first other whose mid is > dragged center
            let insertBefore = positions.findIndex(p => newCenterPct < p.midPct);
            if (insertBefore === -1) insertBefore = positions.length; // place at end

            const newOrder = [...others.map(s => s.id)];
            newOrder.splice(insertBefore, 0, seg.id);

            if (newOrder.join(',') !== currentPreviewIds.join(',')) {
                currentPreviewIds = newOrder;
                setDragPreviewOrder(newOrder);
            }
        };

        const handleMouseUp = async () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            setDraggedSegmentState(null);
            setDragPreviewOrder(null);

            // No-op if order is unchanged
            if (currentPreviewIds.join(',') === liveSegs.map(s => s.id).join(',')) return;

            setIsAnalysing(true);

            const trackObj = AudioEngineService.tracks.get(trackId);
            if (!trackObj?.audioBuffer) { setIsAnalysing(false); return; }

            const oldBuf = trackObj.audioBuffer;
            const sr = oldBuf.sampleRate;
            const channels = oldBuf.numberOfChannels;
            const totalFrames = oldBuf.length;
            const segById = Object.fromEntries(liveSegs.map(s => [s.id, s]));

            // Build new buffer by copying slices in the new order
            const newBuf = AudioEngineService.ctx.createBuffer(channels, totalFrames, sr);
            for (let ch = 0; ch < channels; ch++) {
                const oldData = oldBuf.getChannelData(ch);
                const newData = newBuf.getChannelData(ch);
                let writePos = 0;
                for (const id of currentPreviewIds) {
                    const s = segById[id];
                    const sf = Math.floor(s.startPct * totalFrames);
                    const ef = Math.floor(s.endPct * totalFrames);
                    const len = ef - sf;
                    if (len > 0) { newData.set(oldData.subarray(sf, ef), writePos); writePos += len; }
                }
            }

            // Recalculate contiguous startPct/endPct from actual frame counts
            let pos = 0;
            const reordered = currentPreviewIds.map(id => {
                const s = segById[id];
                const sf = Math.floor(s.startPct * totalFrames);
                const ef = Math.floor(s.endPct * totalFrames);
                const size = (ef - sf) / totalFrames;
                const updated = { ...s, startPct: pos, endPct: pos + size };
                pos += size;
                return updated;
            });

            // Patch AudioEngine immediately so playback reflects new order
            trackObj.audioBuffer = newBuf;
            trackObj.duration = newBuf.duration;

            // Render waveform immediately from pre-computed peaks — no WAV encode needed.
            // WaveSurfer.load(url, peaks, duration) draws peaks without decoding when peaks are provided.
            const peaks = computeWaveformPeaks(newBuf);
            if (wavesurferRef.current && waveBlobUrlRef.current) {
                wavesurferRef.current.load(waveBlobUrlRef.current, peaks, newBuf.duration);
            }

            // Update UI state — segments snap to new positions immediately
            setSegments(reordered);
            setAudioDuration(newBuf.duration);
            setIsAnalysing(false);

            // Defer WAV encode purely for persistence (no waveform reload needed)
            setTimeout(() => {
                const wavObj = audioBufferToWAV(newBuf);
                const newBlob = new Blob([wavObj], { type: 'audio/wav' });
                if (waveBlobUrlRef.current) URL.revokeObjectURL(waveBlobUrlRef.current);
                waveBlobUrlRef.current = URL.createObjectURL(newBlob);
                handleUpdateTrack(trackId, {
                    initialSegments: reordered,
                    audioBlob: newBlob,
                    beatPositions: [],
                });
            }, 0);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [trackId, handleUpdateTrack]);

    // Disambiguates click vs drag on a segment overlay.
    // A movement of >5px in any direction starts a drag; release without moving seeks + activates.
    const handleSegmentOverlayMouseDown = useCallback((e, seg) => {
        if (seg.isDeleted) return;
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;

        const onMove = (mv) => {
            if (!dragging && (Math.abs(mv.clientX - startX) > 5 || Math.abs(mv.clientY - startY) > 5)) {
                dragging = true;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                handleSegmentDragStart({ clientX: startX, stopPropagation: () => {}, preventDefault: () => {} }, seg);
            }
        };

        const onUp = (upEvent) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!dragging) {
                // Use the waveform viewport (scrollContainerRef) as the reference — not the
                // full lane — so the position is correct regardless of clip width or zoom level.
                const containerEl = scrollContainerRef.current;
                const containerRect = containerEl?.getBoundingClientRect();
                if (!containerRect) return;
                // scrollWidth is the full waveform canvas width (zoomed or not)
                const totalWidth = containerEl.scrollWidth || containerRect.width || 1;
                const clickX = upEvent.clientX - containerRect.left + (containerEl.scrollLeft || 0);
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
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [audioDuration, offsetSec, seek, handleSeekMaster, handleSegmentDragStart]);

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
            initialZoom: globalZoom,
            initiallyExpanded: isExpanded,
            initialSegments: segmentsRef.current,
        }, true); // TRUE: Skip generic tracker history stack pollution for visual layout syncs!
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trackName, volume, globalZoom, isExpanded, segments, handleUpdateTrack, trackId]);

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
                const audioPosSec = track.stFilter
                    ? track.stFilter.sourcePosition / track.audioBuffer.sampleRate
                    : (AudioEngineService.ctx.currentTime - track.startTime);

                // Smooth continuous playhead — no beat-floor snapping so the cursor moves
                // fluidly every frame. Beat-grid quantization is applied only on Ctrl+S splits.
                const displayProportion = Math.min(1, audioPosSec / track.audioBuffer.duration);
                currentTimePctRef.current = displayProportion;
                wavesurferRef.current.seekTo(displayProportion);

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

                    if (playingSeg.fadeIn > 0) {
                        applyFadeIn(playingSeg.fadeIn);
                    } else {
                        // Restore gain in case the previous segment faded out
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
                        setIsSegmentMuted(playingSeg.isDeleted || playingSeg.isMuted || false);
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

                // Programmatic Snap-to-Center Auto-scroll if playing off-screen
                if (scrollContainerRef.current) {
                    const scrollEl = scrollContainerRef.current;
                    // Playhead position in absolute pixels on our custom width wrapper
                    const pPx = (audioPosSec / track.audioBuffer.duration) * waveformPixelWidth;
                    // Provide a nice 100px right-side margin before snapping
                    if (pPx > scrollEl.scrollLeft + scrollEl.clientWidth - 100) {
                        scrollEl.scrollLeft = Math.max(0, pPx - (scrollEl.clientWidth / 2));
                    }
                }
            }
            frameId = requestAnimationFrame(updatePlayhead);
        };
        if (isPlaying) updatePlayhead();
        return () => cancelAnimationFrame(frameId);
    }, [isPlaying, trackId, applyFadeIn, applyFadeOut, waveformPixelWidth]);

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
                            className={`text-base-50 font-semibold px-1 py-1 rounded outline-none transition-colors cursor-text text-lg text-ellipsis overflow-hidden ${isEditing ? (isDuplicateName ? 'bg-red-900/30 ring-1 ring-red-500/60' : 'bg-base-900') : 'bg-transparent'}`}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !isDuplicateName) { setTrackName(t => t.trim()); setIsEditing(false); } }}
                        />
                        <button
                            onClick={() => { if (!isDuplicateName) { setTrackName(t => t.trim()); setIsEditing(e => !e); } }}
                            className={`transition-colors p-1 rounded border ${isEditing ? (isDuplicateName ? 'bg-red-900/30 text-red-400 border-red-500/60 cursor-not-allowed' : 'bg-base-900 text-base-50 border-base-500') : 'bg-transparent border-transparent text-base-300 hover:text-base-50 hover:border-base-400'}`}
                            title={isDuplicateName ? 'Track name already in use' : 'Rename track'}
                        >
                            <Pencil size={16} />
                        </button>
                        {isEditing && isDuplicateName && (
                            <span className="text-xs font-medium text-red-400 whitespace-nowrap truncate shrink-0">Name already in use</span>
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
                    <div className="flex items-start gap-2 mt-3 px-3 py-2 rounded border border-red-500/30 bg-red-500/10" onClick={(e) => e.stopPropagation()}>
                        <AlertTriangle size={13} className="text-red-400 shrink-0 mt-px" />
                        <span className="text-[11px] text-red-300 leading-snug flex-1">File missing from imports. Re-upload the exact file to restore.</span>
                        <button
                            onClick={() => setMissingDismissed(true)}
                            className="text-red-500 hover:text-red-200 transition-colors shrink-0"
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
                                onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
                                disabled={!isVisible || !audioUrl || isMissing}
                                title={isMissing ? 'File missing from imports' : !audioUrl ? 'No preview available' : undefined}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible || !audioUrl || isMissing ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed' : isPlaying ? 'bg-base-500 text-base-50 border-base-400' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                            >
                                {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                                disabled={!isVisible}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border font-bold text-xs gap-1 ${
                                    !isVisible
                                        ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed'
                                        : isMuted
                                            ? 'bg-yellow-500 text-black border-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.5)]'
                                            : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'
                                }`}
                            >
                                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
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

                    {/* Right column (Timeline Lane) */}
                    <div ref={laneRef} className="flex flex-col flex-1 min-w-0 bg-[#0F111A] border-l border-base-700/50 shadow-inner relative overflow-hidden">
                        {/* The Actual Track Clip */}
                        <div 
                            className="absolute top-0 bottom-0 flex flex-col bg-base-900 border border-base-700 shadow-xl rounded overflow-hidden"
                            style={{
                                width: masterDuration > 0 && audioDuration > 0 ? `${(audioDuration / masterDuration) * 100}%` : '100%',
                                left: masterDuration > 0 ? `${(offsetSec / masterDuration) * 100}%` : '0%',
                                transition: isDragged ? 'none' : 'left 0.1s ease-out'
                            }}
                        >
                            {/* Consolidated Scroll Viewport for Syncing WaveSurfer and Bars Natively */}
                            <div 
                                ref={scrollContainerRef}
                                className="relative flex-1 min-w-full overflow-x-auto overflow-y-hidden scrollbar-hide bg-base-900"
                            >
                                {/* Inner Track Scale Canvas — stretches to waveformPixelWidth so native scrolling captures everything */}
                                <div style={{ width: waveformPixelWidth > 0 ? waveformPixelWidth : '100%', minWidth: '100%', height: '100%', position: 'relative' }}>
                                    
                                    {/* WaveSurfer rendering target */}
                                    <div ref={waveformRef} className="absolute inset-0"></div>
                                    
                                    {/* Locked Visual Overlay Target */}
                                    <div className="absolute inset-0 pointer-events-none z-[15]">
                                        
                                        {/* Fade overlays */}
                                        {audioDuration > 0 && segments.flatMap(seg => {
                                            const overlays = [];
                                            if (seg.fadeIn > 0) {
                                                const fw = Math.min(seg.fadeIn / audioDuration, seg.endPct - seg.startPct);
                                                const style = globalZoom === 0
                                                    ? { left: `${seg.startPct * 100}%`, width: `${fw * 100}%`, height: '100%' }
                                                    : { left: seg.startPct * waveformPixelWidth, width: fw * waveformPixelWidth, height: '100%' };
                                                overlays.push(
                                                    <svg key={`fi-${seg.id}`} className="absolute inset-y-0 pointer-events-none z-[2]" style={style} preserveAspectRatio="none" viewBox="0 0 100 100">
                                                        <polygon points="0,0 100,0 0,100" fill="rgba(8,10,14,0.5)" />
                                                    </svg>
                                                );
                                            }
                                            if (seg.fadeOut > 0) {
                                                const fw = Math.min(seg.fadeOut / audioDuration, seg.endPct - seg.startPct);
                                                const style = globalZoom === 0
                                                    ? { left: `${(seg.endPct - fw) * 100}%`, width: `${fw * 100}%`, height: '100%' }
                                                    : { left: (seg.endPct - fw) * waveformPixelWidth, width: fw * waveformPixelWidth, height: '100%' };
                                                overlays.push(
                                                    <svg key={`fo-${seg.id}`} className="absolute inset-y-0 pointer-events-none z-[2]" style={style} preserveAspectRatio="none" viewBox="0 0 100 100">
                                                        <polygon points="0,0 100,0 100,100" fill="rgba(8,10,14,0.5)" />
                                                    </svg>
                                                );
                                            }
                                            return overlays;
                                        })}

                                        {/* Beat markers */}
                                        {globalZoom >= 25 && audioDuration > 0 && adjustedBeatPositions.length > 0 && waveformPixelWidth > 0 && (
                                            <div className="absolute inset-y-0 left-0 pointer-events-none z-[15]" style={{ width: waveformPixelWidth }}>
                                                {adjustedBeatPositions.map((t, i) => (
                                                    <div
                                                        key={`beat-${i}`}
                                                        className="absolute top-0 bottom-0 w-px bg-[#59546C]"
                                                        style={{ left: `${(t / audioDuration) * 100}%` }}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {/* Segment region highlights */}
                                        {audioUrl && segments.map(seg => {
                                            const isDragging = draggedSegmentState?.id === seg.id;
                                            const isActive = seg.id === activeSegmentId;
                                            const lanePixels = waveformPixelWidth || laneRef.current?.clientWidth || 800;

                                            // Compute preview translateX for non-dragged segments during a reorder drag
                                            let previewTranslate = 'none';
                                            if (dragPreviewOrder && draggedSegmentState) {
                                                if (isDragging) {
                                                    previewTranslate = `translateX(${draggedSegmentState.dx}px)`;
                                                } else {
                                                    const previewIdx = dragPreviewOrder.indexOf(seg.id);
                                                    if (previewIdx !== -1) {
                                                        let previewStart = 0;
                                                        for (let i = 0; i < previewIdx; i++) {
                                                            const ps = segments.find(s => s.id === dragPreviewOrder[i]);
                                                            if (ps) previewStart += (ps.endPct - ps.startPct);
                                                        }
                                                        const offsetPx = (previewStart - seg.startPct) * lanePixels;
                                                        previewTranslate = `translateX(${offsetPx}px)`;
                                                    }
                                                }
                                            }

                                            const left = globalZoom > 0 && waveformPixelWidth > 0
                                                ? seg.startPct * waveformPixelWidth
                                                : `${seg.startPct * 100}%`;
                                            const width = globalZoom > 0 && waveformPixelWidth > 0
                                                ? (seg.endPct - seg.startPct) * waveformPixelWidth
                                                : `${(seg.endPct - seg.startPct) * 100}%`;

                                            // Spring easing: slight overshoot makes the slide feel physical
                                            const springEase = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

                                            return (
                                            <div
                                                key={`hl-${seg.id}`}
                                                className={`absolute top-0 bottom-0 pointer-events-auto rounded-sm ${!seg.isDeleted ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''} ${isDragging ? 'z-50' : 'z-[3]'} ${
                                                    isDragging
                                                        ? 'border-2 border-orange-400'
                                                        : isActive && !seg.isDeleted && !seg.isMuted
                                                            ? 'border-2 border-orange-400/80'
                                                            : !seg.isDeleted && !seg.isMuted
                                                                ? 'border-2 border-white/50'
                                                                : ''
                                                } ${seg.isDeleted ? 'bg-base-900/95 border-y-2 border-dashed border-base-600 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]' : seg.isMuted ? 'bg-black/60 grayscale backdrop-brightness-50' : ''}`}
                                                style={{
                                                    left,
                                                    width,
                                                    transform: isDragging
                                                        ? `translateX(${draggedSegmentState.dx}px) translateY(-6px) scaleY(1.06)`
                                                        : dragPreviewOrder
                                                            ? `${previewTranslate} scaleY(0.94)`
                                                            : previewTranslate,
                                                    transition: isDragging
                                                        ? 'none'
                                                        : dragPreviewOrder
                                                            ? `transform 0.22s ${springEase}`
                                                            : `transform 0.22s ${springEase}`,
                                                    opacity: isDragging ? 0.92 : (dragPreviewOrder ? 0.45 : 1),
                                                    boxShadow: isDragging
                                                        ? '0 0 0 1px rgba(251,146,60,0.6), 0 0 18px 3px rgba(251,146,60,0.25), 0 14px 32px rgba(0,0,0,0.65)'
                                                        : undefined,
                                                    transformOrigin: 'center center',
                                                    willChange: dragPreviewOrder ? 'transform, opacity' : undefined,
                                                }}
                                                onMouseDown={(e) => handleSegmentOverlayMouseDown(e, seg)}
                                            />
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Timeline Lane base layer */}
                        <div className="absolute inset-0 flex items-end px-2 pb-1 pointer-events-none z-[1]">
                            <span className="text-[10px] font-mono text-base-600/50 mix-blend-plus-lighter tabular-nums shrink-0 select-none bg-base-900/50 backdrop-blur-sm px-1.5 rounded">
                                {formatTimestamp(displayTimeSec)} / {formatTimestamp((audioDuration || 0) + (offsetSec || 0))}
                            </span>
                        </div>
                    </div>
                </div>}

                {/* Collapsible Settings */}
                {isExpanded && (
                    <div className="flex flex-col w-full mt-3" onClick={(e) => e.stopPropagation()}>
                        <button
                            disabled={!isVisible}
                            className={`flex items-center gap-2 text-sm font-bold transition-colors self-start outline-none p-1 rounded ${!isVisible ? 'text-base-700 cursor-not-allowed' : 'text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95'} ${isSettingsExpanded ? 'mb-2' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsSettingsExpanded(!isSettingsExpanded);
                            }}
                        >
                            Settings
                            {isSettingsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>

                        {isSettingsExpanded && (
                            <div className={`w-full bg-base-900 rounded-lg p-5 border border-base-700 flex flex-col gap-6 transition-opacity ${!isVisible ? 'opacity-50 pointer-events-none' : ''}`}>

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
                                            <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                                                Speed
                                                {parseFloat(speed) !== 1.0 && (
                                                    <button onClick={(e) => { e.stopPropagation(); setSpeedWithSync(1.0); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to 1.0x">
                                                        <RotateCcw size={12} />
                                                    </button>
                                                )}
                                            </span>
                                        <div className="flex items-center gap-3">
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
                                                        className="text-xs font-mono text-base-100 w-12 text-right bg-base-700 rounded px-1 outline-none border border-base-500"
                                                    />
                                                ) : (
                                                    <span
                                                        className="text-xs font-mono text-base-300 w-10 text-right cursor-text hover:text-base-100 transition-colors"
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
                                        </div>
                                        {/* BPM override input — type a target BPM and the speed adjusts */}
                                        {bpm && bpm !== '[BPM]' && !isNaN(parseFloat(bpm)) && (
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-xs text-base-500">Target BPM</span>
                                                <input
                                                    type="number"
                                                    min="20"
                                                    max="300"
                                                    step="1"
                                                    defaultValue={Math.round(parseFloat(bpm))}
                                                    key={bpm}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }}
                                                    onBlur={(e) => {
                                                        e.stopPropagation();
                                                        const targetBpm = parseFloat(e.target.value);
                                                        const originalBpm = parseFloat(bpm);
                                                        if (!isNaN(targetBpm) && originalBpm > 0) {
                                                            const newSpeed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, targetBpm / originalBpm));
                                                            setSpeedWithSync(newSpeed);
                                                        }
                                                    }}
                                                    className="text-xs font-mono text-base-100 w-16 text-right bg-base-700 rounded px-1.5 py-0.5 outline-none border border-base-600 focus:border-base-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    title="Type a target BPM to set speed automatically"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Gate G6 — warn when pitch or speed exceed quality thresholds.
                                     Once dismissed on this card it never reappears, regardless of
                                     value changes. Each card tracks dismissal independently. */}
                                {!g6Dismissed && (Math.abs(pitch) > 3 || parseFloat(speed) < 0.85 || parseFloat(speed) > 1.15) && (
                                    <div className="flex items-center gap-2 bg-base-800 border border-base-400/60 rounded-lg px-3 py-2 mt-4" onClick={(e) => e.stopPropagation()}>
                                        <AlertTriangle size={11} className="text-amber-400/80 shrink-0" />
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
                                    <div className="flex items-center gap-2 bg-orange-900/20 border border-orange-500/30 rounded-lg px-3 py-2 mt-4" onClick={(e) => e.stopPropagation()}>
                                        <AlertTriangle className="text-orange-400 mt-0.5 shrink-0" size={16} />
                                        <div className="flex-1">
                                            <p className="text-xs text-orange-300 font-medium leading-relaxed">Audio Processing Drop</p>
                                            <p className="text-[10px] text-orange-400/80 mt-1">High CPU load caused an audio buffer underrun. The audio may stutter or drop briefly.</p>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); setAudioDropped(false); }} className="text-orange-500 hover:text-orange-300 p-1" title="Dismiss">
                                            <X size={14} />
                                        </button>
                                    </div>
                                )}

                                {/* EQ + Effects — always visible, side by side */}
                                <div className={`flex gap-4 pt-4 border-t border-base-800 items-stretch ${effects.length > 0 ? 'h-[19rem]' : ''}`} onClick={(e) => e.stopPropagation()}>

                                    {/* Equalizer */}
                                    <div className="shrink-0 w-60 p-4 bg-base-800 border border-base-700 rounded-lg">
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-[10px] font-bold text-base-400 uppercase tracking-wider">Equalizer</span>
                                            {(eqLow !== 0 || eqMid !== 0 || eqHigh !== 0 || eqKills.low || eqKills.mid || eqKills.high) && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEqLowWithSync(0); setEqMidWithSync(0); setEqHighWithSync(0); setEqKillsWithSync({ low: false, mid: false, high: false }); }}
                                                    className="text-base-500 hover:text-base-50 transition-colors"
                                                    title="Reset EQ"
                                                >
                                                    <RotateCcw size={12} />
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
                                                        <span className={`text-xs font-medium ${killed ? 'text-base-100' : 'text-base-300'}`}>{label}</span>
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
                )}
            </div>
        </div>
    );
}
