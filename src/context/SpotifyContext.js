import React, { createContext, useContext, useState, useEffect } from 'react';
import SpotifyService from '../spotify/SpotifyService';
import { getAccessToken } from '../spotify/spotifyAuth';
import { getNextAvailableTrackName } from '../utils/helpers';

// 1. Create the contexts
const SpotifyContext = createContext();
const MixContext = createContext();

// 2. Custom hooks for easy consumption
export function useSpotify() {
    return useContext(SpotifyContext);
}

export function useMix() {
    return useContext(MixContext);
}

// 3. Provider Component
export function AppProviders({ children }) {
    // ---- Mix State ----
    const [tracks, setTracks] = useState([
        { id: 1, title: 'Track 1', initiallyExpanded: true },
        { id: 2, title: 'Track 2', initiallyExpanded: false }
    ]);

    // ---- Spotify Player State ----
    const [player, setPlayer] = useState(null);
    const [deviceId, setDeviceId] = useState(null);

    // Initialize the Web Playback SDK
    useEffect(() => {
        const token = getAccessToken();
        if (!token) return;

        // Add the script
        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);

        window.onSpotifyWebPlaybackSDKReady = () => {
            const spotifyPlayer = new window.Spotify.Player({
                name: 'DigiDeck Web Player',
                getOAuthToken: cb => { cb(token); },
                volume: 0.8
            });

            setPlayer(spotifyPlayer);

            spotifyPlayer.addListener('ready', ({ device_id }) => {
                console.log('Spotify Web Player Ready with Device ID', device_id);
                setDeviceId(device_id);
            });

            spotifyPlayer.addListener('not_ready', ({ device_id }) => {
                console.log('Device ID has gone offline', device_id);
                setDeviceId(null);
            });
            
            // Connect to the player!
            spotifyPlayer.connect().then(success => {
                if (success) {
                    console.log('The Web Playback SDK successfully connected to Spotify!');
                }
            });
        };
        
        return () => {
            // Clean up when unmounting
            if (player) {
                player.disconnect();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAddTrack = (trackData = {}) => {
        if (tracks.length >= 5) return; // Hard limit

        setTracks([
            ...tracks,
            {
                id: Date.now(),
                title: trackData.title || getNextAvailableTrackName(tracks),
                initiallyExpanded: false,
                ...trackData // Allow injecting Spotify data (artists, bpm, key)
            }
        ]);
    };

    const handleDuplicateTrack = (trackId, currentValues) => {
        if (tracks.length >= 5) return;
        const trackIndex = tracks.findIndex(t => t.id === trackId);
        if (trackIndex === -1) return;

        const newTrack = {
            id: Date.now(),
            title: getNextAvailableTrackName(tracks),
            initiallyExpanded: false,
            ...currentValues
        };

        const newTracks = [...tracks];
        newTracks.splice(trackIndex + 1, 0, newTrack);
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
            if (position === 'bottom') {
                dropIndex++;
            }
        } else {
            if (position === 'bottom') {
                dropIndex++;
            }
        }

        newTracks.splice(dropIndex, 0, draggedTrack);
        setTracks(newTracks);
    };

    const mixProviderValue = {
        tracks,
        handleAddTrack,
        handleDuplicateTrack,
        handleDeleteTrack,
        handleReorderTracks,
        player,
        deviceId
    };

    // ---- Spotify State ----
    // Expose the SpotifyService functions
    const spotifyProviderValue = {
        ...SpotifyService
    };

    return (
        <SpotifyContext.Provider value={spotifyProviderValue}>
            <MixContext.Provider value={mixProviderValue}>
                {children}
            </MixContext.Provider>
        </SpotifyContext.Provider>
    );
}
