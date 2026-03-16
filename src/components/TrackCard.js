import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, ChevronDown, ChevronUp, Play, Pause, Volume2, VolumeX, Eye, EyeOff, Move, Copy, Trash2, RotateCcw, ZoomIn, AlertTriangle, X, Plus, Power } from 'lucide-react';
import { Slider } from '@heroui/react';
import { getDynamicInputWidth } from '../utils/helpers';
import { useAudioEngine } from '../audio/useAudioEngine';
import AudioEngineService from '../audio/AudioEngine';
import WaveSurfer from 'wavesurfer.js';
import { analyzeAudioBuffer } from '../audio/essentiaAnalyzer';
import { useMix } from '../spotify/appContext';

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const parseFade = (v) => { const n = parseFloat(String(v)); return isNaN(n) || n < 0 ? 0 : n; };

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

// Find the closest preset index for a given speed value
function speedToIndex(val) {
    const v = parseFloat(val);
    return SPEED_PRESETS.reduce((best, s, i) =>
        Math.abs(s - v) < Math.abs(SPEED_PRESETS[best] - v) ? i : best, 3);
}

const EFFECT_CONFIGS = {
    volume: {
        label: 'Segment Volume',
        defaultParams: { gain: 1.0 },
        paramDefs: [
            { key: 'gain', label: 'Gain', min: 0, max: 2, step: 0.01, unit: 'x' },
        ],
    },
    highpass: {
        label: 'High-pass Filter',
        defaultParams: { frequency: 300 },
        paramDefs: [
            { key: 'frequency', label: 'Cutoff', min: 20, max: 5000, step: 1, unit: 'Hz' },
        ],
    },
    lowpass: {
        label: 'Low-pass Filter',
        defaultParams: { frequency: 8000 },
        paramDefs: [
            { key: 'frequency', label: 'Cutoff', min: 200, max: 20000, step: 1, unit: 'Hz' },
        ],
    },
    panner: {
        label: 'Stereo Pan',
        defaultParams: { pan: 0 },
        paramDefs: [
            { key: 'pan', label: 'Pan', min: -1, max: 1, step: 0.01 },
        ],
    },
    reverb: {
        label: 'Reverb',
        defaultParams: { mix: 0.3 },
        paramDefs: [
            { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
        ],
    },
    delay: {
        label: 'Delay',
        defaultParams: { time: 0.25, feedback: 0.3, mix: 0.5 },
        paramDefs: [
            { key: 'time', label: 'Time', min: 0, max: 1, step: 0.01, unit: 's' },
            { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, step: 0.01 },
            { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
        ],
    },
    compressor: {
        label: 'Compressor',
        defaultParams: { threshold: -24, ratio: 4, knee: 10 },
        paramDefs: [
            { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, unit: 'dB' },
            { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
            { key: 'knee', label: 'Knee', min: 0, max: 40, step: 1, unit: 'dB' },
        ],
    },
};

const makeDefaultSegment = (id, startPct = 0, endPct = 1) => ({
    id, startPct, endPct,
    fadeIn: 0, fadeOut: 0, pitch: 0, speed: 1.0,
    eqLow: 0, eqMid: 0, eqHigh: 0, effects: [],
});

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
    initialSegments = null,
    artistName = "[Artist Name]",
    albumArt = null,
    bpm = "[BPM]",
    trackKey = "[key]",
    spotifyId = null,
    audioUrl = null,
    beatPositions = null,
}) {
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [trackName, setTrackName] = useState(title);
    const [isEditing, setIsEditing] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [volume, setVolume] = useState(initialVolume);
    const [pitch, setPitch] = useState(initialPitch);
    const [speed, setSpeed] = useState(initialSpeed);
    const [fadeIn, setFadeIn] = useState(() => parseFade(initialFadeIn));
    const [fadeOut, setFadeOut] = useState(() => parseFade(initialFadeOut));
    const [audioDuration, setAudioDuration] = useState(0);
    const [waveformPixelWidth, setWaveformPixelWidth] = useState(0);
    const [zoom, setZoom] = useState(initialZoom);
    const [effects, setEffects] = useState([]);
    const [showAddEffectMenu, setShowAddEffectMenu] = useState(false);
    const [isDraggable, setIsDraggable] = useState(false);
    const [segments, setSegments] = useState(() => initialSegments ?? [makeDefaultSegment(0)]);
    const [activeSegmentId, setActiveSegmentId] = useState(() => (initialSegments ?? [makeDefaultSegment(0)])[0]?.id ?? 0);
    const [g6Dismissed, setG6Dismissed] = useState(false);
    const [eqLow, setEqLow] = useState(0);
    const [eqMid, setEqMid] = useState(0);
    const [eqHigh, setEqHigh] = useState(0);
    const [eqKills, setEqKills] = useState({ low: false, mid: false, high: false });

    const waveformRef = useRef(null);
    const wavesurferRef = useRef(null);
    const waveformReadyRef = useRef(false);
    const hasMounted = useRef(false);
    const currentTimePctRef = useRef(0);
    const durationRef = useRef(0);
    const fadeOutTriggeredRef = useRef(false);
    const beatPositionsRef = useRef(beatPositions);
    const overlayContainerRef = useRef(null);
    const wsScrollRef = useRef(null);
    const wsScrollCleanupRef = useRef(null);
    const isHoveredRef = useRef(false);
    const activeSegmentIdRef = useRef((initialSegments ?? [makeDefaultSegment(0)])[0]?.id ?? 0);
    const segmentsRef = useRef(null);
    const playingSegmentIdRef = useRef(null);
    const effectsRef = useRef([]);
    const activateSegmentRef = useRef(null);

    const {
        play, pause, seek, setVolume: setEngVolume, setPitch: setEngPitch, setSpeed: setEngSpeed,
        setEQ, addEffect, removeEffect, setEffectEnabled, setEffectParam, applyFadeIn, applyFadeOut
    } = useAudioEngine(trackId);

    const { tracks, handleUpdateTrack, universalIsPlaying, masterStopSignal } = useMix();

    // Derived — always accurate, immune to effect timing issues
    const isDuplicateName = isEditing && tracks.some(t => t.id !== trackId && t.title.trim() === trackName.trim());

    // Keep beatPositionsRef current so the rAF loop always has the latest Essentia data
    // without needing to restart the animation loop when beatPositions arrives async.
    useEffect(() => {
        beatPositionsRef.current = beatPositions;
    }, [beatPositions]);

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
                // Single network fetch
                const res = await fetch(audioUrl);
                const arrayBuffer = await res.arrayBuffer();
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
                analyzeAudioBuffer(audioBuffer).then(results => {
                    if (isCancelled) return;
                    const updates = { beatPositions: Array.from(results.beatPositions || []) };
                    if (bpm === '[BPM]') updates.bpm = results.bpm;
                    if (trackKey === '[key]') updates.trackKey = `${results.key} ${results.scale}`;
                    handleUpdateTrack(trackId, updates);
                }).catch(err => {
                    console.warn("Essentia analysis failed:", err);
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
                    if (zoom > 0) ws.zoom(zoom * 2);

                    // Attach a native scroll listener to WaveSurfer's internal [part="scroll"]
                    // container. This fires for both user-initiated panning AND programmatic
                    // auto-scroll from seekTo(), keeping overlays locked to the waveform canvas.
                    const scrollEl = waveformRef.current?.querySelector('[part="scroll"]');
                    if (scrollEl) {
                        wsScrollRef.current = scrollEl;
                        const onWsScroll = () => {
                            if (overlayContainerRef.current) {
                                overlayContainerRef.current.style.transform =
                                    `translateX(-${scrollEl.scrollLeft}px)`;
                            }
                        };
                        scrollEl.addEventListener('scroll', onWsScroll, { passive: true });
                        wsScrollCleanupRef.current = () =>
                            scrollEl.removeEventListener('scroll', onWsScroll);
                    }
                });

                ws.on('interaction', (newTime) => {
                    if (durationRef.current > 0) {
                        currentTimePctRef.current = newTime / durationRef.current;
                        // Detect which segment the user clicked and activate it
                        const pct = newTime / durationRef.current;
                        const clickedSeg = segmentsRef.current?.find(s => pct >= s.startPct && pct < s.endPct);
                        if (clickedSeg && clickedSeg.id !== activeSegmentIdRef.current) {
                            activateSegmentRef.current?.(clickedSeg.id);
                        }
                    }
                    seek(newTime);
                });

                wavesurferRef.current = ws;
                ws.load(blobUrl);

            } catch (err) {
                if (!isCancelled) console.error("Audio load failed:", err);
            }
        }

        loadAndInit();

        return () => {
            isCancelled = true;
            waveformReadyRef.current = false;
            wsScrollCleanupRef.current?.();
            wsScrollCleanupRef.current = null;
            wsScrollRef.current = null;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            if (ws) ws.destroy();
            wavesurferRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl, trackId, seek]);

    // Handle Engine Volume
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

    // Universal play/pause signal — audioUrl intentionally omitted from deps so loading
    // a new track while master is paused does not auto-start it.
    useEffect(() => {
        if (!audioUrl) return;
        setIsPlaying(universalIsPlaying);
    }, [universalIsPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // subsequent slider changes only. Also resets overlay scroll offset since
    // WaveSurfer may reposition its scroll container when zoom level changes.
    useEffect(() => {
        if (!waveformReadyRef.current || !wavesurferRef.current) return;
        wavesurferRef.current.zoom(zoom * 2);
        if (overlayContainerRef.current) {
            overlayContainerRef.current.style.transform = 'translateX(0)';
        }
    }, [zoom]);

    // Compute the WaveSurfer canvas's true pixel width so fade overlays are pinned
    // to absolute time positions regardless of zoom level.
    //
    // WaveSurfer v7 creates its own scroll container inside waveformRef, so
    // reading waveformRef.scrollWidth only returns the outer div's width (wrong).
    //
    // Instead:
    //  • zoom > 0  → mathematical: pxPerSec = zoom * 2, totalWidth = pxPerSec * duration
    //  • zoom = 0  → auto-fit: WaveSurfer sizes canvas to exactly fill the container,
    //                so clientWidth is the ground truth (read via rAF after render)
    useEffect(() => {
        if (!audioDuration) return;
        if (zoom > 0) {
            setWaveformPixelWidth(zoom * 2 * audioDuration);
        } else {
            const id = requestAnimationFrame(() => {
                if (waveformRef.current) setWaveformPixelWidth(waveformRef.current.clientWidth);
            });
            return () => cancelAnimationFrame(id);
        }
    }, [zoom, audioDuration]);

    // ─── Segment settings sync ───────────────────────────────────────────────────

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
    const setPitchWithSync     = useCallback((v) => { setPitch(v);   syncActiveSegmentSettings({ pitch: v }); },   [syncActiveSegmentSettings]);
    const setSpeedWithSync     = useCallback((v) => { setSpeed(v);   syncActiveSegmentSettings({ speed: v }); },   [syncActiveSegmentSettings]);
    const setEqLowWithSync     = useCallback((v) => { setEqLow(v);   syncActiveSegmentSettings({ eqLow: v }); },   [syncActiveSegmentSettings]);
    const setEqMidWithSync     = useCallback((v) => { setEqMid(v);   syncActiveSegmentSettings({ eqMid: v }); },   [syncActiveSegmentSettings]);
    const setEqHighWithSync    = useCallback((v) => { setEqHigh(v);  syncActiveSegmentSettings({ eqHigh: v }); },  [syncActiveSegmentSettings]);

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

        // Apply audio settings to engine
        AudioEngineService.setPitch(trackId, seg.pitch);
        AudioEngineService.setSpeed(trackId, seg.speed);
        AudioEngineService.setEQ(trackId, { low: seg.eqLow, mid: seg.eqMid, high: seg.eqHigh });

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
        setEqKills({ low: false, mid: false, high: false });
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

    // Split track at playhead position — inserts a cut point into the segments array.
    // Cut snaps to the nearest beat/half-beat when Essentia data is available.
    const handleSplit = useCallback(() => {
        if (!audioUrl || !waveformReadyRef.current || !wavesurferRef.current) return;
        const duration = durationRef.current;
        if (!duration) return;

        let timeSec = wavesurferRef.current.getCurrentTime();

        // Snap to nearest beat or half-beat
        const beats = beatPositionsRef.current;
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
                makeDefaultSegment(seg.id, seg.startPct, pct),
                makeDefaultSegment(Date.now(), pct, seg.endPct)
            );
            return next;
        });
    }, [audioUrl]);

    // CTRL+S — split at playhead only for the card currently under the cursor.
    // Checking isHoveredRef prevents all expanded cards from splitting simultaneously.
    useEffect(() => {
        if (!isExpanded || !audioUrl) return;
        const onKeyDown = (e) => {
            if (e.ctrlKey && e.key === 's' && isHoveredRef.current) {
                e.preventDefault();
                handleSplit();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isExpanded, audioUrl, handleSplit]);

    // Play Pause Sync
    useEffect(() => {
        if (!audioUrl) return;
        if (isPlaying && isVisible) {
            play();
            if (fadeIn > 0) applyFadeIn(fadeIn);
            fadeOutTriggeredRef.current = false;
        } else {
            pause();
        }
    }, [isPlaying, isVisible, play, pause, applyFadeIn, fadeIn, audioUrl]);

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
            initialZoom: zoom,
            initiallyExpanded: isExpanded,
            initialSegments: segmentsRef.current,
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trackName, volume, zoom, isExpanded, segments, handleUpdateTrack, trackId]);

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

                // Snap the visual playhead to the most-recently-passed beat (or half-beat).
                // This keeps the cursor on the beat grid, making CTRL+S cuts beat-accurate.
                // Falls back to smooth if beatPositions hasn't been populated yet.
                const beats = beatPositionsRef.current;
                let displayPosSec = audioPosSec;
                if (beats && beats.length > 1) {
                    // Build grid: every beat + the midpoint between consecutive beats
                    const grid = [];
                    for (let i = 0; i < beats.length; i++) {
                        grid.push(beats[i]);
                        if (i < beats.length - 1) grid.push((beats[i] + beats[i + 1]) / 2);
                    }
                    // Floor: largest grid point that has already been passed
                    let snapped = 0;
                    for (let i = 0; i < grid.length; i++) {
                        if (grid[i] <= audioPosSec) snapped = grid[i];
                        else break;
                    }
                    displayPosSec = snapped;
                }

                const displayProportion = Math.min(1, displayPosSec / track.audioBuffer.duration);
                currentTimePctRef.current = displayProportion;
                wavesurferRef.current.seekTo(displayProportion);

                // Trigger fade-out when within fadeOut seconds of the end
                if (!fadeOutTriggeredRef.current && fadeOut > 0) {
                    const remaining = track.audioBuffer.duration - audioPosSec;
                    if (remaining <= fadeOut && remaining > 0) {
                        fadeOutTriggeredRef.current = true;
                        applyFadeOut(remaining);
                    }
                }

                // Segment boundary detection — apply new segment's audio settings as playhead
                // crosses a cut point. Only pitch/speed/EQ are applied here (no effects
                // reconciliation) to avoid audio glitches during live playback.
                const segs = segmentsRef.current;
                if (segs && segs.length > 1 && durationRef.current > 0) {
                    const pct = audioPosSec / durationRef.current;
                    const playingSeg = segs.find(s => pct >= s.startPct && pct < s.endPct) ?? segs[segs.length - 1];
                    if (playingSeg && playingSeg.id !== playingSegmentIdRef.current) {
                        playingSegmentIdRef.current = playingSeg.id;
                        AudioEngineService.setPitch(trackId, playingSeg.pitch);
                        AudioEngineService.setSpeed(trackId, playingSeg.speed);
                        AudioEngineService.setEQ(trackId, { low: playingSeg.eqLow, mid: playingSeg.eqMid, high: playingSeg.eqHigh });
                        // Sync UI to reflect the playing segment (effects not reconciled here)
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
                        }
                    }
                }

                // Keep overlay translation in sync with WaveSurfer's auto-scroll each frame.
                // The native scroll listener handles user-initiated panning; this handles
                // programmatic seekTo() scrolling which may outpace the event.
                if (overlayContainerRef.current && wsScrollRef.current) {
                    overlayContainerRef.current.style.transform =
                        `translateX(-${wsScrollRef.current.scrollLeft}px)`;
                }
            }
            frameId = requestAnimationFrame(updatePlayhead);
        };
        if (isPlaying) updatePlayhead();
        return () => cancelAnimationFrame(frameId);
    }, [isPlaying, trackId, fadeOut, applyFadeOut]);

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
                className={`border-2 rounded-lg p-4 transition-all ${isExpanded ? 'h-auto' : 'h-24'} cursor-pointer ${!isVisible ? 'bg-base-900 border-base-800 opacity-60 grayscale-[0.5]' : 'bg-base-800'} ${isDragged ? 'opacity-50' : ''} ${isExpanded ? 'border-base-500' : 'border-base-700'}`}
                onClick={() => !isEditing && setIsExpanded(!isExpanded)}
            >
                <div className="flex justify-between items-center mb-4">
                    <div
                        className="flex items-center gap-2 relative group"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <input
                            type="text"
                            value={trackName}
                            onChange={(e) => setTrackName(e.target.value)}
                            disabled={!isEditing}
                            style={{ width: getDynamicInputWidth(trackName, 7) }}
                            className={`text-base-50 font-semibold px-1 py-1 rounded outline-none transition-colors cursor-text text-lg ${isEditing ? (isDuplicateName ? 'bg-red-900/30 ring-1 ring-red-500/60' : 'bg-base-900') : 'bg-transparent'}`}
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
                            <span className="text-xs font-medium text-red-400 whitespace-nowrap">Name already in use</span>
                        )}

                        <div className="flex items-center text-xs text-base-400 ml-4 gap-3">
                            <span><span className="text-base-300 font-medium whitespace-nowrap">Artist:</span> <span className="text-base-200">{artistName}</span></span>
                            <div className="w-1 h-1 shrink-0 rounded-full bg-base-600"></div>
                            <span><span className="text-base-300 font-medium whitespace-nowrap">BPM:</span> <span className="text-base-200">{bpm}</span></span>
                            <div className="w-1 h-1 shrink-0 rounded-full bg-base-600"></div>
                            <span><span className="text-base-300 font-medium whitespace-nowrap">Key:</span> <span className="text-base-200">{trackKey}</span></span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
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
                                            initialZoom: zoom,
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
                                disabled={!isVisible || !audioUrl}
                                title={!audioUrl ? 'No preview available' : undefined}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible || !audioUrl ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed' : isPlaying ? 'bg-base-500 text-base-50 border-base-400' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                            >
                                {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                                disabled={!isVisible}
                                className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed' : isMuted ? 'bg-base-600 text-base-50 border-base-500' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
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

                    </div>

                    {/* Right column — stretches to match left panel height.
                         Waveform fills remaining space; zoom slider sits at the bottom,
                         level with the volume slider on the left. */}
                    <div className="flex flex-col flex-1 min-w-0 gap-2">
                        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden bg-base-900 border border-base-700 shadow-inner rounded">
                            {/* Relative wrapper so overlays are positioned against waveform area.
                                overflow-hidden clips overlays that extend beyond the viewport;
                                WaveSurfer scrolls internally so clipping is correct. */}
                            <div className="relative h-full min-w-full overflow-hidden">
                                <div ref={waveformRef} className="h-full min-w-full"></div>

                                {/* Single overlay container — translateX is updated by the WaveSurfer
                                    'scroll' event so all overlays pan in sync with the waveform canvas. */}
                                <div
                                    ref={overlayContainerRef}
                                    className="absolute inset-0 pointer-events-none"
                                    style={{ overflow: 'visible' }}
                                >
                                    {/* Fade overlays — rendered for every segment that has a non-zero fade value.
                                    Reading from segment data directly avoids any lag from active-state updates. */}
                                    {audioDuration > 0 && (zoom === 0 || waveformPixelWidth > 0) && segments.flatMap(seg => {
                                        const overlays = [];
                                        if (seg.fadeIn > 0) {
                                            const fw = Math.min(seg.fadeIn / audioDuration, seg.endPct - seg.startPct);
                                            const style = zoom === 0
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
                                            const style = zoom === 0
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

                                    {/* Beat markers — thin vertical lines at each beat position.
                                    Only shown at zoom >= 25 to avoid visual noise at low zoom levels.
                                    Lines use fractional viewBox coords so they stay pixel-crisp. */}
                                    {zoom >= 25 && audioDuration > 0 && beatPositions && beatPositions.length > 0 && waveformPixelWidth > 0 && (
                                        <svg
                                            className="absolute inset-y-0 left-0 pointer-events-none z-15"
                                            style={{ width: waveformPixelWidth, height: '100%' }}
                                            viewBox="0 0 1 1"
                                            preserveAspectRatio="none"
                                        >
                                            {beatPositions.map((t, i) => (
                                                <line
                                                    key={i}
                                                    x1={t / audioDuration} y1={0}
                                                    x2={t / audioDuration} y2={1}
                                                    stroke="#59546C"
                                                    strokeWidth="1"
                                                    vectorEffect="non-scaling-stroke"
                                                />
                                            ))}
                                        </svg>
                                    )}

                                    {/* Segment region highlights — one per segment, covers startPct→endPct.
                                    Active segment shows a white border; others are unstyled.
                                    pointer-events-none so WaveSurfer handles all click/drag/seek events;
                                    segment activation is triggered via ws.on('interaction') instead. */}
                                    {audioUrl && segments.map(seg => (
                                        <div
                                            key={`hl-${seg.id}`}
                                            className={`absolute top-0 bottom-0 pointer-events-none z-[3] ${seg.id === activeSegmentId ? 'border-[3px] border-white/50 rounded-sm' : ''}`}
                                            style={{
                                                left: zoom > 0 && waveformPixelWidth > 0
                                                    ? seg.startPct * waveformPixelWidth
                                                    : `${seg.startPct * 100}%`,
                                                width: zoom > 0 && waveformPixelWidth > 0
                                                    ? (seg.endPct - seg.startPct) * waveformPixelWidth
                                                    : `${(seg.endPct - seg.startPct) * 100}%`,
                                            }}
                                        />
                                    ))}

                                    {/* Segment cut lines — anchored to absolute time position.
                                    Uses pixel left at zoom>0 (same math as fade overlays),
                                    falls back to % at zoom=0 where waveform fills container. */}
                                    {segments.slice(1).map(seg => (
                                        <div
                                            key={seg.id}
                                            className="absolute top-0 bottom-0 w-2 -translate-x-1/2 cursor-col-resize z-10 pointer-events-auto group"
                                            style={{
                                                left: zoom > 0 && waveformPixelWidth > 0
                                                    ? seg.startPct * waveformPixelWidth
                                                    : `${seg.startPct * 100}%`
                                            }}
                                        >
                                            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-orange-400/90 group-hover:bg-orange-300 transition-colors pointer-events-none" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Zoom Slider — short, pinned to the right */}
                        <div className="flex items-center gap-2 shrink-0 self-end" onClick={(e) => e.stopPropagation()}>
                            <ZoomIn size={12} className="text-base-300 shrink-0" />
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={zoom}
                                onChange={(e) => setZoom(Number(e.target.value))}
                                className="w-24 h-1 bg-base-700 rounded-lg appearance-none cursor-pointer accent-base-500 outline-none"
                            />
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
                                                <span className="text-xs font-mono text-base-300 w-10 text-right">{Number(speed).toFixed(2)}x</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="7"
                                                    step="1"
                                                    value={speedToIndex(speed)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) => { e.stopPropagation(); setSpeedWithSync(SPEED_PRESETS[parseInt(e.target.value)]); }}
                                                    className="w-20 h-1 bg-base-700 rounded-lg appearance-none cursor-pointer accent-base-500 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Gate G6 — warn when pitch or speed exceed quality thresholds.
                                     Once dismissed on this card it never reappears, regardless of
                                     value changes. Each card tracks dismissal independently. */}
                                {!g6Dismissed && (Math.abs(pitch) > 3 || parseFloat(speed) < 0.85 || parseFloat(speed) > 1.15) && (
                                    <div className="flex items-center gap-2 bg-base-800 border border-base-400/60 rounded-lg px-3 py-2" onClick={(e) => e.stopPropagation()}>
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

                                {/* EQ + Effects — always visible, side by side */}
                                <div className={`flex gap-4 pt-4 border-t border-base-800 items-stretch ${effects.length > 0 ? 'h-[19rem]' : ''}`} onClick={(e) => e.stopPropagation()}>

                                    {/* Equalizer */}
                                    <div className="shrink-0 w-60 p-4 bg-base-800 border border-base-700 rounded-lg">
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-[10px] font-bold text-base-400 uppercase tracking-wider">Equalizer</span>
                                            {(eqLow !== 0 || eqMid !== 0 || eqHigh !== 0 || eqKills.low || eqKills.mid || eqKills.high) && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEqLowWithSync(0); setEqMidWithSync(0); setEqHighWithSync(0); setEqKills({ low: false, mid: false, high: false }); }}
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
                                                            onClick={(e) => { e.stopPropagation(); setEqKills(k => ({ ...k, [killKey]: !k[killKey] })); }}
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
