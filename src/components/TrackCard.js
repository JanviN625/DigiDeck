import React, { useState } from 'react';
import { Pencil, ChevronDown, ChevronUp, Play, Pause, Volume2, VolumeX, Eye, EyeOff, Move, Copy, Trash2, RotateCcw } from 'lucide-react';
import { getDynamicInputWidth } from '../utils/helpers';

export default function TrackCard({
    initiallyExpanded = false,
    title = "Track Name Placeholder",
    onDelete,
    onDuplicate,
    onDragStart,
    onDrop,
    onDragEnd,
    isFirst,
    isLast,
    isDragged,
    initialVolume = 80,
    initialPitch = 0,
    initialSpeed = 1.0,
    initialFadeIn = "0.0s",
    initialFadeOut = "0.0s"
}) {
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [trackName, setTrackName] = useState(title);
    const [isEditing, setIsEditing] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

    // eslint-disable-next-line no-unused-vars
    const [artistName, setArtistName] = useState("[Name]");
    // eslint-disable-next-line no-unused-vars
    const [bpm, setBpm] = useState("[BPM]");
    // eslint-disable-next-line no-unused-vars
    const [trackKey, setTrackKey] = useState("[key]");

    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [volume, setVolume] = useState(initialVolume);
    const [pitch, setPitch] = useState(initialPitch);
    const [speed, setSpeed] = useState(initialSpeed);
    const [fadeIn, setFadeIn] = useState(initialFadeIn);
    const [fadeOut, setFadeOut] = useState(initialFadeOut);
    const [isEqExpanded, setIsEqExpanded] = useState(false);
    const [isEffectsExpanded, setIsEffectsExpanded] = useState(false);
    const [isDraggable, setIsDraggable] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    return (
        <div className="relative">
            {/* Visual Drop Indicators */}
            {isDragOver === 'top' && !isFirst && <div className="absolute -top-[9px] left-0 right-0 h-1 bg-base-500 rounded-full z-50 shadow-[0_0_8px_rgba(var(--tw-colors-base-500))] pointer-events-none"></div>}
            {isDragOver === 'bottom' && !isLast && <div className="absolute -bottom-[9px] left-0 right-0 h-1 bg-base-500 rounded-full z-50 shadow-[0_0_8px_rgba(var(--tw-colors-base-500))] pointer-events-none"></div>}

            <div
                draggable={isDraggable}
                onDragStart={(e) => {
                    setTimeout(() => { e.target.classList.add('opacity-50'); }, 0);
                    if (onDragStart) onDragStart(e);
                }}
                onDragEnd={(e) => {
                    e.target.classList.remove('opacity-50');
                    if (onDragEnd) onDragEnd(e);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (isDragged) return;
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    setIsDragOver(e.clientY < midY ? 'top' : 'bottom');
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const position = e.clientY < midY ? 'top' : 'bottom';
                    setIsDragOver(false);
                    if (onDrop) onDrop(e, position);
                }}
                className={`border-2 rounded-lg p-4 transition-all ${isExpanded ? 'h-auto' : 'h-24'} cursor-pointer ${!isVisible ? 'bg-base-900 border-base-800 opacity-60 grayscale-[0.5]' : 'bg-base-800'} ${isDragOver ? 'border-base-500 opacity-80' : isExpanded ? 'border-base-500' : 'border-base-700'}`}
                onClick={() => !isEditing && setIsExpanded(!isExpanded)}
            >
                <div className="flex justify-between items-center mb-4">
                    <div
                        className="flex items-center gap-2 relative group"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <input
                            type="text"
                            value={trackName}
                            onChange={(e) => setTrackName(e.target.value)}
                            disabled={!isEditing}
                            style={{ width: getDynamicInputWidth(trackName, 7) }}
                            className={`text-base-50 font-semibold px-1 py-1 rounded outline-none transition-colors cursor-text text-lg ${isEditing ? 'bg-base-900' : 'bg-transparent'}`}
                            onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
                        />
                        <button
                            onClick={() => setIsEditing(!isEditing)}
                            className={`transition-colors p-1 rounded border ${isEditing ? 'bg-base-900 text-base-50 border-base-500' : 'bg-transparent border-transparent text-base-300 hover:text-base-50 hover:border-base-400'}`}
                            title="Rename track"
                        >
                            <Pencil size={16} />
                        </button>

                        {/* Track Metadata */}
                        <div className="flex items-center text-xs text-base-400 ml-4 gap-3">
                            <span><span className="text-base-300 font-medium whitespace-nowrap">Artist:</span> <span className="text-base-200">{artistName}</span></span>
                            <div className="w-1 h-1 shrink-0 rounded-full bg-base-600"></div>
                            <span><span className="text-base-300 font-medium whitespace-nowrap">BPM:</span> <span className="text-base-200">{bpm}</span></span>
                            <div className="w-1 h-1 shrink-0 rounded-full bg-base-600"></div>
                            <span><span className="text-base-300 font-medium whitespace-nowrap">Key:</span> <span className="text-base-200">{trackKey}</span></span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-base-900 rounded border border-base-700 p-0.5" onClick={(e) => e.stopPropagation()}>
                            <button
                                onMouseEnter={() => setIsDraggable(true)}
                                onMouseLeave={() => setIsDraggable(false)}
                                className="p-1.5 rounded transition-colors text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95 cursor-grab active:cursor-grabbing"
                                title="Drag to move track"
                            >
                                <Move size={14} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onDuplicate) {
                                        onDuplicate({
                                            initialVolume: volume,
                                            initialPitch: pitch,
                                            initialSpeed: speed,
                                            initialFadeIn: fadeIn,
                                            initialFadeOut: fadeOut
                                        });
                                    }
                                }}
                                className="p-1.5 rounded transition-colors text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95"
                                title="Duplicate track"
                            >
                                <Copy size={14} />
                            </button>
                            <div className="w-px h-4 bg-base-700 mx-0.5"></div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete && onDelete();
                                }}
                                className="p-1.5 rounded transition-colors text-base-500 hover:text-base-50 hover:bg-base-400 active:scale-95"
                                title="Delete track"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }}
                            className="text-xs font-semibold text-base-300 px-3 py-1.5 bg-base-900 rounded hover:text-base-50 hover:bg-base-700 active:scale-95 transition-all"
                        >
                            {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                    </div>
                </div>

                {isExpanded && (
                    <div className="flex flex-col gap-4 mt-4" onClick={(e) => e.stopPropagation()}>
                        {/* Controls & Visualizer Area */}
                        <div className="flex gap-4 h-40 w-full mt-2">
                            {/* Track Controls Left Panel */}
                            <div className="flex flex-col w-32 shrink-0 gap-2">
                                {/* Image Placeholder */}
                                <div className="w-full flex-1 flex items-center justify-center">
                                    <div
                                        className={`h-full aspect-square bg-base-900 border border-base-700 rounded flex items-center justify-center overflow-hidden transition-colors shadow-sm ${!isVisible ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-base-500'}`}
                                        title={`[${trackName}]`}
                                    >
                                        <span className="text-xs text-base-300 font-medium select-none">No Art</span>
                                    </div>
                                </div>

                                {/* Toggle Buttons */}
                                <div className="flex justify-between gap-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
                                        disabled={!isVisible}
                                        className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed' : isPlaying ? 'bg-base-500 text-base-50 border-base-400' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                                    >
                                        {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                                        disabled={!isVisible}
                                        className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible ? 'bg-base-900 text-base-700 border-base-800 cursor-not-allowed' : isMuted ? 'bg-base-600 text-base-50 border-base-500' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                                    >
                                        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsVisible(!isVisible); }}
                                        className={`flex-1 aspect-square rounded flex items-center justify-center transition-colors border ${!isVisible ? 'bg-base-800 text-base-50 border-base-600 hover:border-base-400' : 'bg-base-900 text-base-300 border-base-700 hover:text-base-50 hover:border-base-500'}`}
                                    >
                                        {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                                    </button>
                                </div>

                                {/* Volume Slider */}
                                <div className="flex items-center gap-1.5 w-full mt-1" onClick={(e) => e.stopPropagation()}>
                                    <Volume2 size={12} className="text-base-300 shrink-0" />
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={volume}
                                        disabled={!isVisible}
                                        onChange={(e) => setVolume(e.target.value)}
                                        className={`w-full h-1 bg-base-700 rounded-lg appearance-none accent-base-500 outline-none ${!isVisible ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                    />
                                </div>
                            </div>

                            {/* Visualizer Area */}
                            <div className="flex-1 h-full">
                                <div className="w-full h-full rounded flex items-center justify-center bg-base-900 border border-base-700 shadow-inner">
                                    <span className="text-sm text-base-300">Waveform Placeholder Container</span>
                                </div>
                            </div>
                        </div>

                        {/* Collapsible Settings */}
                        <div className="flex flex-col w-full">
                            <button
                                disabled={!isVisible}
                                className={`flex items-center gap-2 text-sm font-bold transition-colors self-start outline-none p-1 rounded ${!isVisible ? 'text-base-700 cursor-not-allowed' : 'text-base-300 hover:text-base-50 hover:bg-base-700 active:scale-95'} ${isSettingsExpanded ? 'mb-2' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsSettingsExpanded(!isSettingsExpanded);
                                }}
                            >
                                Settings
                                {isSettingsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>

                            {isSettingsExpanded && (
                                <div className={`w-full bg-base-900 rounded-lg p-5 border border-base-700 flex flex-col gap-6 transition-opacity ${!isVisible ? 'opacity-50 pointer-events-none' : ''}`}>

                                    <div className="grid grid-cols-2 gap-8 pt-2">
                                        {/* Fades */}
                                        <div className="flex flex-col gap-3">
                                            <h4 className="text-xs font-bold text-base-400 uppercase tracking-wider">Basic Controls</h4>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                                                    Fade In
                                                    {fadeIn !== "0.0s" && (
                                                        <button onClick={(e) => { e.stopPropagation(); setFadeIn("0.0s"); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to default">
                                                            <RotateCcw size={12} />
                                                        </button>
                                                    )}
                                                </span>
                                                <input type="text" value={fadeIn} onChange={(e) => setFadeIn(e.target.value)} onClick={(e) => e.stopPropagation()} className="bg-base-800 border border-base-700 rounded px-2.5 py-1.5 w-24 text-xs font-mono text-base-50 focus:border-base-500 outline-none text-right" />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                                                    Fade Out
                                                    {fadeOut !== "0.0s" && (
                                                        <button onClick={(e) => { e.stopPropagation(); setFadeOut("0.0s"); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to default">
                                                            <RotateCcw size={12} />
                                                        </button>
                                                    )}
                                                </span>
                                                <input type="text" value={fadeOut} onChange={(e) => setFadeOut(e.target.value)} onClick={(e) => e.stopPropagation()} className="bg-base-800 border border-base-700 rounded px-2.5 py-1.5 w-24 text-xs font-mono text-base-50 focus:border-base-500 outline-none text-right" />
                                            </div>
                                        </div>

                                        {/* Audio Adjustments */}
                                        <div className="flex flex-col gap-3">
                                            <h4 className="text-xs font-bold text-base-400 uppercase tracking-wider">Audio Adjustments</h4>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                                                    Pitch
                                                    {pitch !== 0 && (
                                                        <button onClick={(e) => { e.stopPropagation(); setPitch(0); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to default">
                                                            <RotateCcw size={12} />
                                                        </button>
                                                    )}
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setPitch(prev => prev - 1); }}
                                                        className="bg-base-800 border border-base-700 rounded w-7 h-7 flex items-center justify-center text-base-300 hover:text-base-50 hover:border-base-500 active:scale-95 font-mono leading-none"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="text-sm font-mono text-base-50 w-8 text-center bg-base-800/50 py-1 rounded">{pitch}st</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setPitch(prev => prev + 1); }}
                                                        className="bg-base-800 border border-base-700 rounded w-7 h-7 flex items-center justify-center text-base-300 hover:text-base-50 hover:border-base-500 active:scale-95 font-mono leading-none"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-sm font-medium text-base-300 flex items-center gap-2">
                                                    Speed
                                                    {parseFloat(speed) !== 1.0 && (
                                                        <button onClick={(e) => { e.stopPropagation(); setSpeed(1.0); }} className="text-base-500 hover:text-base-50 transition-colors" title="Reset to default">
                                                            <RotateCcw size={12} />
                                                        </button>
                                                    )}
                                                </span>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-mono text-base-300 w-10 text-right">{Number(speed).toFixed(2)}x</span>
                                                    <input
                                                        type="range"
                                                        min="0.85"
                                                        max="1.15"
                                                        step="0.01"
                                                        value={speed}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => { e.stopPropagation(); setSpeed(e.target.value); }}
                                                        className="w-20 h-1 bg-base-700 rounded-lg appearance-none cursor-pointer accent-base-500 outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* EQ and Effects Collapsibles */}
                                    <div className="flex flex-col gap-3 pt-4 border-t border-base-800">
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setIsEqExpanded(!isEqExpanded); }}
                                                className="flex items-center gap-2 text-sm font-bold text-base-300 hover:text-base-50 transition-colors w-full text-left py-1.5 rounded outline-none w-max"
                                            >
                                                {isEqExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Equalizer
                                            </button>
                                            {isEqExpanded && (
                                                <div className="p-5 bg-base-800 border border-base-700 rounded-lg flex items-center justify-center min-h-[6rem]">
                                                    <span className="text-sm font-mono text-base-400">[TODO: find equalizers]</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setIsEffectsExpanded(!isEffectsExpanded); }}
                                                className="flex items-center gap-2 text-sm font-bold text-base-300 hover:text-base-50 transition-colors w-full text-left py-1.5 rounded outline-none w-max"
                                            >
                                                {isEffectsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Audio Effects
                                            </button>
                                            {isEffectsExpanded && (
                                                <div className="p-5 bg-base-800 border border-base-700 rounded-lg flex items-center justify-center min-h-[6rem]">
                                                    <span className="text-sm font-mono text-base-400">[TODO: find audio effects]</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
