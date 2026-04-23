import React, { useState, useEffect, useCallback } from 'react';
import { Pencil, Play, Pause, Square, ZoomIn, Activity, FolderOpen, Save, Trash2, Plus } from 'lucide-react';
import FirebaseService from '../firebase/FirebaseService';
import { Avatar, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection, Spinner, Slider } from '@heroui/react';
import { getDynamicInputWidth } from '../utils/helpers';
import { useFirebaseAuth } from '../firebase/firebase';
import { useMix } from '../spotify/appContext';
import AudioEngineService, { audioBufferToWAV } from '../audio/AudioEngine';
import { AccountModal, SettingsModal } from './ProfileModal';
import { useSettings, matchesKeybind } from '../utils/useSettings';

// Returns a human-readable relative time string from a Firestore Timestamp or Date.
function formatRelativeTime(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
}

const SLOT_IDS = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5'];

export default function Header() {
    const { user, signOut } = useFirebaseAuth();
    const {
        tracks, universalIsPlaying, setUniversalIsPlaying, triggerMasterStop,
        globalZoom, setGlobalZoom, masterBpm, setMasterBpm,
        handleUpdateTrack, handleClearAllTracks, handleOverwriteWorkspace,
        handleUndo, handleRedo,
        isLibraryCollapsed, setIsLibraryCollapsed, isAICollapsed, setIsAICollapsed,
        setActiveSlotId, chats, activeChatId,
        masterTimeRef, masterDuration,
    } = useMix();

    const handleSyncAllTracks = useCallback(() => {
        tracks.forEach(track => {
            const trackBpm = parseFloat(track.bpm);
            if (!track.bpm || track.bpm === '[BPM]' || isNaN(trackBpm) || trackBpm <= 0) return;
            const targetSpeed = Math.min(4.0, Math.max(0.25, masterBpm / trackBpm));
            const syncedSegments = (track.initialSegments || []).map(seg => ({
                ...seg,
                speed: targetSpeed,
            }));
            handleUpdateTrack(track.id, { initialSegments: syncedSegments, initialSpeed: targetSpeed });
        });
    }, [tracks, masterBpm, handleUpdateTrack]);

    const { settings } = useSettings();
    const [projectName, setProjectName] = useState('Untitled project');
    const [isEditingProject, setIsEditingProject] = useState(false);
    const [renderingFor, setRenderingFor] = useState(null); // null | 'export'
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [saveAlert, setSaveAlert] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    // ── Project Slots Modal ──────────────────────────────────────────────────
    // modalMode: null | 'save' | 'load'
    const [modalMode, setModalMode] = useState(null);
    const [projectSlots, setProjectSlots] = useState([null, null, null, null, null]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [slotError, setSlotError] = useState(null);
    // Which slot is awaiting overwrite confirmation (slotId string or null)
    const [pendingOverwriteSlot, setPendingOverwriteSlot] = useState(null);
    const [isSavingSlot, setIsSavingSlot] = useState(false);

    const fetchSlots = useCallback(async () => {
        if (!user?.uid) return;
        setLoadingSlots(true);
        setSlotError(null);
        try {
            const slots = await FirebaseService.getProjectSlots(user.uid);
            setProjectSlots(slots);
        } catch (err) {
            console.error('Failed to fetch project slots:', err);
            setSlotError('Failed to load projects.');
        } finally {
            setLoadingSlots(false);
        }
    }, [user]);

    const handleOpenSave = useCallback(async () => {
        if (!user?.uid) return;
        setPendingOverwriteSlot(null);
        setModalMode('save');
        await fetchSlots();
    }, [user, fetchSlots]);

    const handleOpenLoad = useCallback(async () => {
        if (!user?.uid) return;
        setPendingOverwriteSlot(null);
        setModalMode('load');
        await fetchSlots();
    }, [user, fetchSlots]);

    const closeModal = useCallback(() => {
        setModalMode(null);
        setPendingOverwriteSlot(null);
    }, []);

    const handleConfirmSave = useCallback(async (slotId, existingProject) => {
        if (!user?.uid || isSavingSlot) return;
        setIsSavingSlot(true);
        try {
            await FirebaseService.saveProjectSlot(
                user.uid,
                slotId,
                {
                    projectName,
                    tracks,
                    masterBpm,
                    globalZoom,
                    libraryCollapsed: isLibraryCollapsed,
                    aiCollapsed: isAICollapsed,
                    chats,
                    activeChatId,
                },
                !existingProject // isNewSlot
            );
            setActiveSlotId(slotId);
            setSaveAlert(true);
            setTimeout(() => setSaveAlert(false), 2000);
            closeModal();
        } catch (err) {
            console.error('Project save failed:', err);
            setSaveError(true);
            setTimeout(() => setSaveError(false), 3000);
        } finally {
            setIsSavingSlot(false);
        }
    }, [user, projectName, tracks, masterBpm, globalZoom, isLibraryCollapsed, isAICollapsed, chats, activeChatId, isSavingSlot, setActiveSlotId, closeModal]);

    const handleLoadFromSlot = useCallback(async (slotId) => {
        if (!user?.uid) return;
        try {
            const slotIndex = SLOT_IDS.indexOf(slotId);
            const project = projectSlots[slotIndex];
            if (!project) return;
            handleOverwriteWorkspace({
                tracks: project.tracks ?? [],
                masterBpm: project.masterBpm,
                globalZoom: project.globalZoom,
                chats: project.chats ?? [],
                activeChatId: project.activeChatId ?? null,
            });
            if (typeof project.libraryCollapsed === 'boolean') setIsLibraryCollapsed(project.libraryCollapsed);
            if (typeof project.aiCollapsed === 'boolean') setIsAICollapsed(project.aiCollapsed);
            setProjectName(project.projectName ?? 'Untitled project');
            setActiveSlotId(slotId);
            closeModal();
        } catch (err) {
            console.error('Failed to load project:', err);
            setSlotError('Failed to load project.');
        }
    }, [user, projectSlots, handleOverwriteWorkspace, setIsLibraryCollapsed, setIsAICollapsed, setActiveSlotId, closeModal]);

    const handleDeleteSlot = useCallback(async (e, slotId) => {
        e.stopPropagation();
        if (!user?.uid) return;
        // If this slot was pending overwrite, cancel that
        if (pendingOverwriteSlot === slotId) setPendingOverwriteSlot(null);
        try {
            await FirebaseService.deleteProjectSlot(user.uid, slotId);
            setProjectSlots(prev => prev.map((s, i) => SLOT_IDS[i] === slotId ? null : s));
        } catch (err) {
            console.error('Failed to delete project slot:', err);
        }
    }, [user, pendingOverwriteSlot]);

    // ── Keybinds ─────────────────────────────────────────────────────────────

    const togglePlay = useCallback(() => {
        setUniversalIsPlaying(v => {
            if (!v && masterTimeRef.current >= masterDuration && masterDuration > 0) {
                masterTimeRef.current = 0;
            }
            return !v;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setUniversalIsPlaying, masterDuration]);

    useEffect(() => {
        const handleKeydown = (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            if (matchesKeybind(e, settings.keybinds.playPause)) {
                e.preventDefault();
                togglePlay();
            }
            if (matchesKeybind(e, settings.keybinds.saveProject)) {
                e.preventDefault();
                handleOpenSave();
            }
            if (matchesKeybind(e, settings.keybinds.undo)) {
                e.preventDefault();
                handleUndo();
            }
            if (matchesKeybind(e, settings.keybinds.redo)) {
                e.preventDefault();
                handleRedo();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [settings.keybinds, togglePlay, handleOpenSave, handleUndo, handleRedo]);

    const handleExport = useCallback(async () => {
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
    }, [renderingFor, projectName]);

    // Keybinds for load/export — must be after their handler declarations to avoid TDZ
    useEffect(() => {
        const handleKeydown = (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            if (matchesKeybind(e, settings.keybinds.loadProject)) {
                e.preventDefault();
                handleOpenLoad();
            }
            if (matchesKeybind(e, settings.keybinds.exportProject)) {
                e.preventDefault();
                handleExport();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [settings.keybinds, handleOpenLoad, handleExport]);

    // ── Profile helpers ───────────────────────────────────────────────────────

    const displayName = user?.displayName || user?.email || 'User';
    const avatarSrc = user?.photoURL || null;

    const CustomInitials = (nameStr) => {
        if (!nameStr) return '?';
        const isEmail = nameStr.includes('@');
        if (isEmail) {
            const username = nameStr.split('@')[0];
            if (username.length === 1) return username[0].toUpperCase();
            return (username[0] + username[username.length - 1]).toUpperCase();
        }
        const parts = nameStr.trim().split(/\s+/);
        if (parts.length === 1) {
            if (parts[0].length === 1) return parts[0].toUpperCase();
            return (parts[0][0] + parts[0][parts[0].length - 1]).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <>
        <header className="h-16 bg-base-800 border-b border-base-700 flex items-center justify-between px-6 shrink-0 relative">

            {/* Left — logo + project name */}
            <div className="flex items-center gap-4 flex-1">
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

            {/* Center — transport */}
            {tracks.length > 0 && (
                <div className="flex justify-center min-w-0 pointer-events-none">
                    <div className="flex items-center gap-1 bg-base-900/60 border border-base-700 rounded-lg px-2 py-1.5 pointer-events-auto">
                    <button
                        onClick={togglePlay}
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
                    <span className={`text-[10px] font-bold tracking-widest uppercase mr-3 transition-colors ${
                        universalIsPlaying ? 'text-base-450' : 'text-base-500'
                    }`}>
                        {universalIsPlaying ? 'Live' : 'Idle'}
                    </span>
                    <div className="w-px h-4 bg-base-700 mx-1" />
                    <div className="flex items-center gap-1.5 px-2 group">
                        <Activity size={12} className="text-base-500 group-hover:text-base-300 transition-colors" />
                        <input
                            type="number"
                            min="20"
                            max="300"
                            value={masterBpm}
                            onChange={(e) => setMasterBpm(Number(e.target.value))}
                            className="bg-transparent border border-transparent hover:border-base-700 focus:border-base-500 text-xs font-mono text-base-100 rounded px-1 w-12 outline-none text-center transition-colors appearance-none scrollbar-hide"
                            title="Master BPM"
                            style={{ MozAppearance: 'textfield' }}
                        />
                        <style>{`
                            input[type="number"]::-webkit-inner-spin-button,
                            input[type="number"]::-webkit-outer-spin-button {
                                -webkit-appearance: none;
                                margin: 0;
                            }
                        `}</style>
                    </div>
                    <div className="w-px h-4 bg-base-700 mx-1" />
                    <button
                        onClick={handleSyncAllTracks}
                        disabled={tracks.length === 0}
                        className="text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded border border-base-700 text-base-400 hover:text-base-100 hover:border-base-500 disabled:opacity-30 active:scale-95 transition-colors"
                        title="Sync all tracks to Master BPM"
                    >
                        Sync All
                    </button>
                    <div className="w-px h-4 bg-base-700 mx-1" />
                    <div className="flex items-center gap-2 group w-44 px-1">
                        <ZoomIn size={12} className="text-base-500 group-hover:text-base-300 transition-colors shrink-0" />
                        <div className="flex flex-col gap-0 flex-1">
                            <Slider
                                aria-label="Global Zoom"
                                size="sm"
                                step={10}
                                maxValue={400}
                                minValue={0}
                                value={globalZoom}
                                onChange={setGlobalZoom}
                                className="w-full"
                                classNames={{
                                    track: "bg-base-700/50 border-y border-base-900",
                                    filler: "bg-base-500 group-hover:bg-base-400 transition-colors",
                                    thumb: "w-3 h-3 bg-base-300 hover:bg-base-200 transition-colors shadow-md rounded-full cursor-grab active:cursor-grabbing"
                                }}
                            />
                            <div className="flex justify-between px-px mt-0.5">
                                {[1,2,3,4,5].map(n => (
                                    <span key={n} className="text-[7px] font-mono text-base-600">{n}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
            )}

            {/* Right — actions + avatar */}
            <div className="flex items-center gap-3 flex-1 justify-end">
                <div className="flex items-center gap-0.5">
                    <button onClick={handleOpenSave} className="relative text-sm text-base-400 hover:text-base-100 hover:bg-base-700/60 px-3 py-1.5 rounded-md transition-colors w-16 text-center select-none group">
                        <span className={`block transition-opacity duration-200 ${saveAlert || saveError ? 'opacity-0' : 'opacity-100'}`}>Save</span>
                        <span className={`block text-positive-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 whitespace-nowrap ${saveAlert ? 'opacity-100' : 'opacity-0'}`}>Saved!</span>
                        <span className={`block text-danger-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 whitespace-nowrap ${saveError ? 'opacity-100' : 'opacity-0'}`}>Failed</span>
                    </button>
                    <button onClick={handleOpenLoad} className="text-sm text-base-400 hover:text-base-100 hover:bg-base-700/60 px-3 py-1.5 rounded-md transition-colors">Load</button>
                    {showResetConfirm ? (
                        <div className="flex items-center gap-2 animate-in fade-in duration-150 bg-base-800 border border-base-700 rounded-md h-8 px-2">
                            <span className="text-xs text-base-300 mt-px">Reset workspace?</span>
                            <div className="flex items-center gap-0.5">
                                <button
                                    onClick={() => { handleClearAllTracks(); setShowResetConfirm(false); }}
                                    className="text-xs font-medium text-danger-400 hover:text-danger-200 hover:bg-danger-900/30 px-2 py-1 rounded transition-colors"
                                >
                                    Yes
                                </button>
                                <button
                                    onClick={() => setShowResetConfirm(false)}
                                    className="text-xs font-medium text-base-400 hover:text-base-200 hover:bg-base-700/50 px-2 py-1 rounded transition-colors"
                                >
                                    No
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="text-sm text-danger-400 hover:text-danger-200 hover:bg-danger-900/30 px-3 py-1.5 rounded-md transition-colors"
                            title="Remove all tracks and start fresh"
                        >
                            Reset
                        </button>
                    )}
                </div>

                <div className="w-px h-5 bg-base-700" />

                <button
                    onClick={handleExport}
                    disabled={!!renderingFor}
                    className="text-sm font-semibold text-base-50 bg-base-500 hover:bg-base-400 border border-base-400/50 px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {renderingFor === 'export' && (
                        <Spinner size="sm" classNames={{ circle1: 'border-b-base-300', circle2: 'border-b-base-300' }} />
                    )}
                    {renderingFor === 'export' ? 'Exporting…' : 'Export'}
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

                        <DropdownItem key="account" textValue="Account Info" onPress={() => setIsAccountModalOpen(true)} className="hover:bg-base-700 hover:text-base-50 text-sm py-2">
                            Account info
                        </DropdownItem>

                        <DropdownItem key="settings" textValue="Settings" onPress={() => setIsSettingsModalOpen(true)} className="hover:bg-base-700 hover:text-base-50 text-sm py-2">
                            Settings
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

        <AccountModal  isOpen={isAccountModalOpen}  onClose={() => setIsAccountModalOpen(false)} />
        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />

        {/* ── Project Slots Modal (shared for Save and Load) ── */}
        {modalMode && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                onClick={closeModal}
            >
                <div
                    className="bg-base-900 border border-base-700 rounded-2xl w-[480px] flex flex-col shadow-2xl"
                    style={{ maxHeight: '80vh' }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-base-700 shrink-0">
                        <h3 className="text-sm font-bold text-base-200 flex items-center gap-2">
                            {modalMode === 'save'
                                ? <><Save size={15} className="text-base-500" /> Save Project</>
                                : <><FolderOpen size={15} className="text-base-500" /> Load Project</>
                            }
                        </h3>
                        <button onClick={closeModal} className="text-base-500 hover:text-base-200 p-1 rounded hover:bg-base-800 transition-colors">
                            ✕
                        </button>
                    </div>

                    {/* Subtitle */}
                    <p className="text-xs text-base-500 px-5 pt-3 pb-1 shrink-0">
                        {modalMode === 'save'
                            ? `Saving "${projectName}" — choose a slot to save or overwrite.`
                            : 'Select a saved project to load into the workspace.'
                        }
                    </p>

                    {/* Slot list */}
                    <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2 space-y-2 custom-scrollbar">
                        {loadingSlots ? (
                            <p className="text-sm text-base-500 text-center py-10">Loading…</p>
                        ) : slotError ? (
                            <p className="text-sm text-danger-400 text-center py-10">{slotError}</p>
                        ) : (
                            SLOT_IDS.map((slotId, index) => {
                                const project = projectSlots[index];
                                const isOccupied = !!project;
                                const isPendingOverwrite = pendingOverwriteSlot === slotId;
                                const isClickable = modalMode === 'save' || isOccupied;

                                return (
                                    <div
                                        key={slotId}
                                        className={`w-full rounded-xl border transition-colors ${
                                            isClickable
                                                ? isOccupied
                                                    ? 'bg-base-800 border-base-700 hover:border-base-500 cursor-pointer'
                                                    : 'bg-base-900 border-base-700 border-dashed hover:border-base-500 cursor-pointer'
                                                : 'bg-base-900 border-base-800 opacity-40 cursor-not-allowed'
                                        }`}
                                        onClick={() => {
                                            if (!isClickable) return;
                                            if (modalMode === 'save') {
                                                if (project) {
                                                    setPendingOverwriteSlot(slotId);
                                                } else {
                                                    handleConfirmSave(slotId, null);
                                                }
                                            } else {
                                                handleLoadFromSlot(slotId);
                                            }
                                        }}
                                    >
                                        {/* Main row */}
                                        <div className="flex items-center gap-3 px-4 py-3">
                                            {/* Slot number badge */}
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                                isOccupied ? 'bg-base-700 text-base-300' : 'bg-base-800 text-base-600'
                                            }`}>
                                                {index + 1}
                                            </div>

                                            {/* Project info */}
                                            <div className="flex-1 min-w-0">
                                                {isOccupied ? (
                                                    <>
                                                        <p className="text-sm font-semibold text-base-100 truncate">{project.projectName ?? 'Untitled project'}</p>
                                                        <p className="text-xs text-base-500 mt-0.5">
                                                            {project.tracks?.length ?? 0} track{project.tracks?.length !== 1 ? 's' : ''}
                                                            {project.updatedAt && <span className="ml-2 text-base-600">· {formatRelativeTime(project.updatedAt)}</span>}
                                                        </p>
                                                    </>
                                                ) : (
                                                    <p className="text-sm text-base-600 flex items-center gap-1.5">
                                                        {modalMode === 'save' && <Plus size={12} />}
                                                        {modalMode === 'save' ? 'Empty slot' : 'No project'}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Delete button (occupied slots only) */}
                                            {isOccupied && (
                                                <button
                                                    onClick={e => handleDeleteSlot(e, slotId)}
                                                    title="Delete project"
                                                    className="ml-1 p-1.5 rounded-lg text-base-600 hover:text-danger-400 hover:bg-base-700 transition-colors shrink-0"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            )}
                                        </div>

                                        {/* Inline overwrite confirmation (save mode only) */}
                                        {isPendingOverwrite && modalMode === 'save' && (
                                            <div
                                                className="flex items-center justify-between gap-3 px-4 pb-3 pt-0"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <p className="text-xs text-caution-400 font-medium truncate">
                                                    Overwrite "{project?.projectName}"?
                                                </p>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        onClick={() => handleConfirmSave(slotId, project)}
                                                        disabled={isSavingSlot}
                                                        className="text-xs font-semibold text-positive-400 hover:text-positive-300 px-2.5 py-1 rounded-lg bg-positive-900/20 hover:bg-positive-900/40 transition-colors disabled:opacity-50"
                                                    >
                                                        {isSavingSlot ? 'Saving…' : 'Yes, overwrite'}
                                                    </button>
                                                    <button
                                                        onClick={() => setPendingOverwriteSlot(null)}
                                                        className="text-xs text-base-500 hover:text-base-300 px-2.5 py-1 rounded-lg hover:bg-base-700 transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
