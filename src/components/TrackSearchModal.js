import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Music, Loader2, AlertCircle } from 'lucide-react';
import { useSpotify, useMix } from '../context/SpotifyContext';
import { pitchClassToKey } from '../utils/helpers';

export default function TrackSearchModal({ isOpen, onClose }) {
    const { searchSpotify, getAudioFeatures } = useSpotify();
    const { handleAddTrack } = useMix();

    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const inputRef = useRef(null);

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current.focus(), 100);
        }
    }, [isOpen]);

    // Debounced search
    useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setResults([]);
            setError(null);
            return;
        }

        if (!query.trim()) {
            setResults([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            try {
                setLoading(true);
                setError(null);
                
                // Design F16: Support searching tracks, artists, etc. 
                // We'll restrict to tracks for adding to the mix here.
                const data = await searchSpotify(query, ['track'], 10);
                
                if (data && data.tracks && data.tracks.items) {
                    setResults(data.tracks.items);
                }
            } catch (err) {
                console.error("Search error:", err);
                setError(err.message || "Failed to search Spotify.");
            } finally {
                setLoading(false);
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(delayDebounceFn);
    }, [query, isOpen, searchSpotify]);

    const handleSelectTrack = async (track) => {
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
        onClose();
        setQuery('');
        setResults([]);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div 
                className="bg-base-900 border border-base-700 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header / Search Bar */}
                <div className="p-4 border-b border-base-800 flex items-center gap-3 bg-base-900/50 sticky top-0">
                    <Search className="text-base-500 shrink-0" size={20} />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search Spotify for tracks to add..."
                        className="flex-1 bg-transparent text-base-50 text-lg outline-none placeholder:text-base-600"
                    />
                    {query && (
                        <button 
                            onClick={() => setQuery('')}
                            className="text-base-500 hover:text-base-300 p-1 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    )}
                    <div className="w-px h-6 bg-base-800 mx-2 text-base-800"></div>
                    <button 
                        onClick={onClose}
                        className="text-base-400 hover:text-base-50 px-2 py-1 rounded transition-colors text-sm font-medium"
                    >
                        ESC
                    </button>
                </div>

                {/* Results Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-base-950 min-h-[300px]">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full text-base-500 gap-3 py-20">
                            <Loader2 size={32} className="animate-spin" />
                            <span className="text-sm font-medium">Searching Spotify...</span>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-red-400 gap-3 py-20 px-8 text-center">
                            <AlertCircle size={48} className="text-red-500/50 mb-2" />
                            <span className="text-lg font-bold">Search Failed</span>
                            <span className="text-sm opacity-80">{error}</span>
                        </div>
                    ) : results.length > 0 ? (
                        <div className="flex flex-col gap-1 p-2">
                            {results.map((track) => (
                                <div 
                                    key={track.id}
                                    onClick={() => handleSelectTrack(track)}
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
                    ) : query.trim() ? (
                        <div className="flex flex-col items-center justify-center h-full text-base-500 gap-3 py-20">
                            <Music size={48} className="opacity-20 mb-2" />
                            <span className="text-lg font-medium text-base-400">No tracks found for "{query}"</span>
                            <span className="text-sm">Try searching by artist or track name.</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-base-600 gap-4 py-32">
                            <Search size={48} className="opacity-20 mb-2" />
                            <span className="text-lg font-medium">Search for a track to add</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
