import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
    const [currentUid, setCurrentUid] = useState(null);
    const [trackLimitError, setTrackLimitError] = useState(null);
    const [universalIsPlaying, setUniversalIsPlaying] = useState(false);
    const [masterStopSignal, setMasterStopSignal] = useState(0);

    const triggerMasterStop = useCallback(() => {
        setUniversalIsPlaying(false);
        setMasterStopSignal(n => n + 1);
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

    const handleAddTrack = useCallback((trackData = {}) => {
        const isRealTrack = !!(trackData.audioUrl || trackData.spotifyId);

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

            // At capacity — show error and bail out without mutating state.
            if (prev.length >= 5) {
                setTimeout(() => {
                    setTrackLimitError("Cannot add track: Maximum limit of 5 tracks reached.");
                    setTimeout(() => setTrackLimitError(null), 3500);
                }, 0);
                return prev;
            }

            const baseTitle = trackData.title || getNextAvailableTrackName(prev);
            const title = trackData.title
                ? getUniqueTrackName(baseTitle, prev.map(t => t.title))
                : baseTitle;
            return [...prev, {
                id: Date.now(),
                initiallyExpanded: false,
                ...trackData,
                title,
            }];
        });
    }, []);

    // All mutators use the functional setState form so they never close over a
    // stale `tracks` snapshot and their references stay stable across re-renders
    // (no dependency on `tracks`). This prevents TrackCard's settings-sync effect
    // from firing on every AppProviders re-render, which was causing a render loop
    // that disrupted HTML5 drag-and-drop events.

    const handleDuplicateTrack = useCallback((trackId, currentValues) => {
        setTracks(prev => {
            if (prev.length >= 5) return prev;
            const trackIndex = prev.findIndex(t => t.id === trackId);
            if (trackIndex === -1) return prev;
            const source = prev[trackIndex];
            const otherTitles = prev.map(t => t.title);
            const title = getUniqueTrackName(currentValues.title || source.title, otherTitles);
            const newTracks = [...prev];
            newTracks.splice(trackIndex + 1, 0, {
                ...source,
                ...currentValues,
                id: Date.now(),
                title,
                initiallyExpanded: false,
            });
            return newTracks;
        });
    }, []);

    const handleDeleteTrack = useCallback((idToRemove) => {
        setTracks(prev => prev.filter(track => track.id !== idToRemove));
    }, []);

    const handleMoveTrack = useCallback((fromIndex, toIndex) => {
        setTracks(prev => {
            if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return prev;
            const newTracks = [...prev];
            const [moved] = newTracks.splice(fromIndex, 1);
            newTracks.splice(toIndex, 0, moved);
            return newTracks;
        });
    }, []);

    const handleUpdateTrack = useCallback((idToUpdate, updates) => {
        setTracks(prev => prev.map(track =>
            track.id === idToUpdate ? { ...track, ...updates } : track
        ));
    }, []);

    return (
        <SpotifyContext.Provider value={{ ...SpotifyService }}>
            <MixContext.Provider value={{ tracks, handleAddTrack, handleDuplicateTrack, handleDeleteTrack, handleMoveTrack, handleUpdateTrack, trackLimitError, setTrackLimitError, universalIsPlaying, setUniversalIsPlaying, masterStopSignal, triggerMasterStop }}>
                {children}
            </MixContext.Provider>
        </SpotifyContext.Provider>
    );
}
