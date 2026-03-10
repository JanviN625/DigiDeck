import React, { createContext, useContext, useState, useEffect } from 'react';
import SpotifyService, { initiateLogin, disconnectSpotify as spotifyDisconnect, isLoggedIn } from './spotifyApi';
import { getNextAvailableTrackName } from '../utils/helpers';
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
        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            if (user) {
                const userRef = doc(db, 'users', user.uid);
                const unsubscribeSnapshot = onSnapshot(userRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        setIsSpotifyConnected(!!data.spotify && isLoggedIn());
                        setSpotifyProfile(data.spotify || null);
                    } else {
                        setIsSpotifyConnected(false);
                        setSpotifyProfile(null);
                    }
                    setIsLoading(false);
                });
                return () => unsubscribeSnapshot();
            } else {
                setIsSpotifyConnected(false);
                setSpotifyProfile(null);
                setIsLoading(false);
            }
        });
        return () => unsubscribeAuth();
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

export function AppProviders({ children }) {
    const [tracks, setTracks] = useState([
        { id: 1, title: 'Track 1', initiallyExpanded: true },
        { id: 2, title: 'Track 2', initiallyExpanded: false }
    ]);

    const handleAddTrack = (trackData = {}) => {
        if (tracks.length >= 5) return; // Hard limit
        setTracks([...tracks, {
            id: Date.now(),
            title: trackData.title || getNextAvailableTrackName(tracks),
            initiallyExpanded: false,
            ...trackData // Allow injecting Spotify data (artists, bpm, key)
        }]);
    };

    const handleDuplicateTrack = (trackId, currentValues) => {
        if (tracks.length >= 5) return;
        const trackIndex = tracks.findIndex(t => t.id === trackId);
        if (trackIndex === -1) return;

        const newTracks = [...tracks];
        newTracks.splice(trackIndex + 1, 0, {
            id: Date.now(),
            title: getNextAvailableTrackName(tracks),
            initiallyExpanded: false,
            ...currentValues
        });
        setTracks(newTracks);
    };

    const handleDeleteTrack = (idToRemove) => {
        setTracks(tracks.filter(track => track.id !== idToRemove));
    };

    const handleReorderTracks = (dragIndex, targetIndex, position) => {
        if (dragIndex === targetIndex) return;

        const newTracks = [...tracks];
        const [draggedTrack] = newTracks.splice(dragIndex, 1);

        let dropIndex = targetIndex;
        if (dragIndex < targetIndex) {
            dropIndex = targetIndex - 1;
            if (position === 'bottom') dropIndex++;
        } else {
            if (position === 'bottom') dropIndex++;
        }

        newTracks.splice(dropIndex, 0, draggedTrack);
        setTracks(newTracks);
    };

    return (
        <SpotifyContext.Provider value={{ ...SpotifyService }}>
            <MixContext.Provider value={{ tracks, handleAddTrack, handleDuplicateTrack, handleDeleteTrack, handleReorderTracks }}>
                {children}
            </MixContext.Provider>
        </SpotifyContext.Provider>
    );
}
