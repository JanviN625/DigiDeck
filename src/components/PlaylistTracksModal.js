import React, { useState, useEffect } from 'react';
import { X, Music, Loader2, AlertCircle } from 'lucide-react';
import { useSpotify, useMix } from '../context/SpotifyContext';
import { pitchClassToKey } from '../utils/helpers';

export default function PlaylistTracksModal({ isOpen, onClose, playlist }) {
    const { getPlaylistTracks, getAudioFeatures } = useSpotify();
    const { handleAddTrack } = useMix();

    const [tracks, setTracks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch tracks when modal opens with a valid playlist
    useEffect(() => {
        if (!isOpen || !playlist) {
            setTracks([]);
            setError(null);
            return;
        }

        const fetchTracks = async () => {
            try {
                setLoading(true);
                setError(null);
                
                const data = await getPlaylistTracks(playlist.id, 50, 0); // Load up to 50 items
                
                if (data && data.items) {
                    // Filter and extract the valid track objects
                    const validTracks = data.items.reduce((acc, playlistItem) => {
                        const itemData = playlistItem.item || playlistItem.track;
                        if (itemData && itemData.type === 'track' && itemData.id && !playlistItem.is_local) {
                            acc.push(itemData);
                        }
                        return acc;
                    }, []);
                    
                    setTracks(validTracks);
                } else {
                    setTracks([]);
                }
            } catch (err) {
                console.error("Failed to load playlist tracks:", err);
                setError(err.message || "Failed to load playlist tracks.");
            } finally {
                setLoading(false);
            }
        };

        fetchTracks();
    }, [isOpen, playlist, getPlaylistTracks]);

    const onSelectTrack = async (track) => {
        let bpm = '--';
        let keyStr = '--';

        try {
            const features = await getAudioFeatures(track.id);
            if (features && features.tempo) {
                bpm = Math.round(features.tempo);
                keyStr = pitchClassToKey(features.key, features.mode);
            } else {
                console.warn("Empty features returned for track", track.id);
            }
        } catch (err) {
            console.warn("Could not fetch real audio features for track", err);
        }

        handleAddTrack({
            title: track.name,
            spotifyId: track.id,
            artistName: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
            albumArt: track.album?.images?.[0]?.url,
            audioUrl: track.preview_url,
            bpm: bpm,
            trackKey: keyStr
        });
        
        // Optional: Close modal after adding a track. 
        // We'll keep it open so they can add multiple tracks easily.
    };

    if (!isOpen || !playlist) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div 
                className="bg-base-900 border border-base-700 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-base-800 flex items-center gap-3 bg-base-900/50 sticky top-0">
                    {playlist.images && playlist.images.length > 0 ? (
                        <img src={playlist.images[0].url} alt="Cover" className="w-10 h-10 rounded shrink-0 object-cover shadow border border-base-700" />
                    ) : (
                        <div className="w-10 h-10 rounded bg-base-800 border border-base-700 shrink-0 flex items-center justify-center">
                            <Music size={18} className="text-base-400" />
                        </div>
                    )}
                    
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <h2 className="text-lg font-bold text-base-50 truncate">{playlist.name}</h2>
                        <span className="text-xs text-base-400 truncate">{playlist.tracks?.total || tracks.length || 0} tracks</span>
                    </div>

                    <div className="w-px h-6 bg-base-800 mx-2"></div>
                    
                    <button 
                        onClick={onClose}
                        className="text-base-400 hover:text-base-50 px-2 py-1 rounded transition-colors"
                        title="Close Modal"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Results Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-base-950 min-h-[300px]">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full text-base-500 gap-3 py-20">
                            <Loader2 size={32} className="animate-spin" />
                            <span className="text-sm font-medium">Loading tracks...</span>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-red-400 gap-3 py-20 px-8 text-center">
                            <AlertCircle size={48} className="text-red-500/50 mb-2" />
                            <span className="text-lg font-bold">Failed to Load Tracks</span>
                            <span className="text-sm opacity-80">{error}</span>
                        </div>
                    ) : tracks.length > 0 ? (
                        <div className="flex flex-col gap-1 p-2">
                            {tracks.map((track) => (
                                <div 
                                    key={track.id}
                                    onClick={() => onSelectTrack(track)}
                                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-base-800 cursor-pointer transition-colors group border border-transparent hover:border-base-700"
                                >
                                    {track.album?.images?.[0] ? (
                                        <img 
                                            src={track.album.images[0].url} 
                                            alt={track.name} 
                                            className="w-12 h-12 rounded object-cover shadow-sm group-hover:shadow border border-base-800 group-hover:border-base-600 transition-all" 
                                        />
                                    ) : (
                                        <div className="w-12 h-12 rounded bg-base-800 flex items-center justify-center text-base-600 shrink-0">
                                            <Music size={20} />
                                        </div>
                                    )}
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <div className="text-base-50 font-bold truncate group-hover:text-white transition-colors">
                                            {track.name}
                                        </div>
                                        <div className="text-sm text-base-400 truncate">
                                            {track.artists?.map(a => a.name).join(', ')} • {track.album?.name}
                                        </div>
                                    </div>
                                    <button className="opacity-0 group-hover:opacity-100 px-4 py-2 bg-base-700 hover:bg-base-600 text-base-50 text-sm font-bold rounded-full transition-all shrink-0 shadow-sm transform translate-x-2 group-hover:translate-x-0">
                                        Add
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-base-500 gap-3 py-20">
                            <Music size={48} className="opacity-20 mb-2" />
                            <span className="text-base font-semibold">No Tracks Found</span>
                            <span className="text-sm">This playlist appears to be empty.</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
