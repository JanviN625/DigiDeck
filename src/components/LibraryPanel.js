import React, { useState, useEffect } from 'react';
import { ChevronLeft, Library, AlertCircle, ChevronRight } from 'lucide-react';
import { useSpotify } from '../context/SpotifyContext';
import PlaylistTracksModal from './PlaylistTracksModal';

export default function LibraryPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { getUserPlaylists } = useSpotify();
    
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal state
    const [selectedPlaylist, setSelectedPlaylist] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        let mounted = true;
        const fetchPlaylists = async () => {
            try {
                setLoading(true);
                setError(null);
                const data = await getUserPlaylists(20, 0);
                if (mounted && data && data.items) {
                    console.log("[LibraryPanel] Playlists received:", data.items);
                    setPlaylists(data.items);
                }
            } catch (err) {
                if (mounted) {
                    console.error("Failed to load playlists:", err);
                    setError(err.message || "Failed to load playlists");
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchPlaylists();
        return () => { mounted = false; };
    }, [getUserPlaylists]);

    const openPlaylistModal = (playlist) => {
        setSelectedPlaylist(playlist);
        setIsModalOpen(true);
    };

    return (
        <aside className={`${isCollapsed ? 'w-16' : 'w-64'} bg-base-900 border-r border-base-700 flex flex-col shrink-0 transition-all duration-300 relative overflow-hidden`}>
            {isCollapsed ? (
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button
                        onClick={() => setIsCollapsed(false)}
                        title="Expand Library"
                        className="p-1.5 rounded hover:bg-base-800 transition-colors"
                    >
                        <Library className="text-base-300 hover:text-base-50 transition-colors" size={24} />
                    </button>
                </div>
            ) : (
                <div className="p-4 flex flex-col h-full w-64 shrink-0 transition-opacity duration-300">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-sm font-bold text-base-50 px-1">Imported Spotify Playlists</h2>
                        <button
                            onClick={() => setIsCollapsed(true)}
                            className="text-base-300 hover:text-base-50 p-1.5 rounded hover:bg-base-800 transition-colors shrink-0"
                            title="Collapse Library"
                        >
                            <ChevronLeft size={16} />
                        </button>
                    </div>
                    
                    <div className="mb-4 mt-2 p-3 bg-base-800 rounded-md text-center text-sm font-medium border border-base-700 hover:border-base-500 cursor-pointer transition-colors text-base-200 hover:text-base-50">
                        Search Library
                    </div>

                    <nav className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-12 bg-base-800 rounded animate-pulse opacity-50"></div>
                            ))
                        ) : error ? (
                            <div className="p-3 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-400 flex flex-col gap-2">
                                <span className="flex items-center gap-1 font-semibold"><AlertCircle size={14} /> Error Loading</span>
                                <span>{error}</span>
                            </div>
                        ) : playlists.length === 0 ? (
                            <div className="text-xs text-base-400 text-center mt-4">No playlists found.</div>
                        ) : (
                            playlists.map((playlist) => {
                                return (
                                    <div key={playlist.id} className="flex flex-col border border-transparent hover:border-base-800 rounded group">
                                        <div 
                                            className="flex items-center gap-2 p-2 rounded hover:bg-base-800 cursor-pointer transition-colors"
                                            onClick={() => openPlaylistModal(playlist)}
                                        >
                                            <div className="text-base-500 shrink-0">
                                                <ChevronRight size={14} />
                                            </div>
                                            
                                            {playlist.images && playlist.images.length > 0 ? (
                                                <img src={playlist.images[0].url} alt={playlist.name} className="w-8 h-8 rounded shrink-0 object-cover border border-base-700" />
                                            ) : (
                                                <div className="w-8 h-8 rounded bg-base-800 border border-base-700 shrink-0 flex items-center justify-center">
                                                    <Library size={12} className="text-base-400" />
                                                </div>
                                            )}
                                        
                                            <div className="flex flex-col overflow-hidden">
                                                <span className="text-sm font-medium text-base-200 group-hover:text-base-50 truncate transition-colors">{playlist.name}</span>
                                                <span className="text-[10px] text-base-400 truncate">
                                                    {playlist.owner?.display_name ? `By ${playlist.owner.display_name}` : 'Spotify'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </nav>
                </div>
            )}

            <PlaylistTracksModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                playlist={selectedPlaylist}
            />
        </aside>
    );
}
