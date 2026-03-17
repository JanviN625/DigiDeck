import React, { useState, useRef } from 'react';
import { Pencil, Play, Pause, Square } from 'lucide-react';
import { Avatar, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection, Spinner } from '@heroui/react';
import { getDynamicInputWidth } from '../utils/helpers';
import { useFirebaseAuth } from '../firebase/firebase';
import { useSpotifyConnect, useMix } from '../spotify/appContext';
import AudioEngineService, { audioBufferToWAV } from '../audio/AudioEngine';

export default function Header() {
    const { user, signOut } = useFirebaseAuth();
    const { isSpotifyConnected, connectSpotify, disconnectSpotify } = useSpotifyConnect();
    const { tracks, universalIsPlaying, setUniversalIsPlaying, triggerMasterStop } = useMix();
    const [projectName, setProjectName] = useState('Untitled project');
    const [isEditingProject, setIsEditingProject] = useState(false);
    const [renderingFor, setRenderingFor] = useState(null); // null | 'preview' | 'export'
    const previewSourceRef = useRef(null);

    const handleMixPreview = async () => {
        if (renderingFor) return;
        if (previewSourceRef.current) {
            try { previewSourceRef.current.stop(); } catch {}
            previewSourceRef.current = null;
        }
        setRenderingFor('preview');
        try {
            const mixBuffer = await AudioEngineService.renderOffline();
            if (!mixBuffer) return;
            const source = AudioEngineService.ctx.createBufferSource();
            source.buffer = mixBuffer;
            source.connect(AudioEngineService.masterGain);
            source.start();
            source.onended = () => { previewSourceRef.current = null; };
            previewSourceRef.current = source;
        } catch (err) {
            console.error('Mix preview failed:', err);
        } finally {
            setRenderingFor(null);
        }
    };

    const handleExport = async () => {
        if (renderingFor) return;
        setRenderingFor('export');
        try {
            const mixBuffer = await AudioEngineService.renderOffline();
            if (!mixBuffer) return;
            const wav = audioBufferToWAV(mixBuffer);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName || 'mix'}.wav`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            setRenderingFor(null);
        }
    };

    // Resolve Profile Data
    const displayName = user?.displayName || user?.email || 'User';

    // Avatar uses Firebase Auth photoURL permanently
    const avatarSrc = user?.photoURL || null;

    // Custom initials logic: First character and last character before the '@' symbol
    const CustomInitials = (nameStr) => {
        if (!nameStr) return '?';
        const isEmail = nameStr.includes('@');
        if (isEmail) {
            const username = nameStr.split('@')[0];
            if (username.length === 1) return username[0].toUpperCase();
            return (username[0] + username[username.length - 1]).toUpperCase();
        }
        // Non-email fallback (e.g. Google displayName)
        const parts = nameStr.trim().split(/\s+/);
        if (parts.length === 1) {
            if (parts[0].length === 1) return parts[0].toUpperCase();
            return (parts[0][0] + parts[0][parts[0].length - 1]).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    return (
        <header className="h-16 bg-base-800 border-b border-base-700 flex items-center justify-between px-6 shrink-0 relative">

            {/* Left — logo + project name */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 shrink-0">
                    <img src="/icon.png" alt="DigiDeck Logo" className="w-11 h-11 object-contain drop-shadow-md" />
                    <div className="font-extrabold text-sm leading-tight tracking-wider text-base-50">
                        <div>DigiDeck</div>
                        <div className="text-base-300 font-bold">Studio</div>
                    </div>
                </div>

                <div className="h-6 w-px bg-base-700 shrink-0" />

                <div className="flex items-center gap-1.5 group">
                    <input
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        disabled={!isEditingProject}
                        style={{ width: getDynamicInputWidth(projectName, 14) }}
                        className={`text-sm font-medium px-1 py-0.5 rounded outline-none transition-colors cursor-text ${isEditingProject ? 'bg-base-900 text-base-100' : 'bg-transparent text-base-400'}`}
                        onKeyDown={(e) => e.key === 'Enter' && setIsEditingProject(false)}
                    />
                    <button
                        onClick={() => setIsEditingProject(!isEditingProject)}
                        title="Rename project"
                        className={`p-1 rounded transition-colors ${isEditingProject ? 'text-base-300 bg-base-700' : 'text-base-700 opacity-0 group-hover:opacity-100 hover:text-base-300'}`}
                    >
                        <Pencil size={13} />
                    </button>
                </div>
            </div>

            {/* Center — transport (absolute so it doesn't shift left/right content) */}
            {tracks.length > 0 && (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-base-900/60 border border-base-700 rounded-lg px-2 py-1.5">
                    <button
                        onClick={() => setUniversalIsPlaying(v => !v)}
                        className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                            universalIsPlaying
                                ? 'text-base-450 bg-base-450/15'
                                : 'text-base-200 hover:text-base-50 hover:bg-base-700/60'
                        }`}
                    >
                        {universalIsPlaying ? <Pause size={14} /> : <Play size={14} className="ml-px" />}
                    </button>
                    <button
                        onClick={triggerMasterStop}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-base-200 hover:text-base-50 hover:bg-base-700/60 transition-colors"
                    >
                        <Square size={11} fill="currentColor" />
                    </button>
                    <div className="w-px h-4 bg-base-700 mx-1" />
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
                        universalIsPlaying ? 'bg-base-450 animate-pulse' : 'bg-base-500'
                    }`} />
                    <span className={`text-[10px] font-bold tracking-widest uppercase mr-1 transition-colors ${
                        universalIsPlaying ? 'text-base-450' : 'text-base-500'
                    }`}>
                        {universalIsPlaying ? 'Live' : 'Idle'}
                    </span>
                </div>
            )}

            {/* Right — actions + avatar */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-0.5">
                    <button className="text-sm text-base-400 hover:text-base-100 hover:bg-base-700/60 px-3 py-1.5 rounded-md transition-colors">Save</button>
                    <button className="text-sm text-base-400 hover:text-base-100 hover:bg-base-700/60 px-3 py-1.5 rounded-md transition-colors">Load</button>
                    <button
                        onClick={handleExport}
                        disabled={!!renderingFor}
                        className="text-sm text-base-400 hover:text-base-100 hover:bg-base-700/60 px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {renderingFor === 'export' ? 'Exporting…' : 'Export'}
                    </button>
                </div>

                <div className="w-px h-5 bg-base-700" />

                <button
                    onClick={handleMixPreview}
                    disabled={!!renderingFor}
                    className="text-sm font-semibold text-base-50 bg-base-500 hover:bg-base-400 border border-base-400/50 px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {renderingFor === 'preview' && (
                        <Spinner size="sm" classNames={{ circle1: 'border-b-base-300', circle2: 'border-b-base-300' }} />
                    )}
                    Mix Preview
                </button>

                <Dropdown
                    placement="bottom-end"
                    classNames={{
                        content: "bg-base-800 border border-base-700 rounded-lg shadow-xl text-base-200 min-w-[200px]"
                    }}
                >
                    <DropdownTrigger>
                        {avatarSrc ? (
                            <button className="bg-base-700 border-2 border-base-500 cursor-pointer rounded-full overflow-hidden w-10 h-10 flex items-center justify-center shrink-0">
                                <img src={avatarSrc} alt={displayName} className="w-full h-full object-cover" />
                            </button>
                        ) : (
                            <Avatar
                                as="button"
                                name={displayName}
                                getInitials={CustomInitials}
                                showFallback
                                classNames={{
                                    base: "bg-base-700 border-2 border-base-500 cursor-pointer",
                                    name: "text-base-50 font-bold"
                                }}
                            />
                        )}
                    </DropdownTrigger>

                    <DropdownMenu aria-label="Profile Actions" variant="flat">
                        <DropdownItem key="profile" textValue="Profile Info" className="h-14 gap-2 opacity-100 hover:bg-transparent cursor-default">
                            <p className="font-semibold truncate text-base-50">{displayName}</p>
                            <p className="text-xs text-base-400 truncate">{user?.email}</p>
                        </DropdownItem>

                        <DropdownItem key="account" textValue="Account Info" className="hover:bg-base-700 hover:text-base-50 text-sm py-2">
                            Account info
                        </DropdownItem>

                        <DropdownItem key="settings" textValue="Settings" className="hover:bg-base-700 hover:text-base-50 text-sm py-2">
                            Settings
                        </DropdownItem>

                        <DropdownItem
                            key="spotify"
                            textValue={isSpotifyConnected ? 'Disconnect Spotify' : 'Connect Spotify'}
                            onPress={isSpotifyConnected ? disconnectSpotify : connectSpotify}
                            className="hover:bg-base-700 hover:text-base-50 text-sm py-2"
                        >
                            {isSpotifyConnected ? 'Disconnect Spotify' : 'Connect Spotify'}
                        </DropdownItem>

                        <DropdownSection showDivider>
                            <DropdownItem
                                key="logout"
                                textValue="Logout"
                                className="text-base-400 hover:text-base-400 hover:bg-base-700 font-medium text-sm py-2"
                                onPress={signOut}
                            >
                                Logout
                            </DropdownItem>
                        </DropdownSection>
                    </DropdownMenu>
                </Dropdown>
            </div>
        </header>
    );
}
