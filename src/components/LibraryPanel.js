import React, { useState, useEffect } from 'react';
import { ChevronLeft, Library, AlertCircle, ChevronRight, Upload, Play, Search, Loader2, Music, X } from 'lucide-react';
import { Button, Card } from '@heroui/react';
import { useSpotify, useMix, useSpotifyConnect } from '../spotify/spotifyContext';
import { resolveTrackData } from '../utils/helpers';
import PlaylistModal from './PlaylistModal';

export default function LibraryPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { getUserPlaylists, searchSpotify } = useSpotify();
    const { handleAddTrack } = useMix();
    const { isSpotifyConnected, connectSpotify, disconnectSpotify, isConnecting } = useSpotifyConnect();

    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [selectedPlaylist, setSelectedPlaylist] = useState(null);
    const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState(null);

    useEffect(() => {
        let mounted = true;
        if (!searchQuery.trim()) { setSearchResults([]); setSearchError(null); return; }

        const debounce = setTimeout(async () => {
            try {
                if (mounted) { setSearchLoading(true); setSearchError(null); }
                const data = await searchSpotify(searchQuery, ['track'], 10);
                if (mounted && data?.tracks?.items) setSearchResults(data.tracks.items);
            } catch (err) {
                if (mounted) setSearchError(err.message || 'Failed to search Spotify');
            } finally {
                if (mounted) setSearchLoading(false);
            }
        }, 500);

        return () => { mounted = false; clearTimeout(debounce); };
    }, [searchQuery, searchSpotify]);

    const handleSelectTrack = (track) => {
        handleAddTrack(resolveTrackData(track));
        setSearchQuery('');
        setSearchResults([]);
    };

    useEffect(() => {
        let mounted = true;
        if (!isSpotifyConnected) { setLoading(false); return; }

        const fetchPlaylists = async () => {
            try {
                setLoading(true);
                setError(null);
                const data = await getUserPlaylists(20, 0);
                if (mounted && data?.items) setPlaylists(data.items);
            } catch (err) {
                if (mounted) setError(err.message || 'Failed to load playlists');
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchPlaylists();
        return () => { mounted = false; };
    }, [getUserPlaylists, isSpotifyConnected]);

    const openPlaylistModal = (playlist) => {
        setSelectedPlaylist(playlist);
        setIsPlaylistModalOpen(true);
    };

    return (
        <aside className={`${isCollapsed ? 'w-16' : 'w-64'} bg-base-900 border-r border-base-700 flex flex-col shrink-0 transition-all duration-300 relative overflow-hidden`}>
            {isCollapsed ? (
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button onClick={() => setIsCollapsed(false)} title="Expand Library" className="p-1.5 rounded hover:bg-base-800 transition-colors">
                        <Library className="text-base-300 hover:text-base-50 transition-colors" size={24} />
                    </button>
                </div>
            ) : (
                <div className="p-4 flex flex-col h-full w-64 shrink-0 transition-opacity duration-300 text-left">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-sm font-bold text-base-50 px-1 flex items-center gap-2">
                            <Library size={16} className="text-base-450" />
                            Library
                        </h2>
                        <button onClick={() => setIsCollapsed(true)} className="text-base-300 hover:text-base-50 p-1.5 rounded hover:bg-base-800 transition-colors shrink-0" title="Collapse Library">
                            <ChevronLeft size={16} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar flex flex-col">
                        <div className="flex flex-col mb-4">
                            <div className="flex items-center justify-center gap-2 mb-2 px-1">
                                <div className="flex-1 h-px bg-white/40" />
                                <span className="text-[10px] uppercase tracking-widest text-base-450 font-bold text-center whitespace-nowrap">YOUR FILES</span>
                                <div className="flex-1 h-px bg-white/40" />
                            </div>
                            <Button radius="full" fullWidth variant="solid" className="mb-2 p-0 h-10 font-bold text-white bg-base-450 hover:bg-base-450/80">
                                <div className="flex flex-row items-center justify-center gap-2 w-full h-full">
                                    <Upload size={16} className="text-white shrink-0" />
                                    <span>Upload MP3</span>
                                </div>
                            </Button>
                            <div className="text-[11px] text-base-300 leading-snug text-center mt-2 px-2">No files yet. Upload an MP3 to get started.</div>
                        </div>

                        <div className="flex items-center justify-center gap-2 my-2 mt-1 mb-5 px-1">
                            <div className="flex-1 h-px bg-white/40" />
                            <span className="text-[10px] uppercase tracking-widest text-base-450 font-bold text-center whitespace-nowrap">SPOTIFY CATALOG</span>
                            <div className="flex-1 h-px bg-white/40" />
                        </div>

                        <div className="flex flex-col">
                            {!isSpotifyConnected ? (
                                <div className="flex flex-col mt-1">
                                    {isConnecting ? (
                                        <div className="flex justify-center items-center h-10 mb-2">
                                            <div className="w-6 h-6 border-2 border-white/20 border-t-base-450 rounded-full animate-spin"></div>
                                        </div>
                                    ) : (
                                        <Button onPress={connectSpotify} radius="full" fullWidth variant="solid" className="mb-2 p-0 h-10 font-bold text-white bg-base-450 hover:bg-base-450/80">
                                            <div className="flex flex-row items-center justify-center gap-2 w-full h-full">
                                                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.48.659.24 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.84.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.239.54-.959.72-1.559.3z" />
                                                </svg>
                                                <span>Connect Spotify</span>
                                            </div>
                                        </Button>
                                    )}
                                    <p className="text-[11px] text-base-300 text-center px-1 leading-relaxed">
                                        Browse your Spotify playlists for inspiration. Tracks with a preview available (30s max) can be added directly to your mix!
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <Card className="bg-base-900/50 border border-base-400 p-2 mb-3 shadow-none text-left rounded-md">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle size={14} className="text-base-400 shrink-0 mt-0.5" />
                                            <p className="text-[11px] text-base-300 leading-snug">
                                                Spotify Premium required for in-app playback. Tracks marked <Play size={10} className="inline text-base-450 fill-current mx-0.5" /> have a 30s preview available.
                                            </p>
                                        </div>
                                    </Card>

                                    <div className="mb-3 flex items-center bg-base-900 rounded border border-base-450 text-base-450 overflow-hidden relative">
                                        <div className="pl-3"><Search size={14} className="shrink-0" /></div>
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search Library..."
                                            className="w-full bg-transparent px-2 py-2 text-[13px] font-medium text-white placeholder:text-white/70 border-none outline-none shadow-none focus:ring-0"
                                        />
                                        {searchQuery && (
                                            <button onClick={() => setSearchQuery('')} className="pr-3 text-base-450 hover:text-base-200 transition-colors">
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex flex-col space-y-1.5">
                                        {searchQuery.trim() ? (
                                            searchLoading ? (
                                                <div className="flex flex-col items-center justify-center p-4 text-base-500 gap-2">
                                                    <Loader2 size={24} className="animate-spin" />
                                                    <span className="text-[11px] font-medium">Searching...</span>
                                                </div>
                                            ) : searchError ? (
                                                <div className="p-3 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-400 flex flex-col gap-2">
                                                    <span className="flex items-center gap-1 font-semibold"><AlertCircle size={14} /> Search Failed</span>
                                                    <span>{searchError}</span>
                                                </div>
                                            ) : searchResults.length > 0 ? (
                                                <div className="flex flex-col gap-1">
                                                    {searchResults.map((track) => (
                                                        <div
                                                            key={track.id}
                                                            onClick={() => handleSelectTrack(track)}
                                                            className="flex items-center gap-2 p-1.5 rounded hover:bg-base-800 cursor-pointer transition-colors group border border-transparent hover:border-base-700"
                                                        >
                                                            {track.album?.images?.[0] ? (
                                                                <img src={track.album.images[0].url} alt={track.name} className="w-8 h-8 rounded object-cover border border-base-800 group-hover:border-base-600 shrink-0" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded bg-base-800 flex items-center justify-center text-base-600 shrink-0">
                                                                    <Music size={12} />
                                                                </div>
                                                            )}
                                                            <div className="flex flex-col flex-1 min-w-0 text-left overflow-hidden">
                                                                <div className="text-[13px] font-medium text-base-200 group-hover:text-base-50 truncate transition-colors">{track.name}</div>
                                                                <div className="text-[10px] text-base-400 truncate">{track.artists?.map(a => a.name).join(', ')}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-[11px] text-base-400 text-center mt-2 p-4 border border-base-700 border-dashed rounded flex flex-col items-center gap-2">
                                                    <Search size={16} className="opacity-50" />
                                                    <span>No tracks found for "{searchQuery}"</span>
                                                </div>
                                            )
                                        ) : (
                                            loading ? (
                                                Array.from({ length: 5 }).map((_, i) => (
                                                    <div key={i} className="h-12 bg-base-800 rounded animate-pulse opacity-50"></div>
                                                ))
                                            ) : error ? (
                                                <div className="p-3 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-400 flex flex-col gap-2">
                                                    <span className="flex items-center gap-1 font-semibold"><AlertCircle size={14} /> Error Loading</span>
                                                    <span>{error}</span>
                                                </div>
                                            ) : playlists.length === 0 ? (
                                                <div className="text-xs text-base-400 text-center mt-2">No playlists found.</div>
                                            ) : (
                                                playlists.map((playlist) => (
                                                    <div key={playlist.id} className="flex flex-col border border-transparent hover:border-base-800 rounded group">
                                                        <div className="flex items-center gap-2 p-1.5 rounded hover:bg-base-800 cursor-pointer transition-colors" onClick={() => openPlaylistModal(playlist)}>
                                                            <div className="text-base-450 shrink-0"><ChevronRight size={14} /></div>
                                                            {playlist.images?.length > 0 ? (
                                                                <img src={playlist.images[0].url} alt={playlist.name} className="w-8 h-8 rounded shrink-0 object-cover border border-base-700" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded bg-base-800 border border-base-700 shrink-0 flex items-center justify-center">
                                                                    <Library size={12} className="text-base-400" />
                                                                </div>
                                                            )}
                                                            <div className="flex flex-col overflow-hidden text-left">
                                                                <span className="text-[13px] font-medium text-base-200 group-hover:text-base-50 truncate transition-colors">{playlist.name}</span>
                                                                <span className="text-[10px] text-base-400 truncate">
                                                                    {playlist.owner?.display_name ? `By ${playlist.owner.display_name}` : 'Spotify'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            )
                                        )}
                                    </div>

                                    <Button onPress={disconnectSpotify} radius="full" fullWidth variant="solid" className="mt-4 mb-2 p-0 h-10 font-bold text-white bg-base-450 hover:bg-base-450/80">
                                        <div className="flex flex-row items-center justify-center gap-2 w-full h-full">
                                            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.48.659.24 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.84.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.239.54-.959.72-1.559.3z" />
                                            </svg>
                                            <span>Disconnect Spotify</span>
                                        </div>
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <PlaylistModal
                isOpen={isPlaylistModalOpen}
                onClose={() => setIsPlaylistModalOpen(false)}
                playlist={selectedPlaylist}
            />
        </aside>
    );
}
