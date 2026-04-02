import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SpotifyService, { initiateLogin, disconnectSpotify as spotifyDisconnect, isLoggedIn } from './spotifyApi';
import { getNextAvailableTrackName, getUniqueTrackName } from '../utils/helpers';
import { auth, db } from '../firebase/firebaseConfig';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

// ─── Contexts ─────────────────────────────────────────────────────────────────

const SpotifyContext = createContext();
const MixContext = createContext();

export const useSpotify = () => useContext(SpotifyContext);
export const useMix = () => useContext(MixContext);

// ─── History Constants ────────────────────────────────────────────────────────
const MAX_HISTORY = 50;

// ─── useSpotifyConnect ────────────────────────────────────────────────────────

export function useSpotifyConnect() {
    const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
    const [spotifyProfile, setSpotifyProfile] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);

    useEffect(() => {
        let unsubscribeSnapshot = null;

        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            // Always tear down the previous snapshot listener before attaching a new one.
            // The return value of the onAuthStateChanged callback is ignored by Firebase,
            // so the listener must be tracked at the effect level to avoid accumulation.
            if (unsubscribeSnapshot) {
                unsubscribeSnapshot();
                unsubscribeSnapshot = null;
            }

            if (user) {
                const userRef = doc(db, 'users', user.uid);
                unsubscribeSnapshot = onSnapshot(userRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        setIsSpotifyConnected(!!data.spotify && isLoggedIn());
                        setSpotifyProfile(data.spotify || null);
                    } else {
                        setIsSpotifyConnected(false);
                        setSpotifyProfile(null);
                    }
                    setIsLoading(false);
                }, (error) => {
                    // Firebase throws a permission-denied error here instantly on logout before the listener can detach.
                    // This is expected and safe to ignore.
                });
            } else {
                setIsSpotifyConnected(false);
                setSpotifyProfile(null);
                setIsLoading(false);
            }
        });

        return () => {
            unsubscribeAuth();
            if (unsubscribeSnapshot) unsubscribeSnapshot();
        };
    }, []);

    const connectSpotify = async () => {
        setIsConnecting(true);
        try {
            await initiateLogin();
        } catch (error) {
            console.error('Spotify connection failed', error);
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnectSpotify = async () => {
        await spotifyDisconnect();
        setIsSpotifyConnected(false);
        setSpotifyProfile(null);
    };

    return { isSpotifyConnected, spotifyProfile, isLoading, isConnecting, connectSpotify, disconnectSpotify };
}

// ─── AppProviders ─────────────────────────────────────────────────────────────

const isDefaultName = (name) => /^Track \d+$/.test(name);

const DEFAULT_TRACKS = [
    { id: 1, title: 'Track 1', initiallyExpanded: true },
    { id: 2, title: 'Track 2', initiallyExpanded: false }
];

export function AppProviders({ children }) {
    // Start with defaults — auth hasn't resolved yet, so we never speculatively
    // load from localStorage here. The onAuthStateChanged effect below loads the
    // correct user-scoped workspace once we know who is signed in.
    const [tracks, setTracks] = useState(DEFAULT_TRACKS);
    
    // Undo / Redo State
    const [historyState, setHistoryState] = useState({
        list: [DEFAULT_TRACKS],
        index: 0
    });

    const [currentUid, setCurrentUid] = useState(null);
    const [trackLimitError, setTrackLimitError] = useState(null);
    const [universalIsPlaying, setUniversalIsPlaying] = useState(false);
    const [masterStopSignal, setMasterStopSignal] = useState(0);
    const [globalZoom, setGlobalZoom] = useState(0);
    const [masterBpm, setMasterBpm] = useState(128);

    const triggerMasterStop = useCallback(() => {
        setUniversalIsPlaying(false);
        setMasterStopSignal(n => n + 1);
        masterTimeRef.current = 0;
    }, []);

    // Auth-gated workspace hydration — loads the correct user's saved workspace
    // when they sign in, and resets to defaults on sign-out or emulator reset
    // (which invalidates tokens and fires this listener with null).
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setCurrentUid(user.uid);
                try {
                    const saved = localStorage.getItem(`digideck_workspace_${user.uid}`);
                    if (saved) setTracks(JSON.parse(saved));
                } catch {}
            } else {
                // Signed out, emulator reset, or expired session — wipe state
                setCurrentUid(null);
                setTracks(DEFAULT_TRACKS);
            }
        });
        return () => unsubscribe();
    }, []);

    // Debounced workspace persistence — keyed by UID so accounts never share data.
    // Skipped entirely when no user is authenticated.
    useEffect(() => {
        if (!currentUid) return;
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(`digideck_workspace_${currentUid}`, JSON.stringify(tracks));
            } catch {}
        }, 500);
        return () => clearTimeout(timer);
    }, [tracks, currentUid]);

    // ─── History Management ─────────────────────────────────────────────────────

    const commitHistory = useCallback((newTracks) => {
        setHistoryState(prev => {
            const past = prev.list.slice(0, prev.index + 1);
            past.push(newTracks);
            if (past.length > MAX_HISTORY) past.shift();
            return { list: past, index: past.length - 1 };
        });
    }, []);

    const handleUndo = useCallback(() => {
        setHistoryState(prev => {
            if (prev.index > 0) {
                const newIndex = prev.index - 1;
                setTracks(prev.list[newIndex]);
                return { ...prev, index: newIndex };
            }
            return prev;
        });
    }, []);

    const handleRedo = useCallback(() => {
        setHistoryState(prev => {
            if (prev.index < prev.list.length - 1) {
                const newIndex = prev.index + 1;
                setTracks(prev.list[newIndex]);
                return { ...prev, index: newIndex };
            }
            return prev;
        });
    }, []);

    const commitCurrentState = useCallback(() => {
        setTracks(prev => {
            commitHistory(prev);
            return prev;
        });
    }, [commitHistory]);

    // ─── Track Mutators ─────────────────────────────────────────────────────────

    const handleAddTrack = useCallback((trackData = {}) => {
        const isRealTrack = !!(trackData.audioUrl || trackData.spotifyId || trackData.originalSourceId);
        // Support extracted tracks referencing their original parent for limit purposes
        setTrackLimitError(null);
        setTracks(prev => {
            // Spotify/upload tracks — fill the first empty default slot rather than appending.
            if (isRealTrack) {
                const emptyIndex = prev.findIndex(t => !t.audioUrl && !t.spotifyId);
                if (emptyIndex !== -1) {
                    const newTracks = [...prev];
                    const existing = newTracks[emptyIndex];
                    const resolvedTitle = (trackData.title && isDefaultName(existing.title))
                        ? trackData.title
                        : existing.title;
                    const otherTitles = prev.filter((_, i) => i !== emptyIndex).map(t => t.title);
                    newTracks[emptyIndex] = {
                        ...existing,
                        initiallyExpanded: true,
                        ...trackData,
                        title: getUniqueTrackName(resolvedTitle, otherTitles),
                    };
                    return newTracks;
                }
            }

            const uniqueBaseSongs = new Set(prev.map(t => t.sourceId || t.id));
            const isNewBaseSong = !trackData.sourceId;

            // At capacity — show error and bail out without mutating state.
            if (isNewBaseSong && uniqueBaseSongs.size >= 5) {
                setTimeout(() => {
                    setTrackLimitError("Cannot add track: Maximum limit of 5 distinct songs reached.");
                    setTimeout(() => setTrackLimitError(null), 3500);
                }, 0);
                return prev;
            }

            const baseTitle = trackData.title || getNextAvailableTrackName(prev);
            const title = trackData.title
                ? getUniqueTrackName(baseTitle, prev.map(t => t.title))
                : baseTitle;
            const newTrack = {
                id: trackData.id || Date.now() + Math.random(),
                initiallyExpanded: false,
                offsetSec: 0,
                duration: 0,
                ...trackData,
                title,
            };

            if (trackData.insertAfterId) {
                const idx = prev.findIndex(t => t.id === trackData.insertAfterId);
                if (idx !== -1) {
                    const next = [...prev];
                    next.splice(idx + 1, 0, newTrack);
                    return next;
                }
            }

            return [...prev, newTrack];
        });
    }, []);

    // All mutators use the functional setState form so they never close over a
    // stale `tracks` snapshot and their references stay stable across re-renders
    // (no dependency on `tracks`). This prevents TrackCard's settings-sync effect
    // from firing on every AppProviders re-render, which was causing a render loop
    // that disrupted HTML5 drag-and-drop events.

    const handleDuplicateTrack = useCallback((trackId, currentValues, skipHistory = false) => {
        setTracks(prev => {
            const trackIndex = prev.findIndex(t => t.id === trackId);
            if (trackIndex === -1) return prev;

            const src = prev[trackIndex];
            const uniqueBaseSongs = new Set(prev.map(t => t.sourceId || t.id));
            const baseId = src.sourceId || src.id;

            // If it's a completely new base song (unlikely for duplicates), enforce limit
            if (!uniqueBaseSongs.has(baseId) && uniqueBaseSongs.size >= 5) {
                setTimeout(() => {
                    setTrackLimitError("Cannot duplicate: Maximum limit of 5 distinct songs reached.");
                    setTimeout(() => setTrackLimitError(null), 3500);
                }, 0);
                return prev;
            }

            const newTrack = {
                ...src,
                ...currentValues,
                title: getUniqueTrackName(`${currentValues?.title || src.title} (Copy)`, prev.map(t => t.title)),
                id: Date.now(),
                sourceId: baseId,
                offsetSec: currentValues?.offsetSec ?? src.offsetSec ?? 0,
                initiallyExpanded: true,
            };
            const next = [...prev];
            next.splice(trackIndex + 1, 0, newTrack);
            if (!skipHistory) commitHistory(next);
            return next;
        });
    }, [commitHistory]);

    const handleDeleteTrack = useCallback((idToRemove, skipHistory = false) => {
        setTracks(prev => {
            const next = prev.filter(track => track.id !== idToRemove);
            if (!skipHistory) commitHistory(next);
            return next;
        });
    }, [commitHistory]);

    const handleMoveTrack = useCallback((fromIndex, toIndex, skipHistory = false) => {
        setTracks(prev => {
            if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            if (!skipHistory) commitHistory(next);
            return next;
        });
    }, [commitHistory]);

    const handleUpdateTrack = useCallback((idToUpdate, updates, skipHistory = false) => {
        setTracks(prev => {
            const next = prev.map(track =>
                track.id === idToUpdate ? { ...track, ...updates } : track
            );
            if (!skipHistory) commitHistory(next);
            return next;
        });
    }, [commitHistory]);

    const handleUpdateTrackDuration = useCallback((trackId, duration, skipHistory = true) => {
        setTracks(prev => {
            const next = prev.map(t => t.id === trackId ? { ...t, duration } : t);
            if (!skipHistory) commitHistory(next);
            return next;
        });
    }, [commitHistory]);

    const handleClearAllTracks = useCallback((skipHistory = false) => {
        setTracks(prev => {
            const next = DEFAULT_TRACKS.map((t, i) => ({ ...t, id: Date.now() + i }));
            if (!skipHistory) commitHistory(next);
            return next;
        });
    }, [commitHistory]);

    const handleOverwriteTracks = useCallback((newTracksArray, skipHistory = false) => {
        setTracks(prev => {
            if (!skipHistory) commitHistory(newTracksArray);
            return newTracksArray;
        });
    }, [commitHistory]);

    const masterDuration = useMemo(() => {
        if (!tracks.length) return 0;
        return Math.max(0, ...tracks.map(t => (t.offsetSec || 0) + (t.duration || 0)));
    }, [tracks]);

    // Master Clock tracking
    const masterTimeRef = useRef(0);
    const lastTickRef = useRef(0);

    useEffect(() => {
        let handle;
        const tick = () => {
            if (universalIsPlaying) {
                const now = performance.now();
                masterTimeRef.current += (now - lastTickRef.current) / 1000;
                lastTickRef.current = now;
                handle = requestAnimationFrame(tick);
            }
        };
        if (universalIsPlaying) {
            lastTickRef.current = performance.now();
            handle = requestAnimationFrame(tick);
        }
        return () => cancelAnimationFrame(handle);
    }, [universalIsPlaying]);

    const handleSeekMaster = useCallback((timeSec) => {
        masterTimeRef.current = timeSec;
    }, []);

    return (
        <SpotifyContext.Provider value={{ ...SpotifyService }}>
            <MixContext.Provider value={{ tracks, handleAddTrack, handleDuplicateTrack, handleDeleteTrack, handleMoveTrack, handleUpdateTrack, handleUpdateTrackDuration, handleClearAllTracks, handleOverwriteTracks, trackLimitError, setTrackLimitError, universalIsPlaying, setUniversalIsPlaying, masterStopSignal, triggerMasterStop, globalZoom, setGlobalZoom, masterBpm, setMasterBpm, masterDuration, masterTimeRef, handleSeekMaster, handleUndo, handleRedo, commitCurrentState, canUndo: historyState.index > 0, canRedo: historyState.index < historyState.list.length - 1 }}>
                {children}
            </MixContext.Provider>
        </SpotifyContext.Provider>
    );
}
