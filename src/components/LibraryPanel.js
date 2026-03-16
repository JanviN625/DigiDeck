import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, Library, AlertCircle, ChevronRight, Upload, Search, Loader2, Music, X, Trash2 } from 'lucide-react';
import { Button } from '@heroui/react';
import { useSpotify, useMix, useSpotifyConnect } from '../spotify/appContext';
import { readId3Tags, spotifyConfirmMatch } from '../utils/helpers';
import PlaylistModal from './PlaylistModal';
import { auth, db, storage } from '../firebase/firebaseConfig';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';

const SpotifyIcon = () => (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.48.659.24 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.84.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.239.54-.959.72-1.559.3z" />
    </svg>
);

export default function LibraryPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { getUserPlaylists, searchSpotify } = useSpotify();
    const { handleAddTrack, tracks, handleUpdateTrack } = useMix();
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

    const fileInputRef = useRef(null);
    const [uploadingFiles, setUploadingFiles] = useState(false);
    const [userUploads, setUserUploads] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
        });
        return () => unsubscribe();
    }, []);

    // Keep a live ref of tracks so the Spotify enrichment effect can read the
    // current workspace without declaring tracks as a dependency (which would
    // cause it to re-run after every update it triggers, creating a loop).
    const tracksRef = useRef(tracks);
    useEffect(() => { tracksRef.current = tracks; }, [tracks]);

    // When Spotify connects (including mid-session), re-enrich every local track
    // that is missing artist or artwork — no need to remove and re-add tracks.
    const enrichLocalTracks = useCallback(async () => {
        const localTracks = tracksRef.current.filter(
            t => t.isLocal && t.title && (!t.albumArt || !t.artistName || t.artistName === 'Local File')
        );
        if (!localTracks.length) return;

        for (const track of localTracks) {
            try {
                const query = track.artistName && track.artistName !== 'Local File'
                    ? `${track.title} ${track.artistName}`
                    : track.title;
                const results = await searchSpotify(query, ['track'], 5);
                const match = spotifyConfirmMatch(track.title, results?.tracks?.items);
                if (match) {
                    const updates = {};
                    const spotifyArtist = match.artists?.map(a => a.name).join(', ');
                    const spotifyArt = match.album?.images?.[0]?.url;
                    if (spotifyArtist) updates.artistName = spotifyArtist;
                    if (spotifyArt) updates.albumArt = spotifyArt;
                    if (Object.keys(updates).length) handleUpdateTrack(track.id, updates);
                }
            } catch {
                // best-effort; a failed search for one track should not block others
            }
        }
    }, [searchSpotify, handleUpdateTrack]);

    useEffect(() => {
        if (isSpotifyConnected) enrichLocalTracks();
    }, [isSpotifyConnected, enrichLocalTracks]);

    useEffect(() => {
        if (!currentUser) {
            setUserUploads([]);
            return;
        }

        const q = query(
            collection(db, `users/${currentUser.uid}/uploads`),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const tracks = [];
            snapshot.forEach((doc) => {
                tracks.push({ id: doc.id, ...doc.data() });
            });
            setUserUploads(tracks);
        }, (error) => {
            // Expected on logout
        });

        return () => unsubscribe();
    }, [currentUser]);

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;

        setUploadingFiles(true);
        try {
            const timestamp = Date.now();

            // 1. Read ID3 tags before uploading — best-effort, never blocks the upload
            const { title: id3Title, artist: id3Artist, albumArtBlob } = await readId3Tags(file);

            // 2. Upload audio
            const storagePath = `uploads/${currentUser.uid}/${timestamp}_${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);

            // 3. Upload embedded cover art if present
            let albumArt = null;
            if (albumArtBlob) {
                const coverRef = ref(storage, `uploads/${currentUser.uid}/${timestamp}_cover`);
                await uploadBytes(coverRef, albumArtBlob, { contentType: albumArtBlob.type });
                albumArt = await getDownloadURL(coverRef);
            }

            // 4. Save enriched metadata to Firestore
            await addDoc(collection(db, `users/${currentUser.uid}/uploads`), {
                title: id3Title || file.name.replace(/\.[^/.]+$/, ""),
                artistName: id3Artist || null,
                albumArt: albumArt,
                fileName: file.name,
                storagePath,
                downloadUrl,
                createdAt: timestamp
            });

        } catch (err) {
            console.error("Upload failed", err);
        } finally {
            setUploadingFiles(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteUpload = async (e, upload) => {
        e.stopPropagation();
        if (!currentUser) return;
        
        try {
            // Delete from storage
            const storageRef = ref(storage, upload.storagePath);
            await deleteObject(storageRef);
            // Delete from firestore
            await deleteDoc(doc(db, `users/${currentUser.uid}/uploads`, upload.id));
        } catch (err) {
            console.error("Failed to delete track", err);
        }
    };

    const handleInsertUpload = async (upload) => {
        let artistName = upload.artistName || 'Local File';
        let albumArt = upload.albumArt || null;

        // Spotify enrichment — if connected, search for a matching track to get
        // higher-quality artist name and album art. Falls through silently on failure.
        if (isSpotifyConnected && upload.title) {
            try {
                const query = artistName !== 'Local File'
                    ? `${upload.title} ${artistName}`
                    : upload.title;
                const results = await searchSpotify(query, ['track'], 5);
                const match = spotifyConfirmMatch(upload.title, results?.tracks?.items);
                if (match) {
                    artistName = match.artists?.map(a => a.name).join(', ') || artistName;
                    albumArt = match.album?.images?.[0]?.url || albumArt;
                }
            } catch {
                // best-effort; ID3 data is the fallback
            }
        }

        handleAddTrack({
            title: upload.title,
            artistName,
            albumArt,
            spotifyId: 'local-' + upload.id,
            audioUrl: upload.downloadUrl,
            isLocal: true,
            bpm: '[BPM]',
            trackKey: '[key]'
        });
    };

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
                        <div className="w-7 shrink-0" />
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
                            <input 
                                type="file" 
                                accept="audio/*" 
                                ref={fileInputRef} 
                                style={{ display: 'none' }} 
                                onChange={handleFileUpload} 
                            />
                            <Button onPress={() => !uploadingFiles && fileInputRef.current?.click()} disabled={!currentUser} radius="full" fullWidth variant="solid" className="mb-2 p-0 h-10 font-bold text-white bg-base-450 hover:bg-base-450/80">
                                {uploadingFiles ? (
                                    <div className="flex flex-row items-center justify-center gap-2 w-full h-full">
                                        <Loader2 size={16} className="text-white shrink-0 animate-spin" />
                                        <span>Uploading...</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-row items-center justify-center gap-2 w-full h-full">
                                        <Upload size={16} className="text-white shrink-0" />
                                        <span>Upload MP3</span>
                                    </div>
                                )}
                            </Button>
                            
                            {!currentUser ? (
                                <div className="text-[11px] text-base-300 leading-snug text-center mt-2 px-2">Sign in to upload custom tracks.</div>
                            ) : userUploads.length === 0 ? (
                                <div className="text-[11px] text-base-300 leading-snug text-center mt-2 px-2">No files yet. Upload an MP3 to get started.</div>
                            ) : (
                                <div className="flex flex-col gap-1 mt-2">
                                    {userUploads.map((upload) => (
                                        <div
                                            key={upload.id}
                                            onClick={() => handleInsertUpload(upload)}
                                            className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-base-800 cursor-pointer transition-colors group border border-transparent hover:border-base-700"
                                            title="Add to Workspace"
                                        >
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <div className="w-8 h-8 rounded bg-base-800 flex items-center justify-center text-base-600 shrink-0">
                                                    <Music size={12} />
                                                </div>
                                                <div className="flex flex-col flex-1 min-w-0 text-left overflow-hidden">
                                                    <div className="text-[13px] font-medium text-base-200 group-hover:text-base-50 truncate transition-colors">{upload.title}</div>
                                                    <div className="text-[10px] text-base-400 truncate">{upload.artistName || 'Local File'}</div>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={(e) => handleDeleteUpload(e, upload)}
                                                className="p-1.5 text-base-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded hover:bg-base-700"
                                                title="Delete file"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
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
                                                <SpotifyIcon />
                                                <span>Connect Spotify</span>
                                            </div>
                                        </Button>
                                    )}
                                    <p className="text-[11px] text-base-300 text-center px-1 leading-relaxed">
                                        Browse your Spotify playlists and catalog for inspiration. Upload tracks as MP3s to add them to your mix.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col">
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
                                                            className="flex items-center gap-2 p-1.5 rounded border border-transparent"
                                                        >
                                                            {track.album?.images?.[0] ? (
                                                                <img src={track.album.images[0].url} alt={track.name} className="w-8 h-8 rounded object-cover border border-base-800 shrink-0" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded bg-base-800 flex items-center justify-center text-base-600 shrink-0">
                                                                    <Music size={12} />
                                                                </div>
                                                            )}
                                                            <div className="flex flex-col flex-1 min-w-0 text-left overflow-hidden">
                                                                <div className="text-[13px] font-medium text-base-200 truncate">{track.name}</div>
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
                                            <SpotifyIcon />
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
