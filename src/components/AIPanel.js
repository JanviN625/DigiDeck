import React, { useState, useEffect } from 'react';
import { ChevronRight, Sparkles, RefreshCw, AlertCircle } from 'lucide-react';
import { useSpotify, useMix } from '../context/SpotifyContext';
import { pitchClassToKey } from '../utils/helpers';

export default function AIPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { getRecommendations, getMultipleAudioFeatures } = useSpotify();
    const { tracks, handleAddTrack } = useMix();

    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchSuggestions = async () => {
        // We need at least one track to seed recommendations
        if (!tracks || tracks.length === 0) {
            setSuggestions([]);
            setError("Add at least one track to your mix to get AI suggestions.");
            return;
        }

        // Ideally we would use the actual Spotify Track IDs here.
        // For now, since tracks don't have real Spotify IDs yet, we will mock the seed
        // with a known valid ID or skip fetching if no valid IDs exist.
        // TODO: Update once TrackSearchModal is implemented and adding real IDs.
        const seedTracks = tracks.map(t => t.spotifyId).filter(Boolean);
        
        if (seedTracks.length === 0) {
            setSuggestions([]);
            setError("No valid Spotify tracks in mix to use as seeds.");
            return;
        }

        try {
            setLoading(true);
            setError(null);
            
            // Design G2: Recommendation Count Boundary (fetch up to 10)
            const data = await getRecommendations(seedTracks, undefined, undefined, 10);
            
            if (data && data.tracks) {
                // Fetch real audio features for all recommendations at once
                let featuresMap = {};
                try {
                    const trackIds = data.tracks.map(t => t.id);
                    const featuresData = await getMultipleAudioFeatures(trackIds);
                    if (featuresData && featuresData.audio_features) {
                        featuresData.audio_features.forEach(f => {
                            if (f) featuresMap[f.id] = f;
                        });
                    }
                } catch (err) {
                    console.warn("Could not fetch real audio features for suggestions", err);
                }

                // Map the Spotify track objects to our suggestion format
                const formatted = data.tracks.map(track => {
                    const feat = featuresMap[track.id];
                    let bpm = '--';
                    let keyStr = '--';

                    if (feat && feat.tempo) {
                        bpm = Math.round(feat.tempo);
                        keyStr = pitchClassToKey(feat.key, feat.mode);
                    } else {
                        console.warn("Empty features returned for track", track.id);
                    }

                    return {
                        id: track.id,
                        name: track.name,
                        artist: track.artists.map(a => a.name).join(', '),
                        bpm: bpm, 
                        key: keyStr, 
                        match: Math.floor(Math.random() * 20) + 80, // Mock Match %
                        art: track.album?.images?.[0]?.url,
                        audioUrl: track.preview_url
                    };
                });
                setSuggestions(formatted);
            }
        } catch (err) {
            console.error("Failed to load recommendations:", err);
            setError(err.message || "Failed to load recommendations");
        } finally {
            setLoading(false);
        }
    };

    // Auto-fetch when the tracks array changes
    useEffect(() => {
        fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tracks]);

    return (
        <aside className={`${isCollapsed ? 'w-16' : 'w-72'} bg-base-900 border-l border-base-700 flex flex-col shrink-0 transition-all duration-300 relative overflow-hidden`}>
            {isCollapsed ? (
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button
                        onClick={() => setIsCollapsed(false)}
                        title="Expand AI Recommendations"
                        className="p-1.5 rounded hover:bg-base-800 transition-colors"
                    >
                        <Sparkles className="text-base-700 hover:text-base-200 transition-colors" size={24} />
                    </button>
                </div>
            ) : (
                <div className="p-4 flex flex-col h-full w-72 shrink-0 transition-opacity duration-300">
                    <div className="flex justify-between items-center mb-3">
                        <button
                            onClick={() => setIsCollapsed(true)}
                            className="text-base-700 hover:text-base-200 p-1.5 rounded hover:bg-base-800 transition-colors shrink-0"
                            title="Collapse Panel"
                        >
                            <ChevronRight size={16} />
                        </button>
                        <h2 className="text-sm font-bold text-base-200 px-1 truncate flex items-center gap-2">
                            <Sparkles size={16} className="text-base-500" />
                            AI Suggestions
                        </h2>
                    </div>

                    <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
                        <div className="text-xs font-semibold text-base-400 uppercase tracking-wider mb-2">Based on your current mix:</div>

                        {loading ? (
                            <div className="flex flex-col gap-3">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="h-24 bg-base-800 rounded-lg animate-pulse opacity-50 border border-base-700"></div>
                                ))}
                            </div>
                        ) : error ? (
                            <div className="p-3 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-400 flex flex-col gap-2">
                                <span className="flex items-center gap-1 font-semibold"><AlertCircle size={14} /> AI Engine Issue</span>
                                <span>{error}</span>
                            </div>
                        ) : suggestions.length === 0 ? (
                            <div className="text-xs text-base-400 text-center mt-4 p-4 border border-base-700 border-dashed rounded-lg">
                                No suggestions available. Add Spotify tracks to your mix first.
                            </div>
                        ) : (
                            suggestions.map((suggestion) => (
                                <div key={suggestion.id} className="bg-base-800 p-3 rounded-lg border border-base-700 hover:border-base-400 transition-colors cursor-pointer group shadow-sm hover:shadow-md">
                                    <div className="flex items-start gap-3 mb-2">
                                        {suggestion.art ? (
                                            <img src={suggestion.art} alt={suggestion.name} className="w-12 h-12 rounded object-cover border border-base-700 shrink-0" />
                                        ) : (
                                            <div className="w-12 h-12 rounded bg-base-900 border border-base-700 shrink-0 flex items-center justify-center">
                                                <Sparkles size={16} className="text-base-500" />
                                            </div>
                                        )}
                                        <div className="flex flex-col flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-0.5">
                                                <div className="text-sm font-bold text-base-50 group-hover:text-base-50 truncate pr-2">{suggestion.name}</div>
                                                <div className="text-[10px] whitespace-nowrap font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">{suggestion.match}% Match</div>
                                            </div>
                                            <div className="text-xs text-base-300 truncate">{suggestion.artist}</div>
                                            <div className="text-[10px] text-base-400 mt-1">{suggestion.bpm} • {suggestion.key}</div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2 mt-3">
                                        <button className="text-xs bg-base-900 text-base-100 px-2 py-1.5 rounded hover:bg-base-600 hover:text-base-50 transition-colors w-full border border-base-700">Preview</button>
                                        <button 
                                            onClick={() => handleAddTrack({ 
                                                title: suggestion.name, 
                                                spotifyId: suggestion.id,
                                                artistName: suggestion.artist,
                                                albumArt: suggestion.art,
                                                audioUrl: suggestion.audioUrl,
                                                bpm: suggestion.bpm,
                                                trackKey: suggestion.key
                                            })}
                                            className="text-xs font-semibold bg-base-500 text-base-50 px-2 py-1.5 rounded hover:bg-base-400 transition-colors w-full shadow-sm"
                                        >
                                            + Add to Mix
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}

                        <button 
                            onClick={fetchSuggestions}
                            disabled={loading || tracks.length === 0}
                            className={`flex items-center justify-center gap-2 w-full py-3 mt-4 text-xs font-bold rounded-lg transition-all group border ${loading || tracks.length === 0 ? 'bg-base-900 text-base-500 border-base-800 cursor-not-allowed' : 'text-base-300 hover:text-base-100 bg-base-900 border-base-700 hover:border-base-500'}`}
                        >
                            <RefreshCw size={14} className={`${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                            {loading ? 'Refreshing...' : 'Refresh Suggestions'}
                        </button>
                    </div>
                </div>
            )}
        </aside>
    );
}
