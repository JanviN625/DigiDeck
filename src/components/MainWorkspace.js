import React, { useState, useRef } from 'react';
import TrackCard from './TrackCard';
import { useMix } from '../spotify/appContext';
import { AlertCircle, Plus, X } from 'lucide-react';
import { useSettings } from '../utils/useSettings';

export default function MainWorkspace() {
    const { tracks, handleAddTrack, handleDuplicateTrack, handleDeleteTrack, handleMoveTrack, trackLimitError, setTrackLimitError } = useMix();
    const { settings } = useSettings();
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dropGap, setDropGap] = useState(null);
    const clearGapTimer = useRef(null);

    const scheduleGapClear = () => {
        clearGapTimer.current = setTimeout(() => setDropGap(null), 60);
    };

    const cancelGapClear = () => {
        if (clearGapTimer.current) {
            clearTimeout(clearGapTimer.current);
            clearGapTimer.current = null;
        }
    };

    const activateGap = (gapIndex) => {
        cancelGapClear();
        setDropGap(gapIndex);
    };

    const handleDragStart = (e, index) => {
        e.dataTransfer.setData('trackIndex', index.toString());
        e.dataTransfer.effectAllowed = 'move';
        setDraggedIndex(index);
    };

    const handleDragEnd = () => {
        cancelGapClear();
        setDraggedIndex(null);
        setDropGap(null);
    };

    const handleCardDragHover = (index, position) => {
        if (position === null) { scheduleGapClear(); return; }
        const gap = position === 'top' ? index : index + 1;
        if (draggedIndex !== null && (gap === draggedIndex || gap === draggedIndex + 1)) return;
        activateGap(gap);
    };

    const handleGapDrop = (e, gapIndex) => {
        e.preventDefault();
        cancelGapClear();
        const dragIndexStr = e.dataTransfer.getData('trackIndex');
        if (!dragIndexStr) return;
        const fromIndex = parseInt(dragIndexStr, 10);
        const toIndex = fromIndex < gapIndex ? gapIndex - 1 : gapIndex;
        handleMoveTrack(fromIndex, toIndex);
        setDropGap(null);
    };

    const isUselessGap = (gapIndex) =>
        draggedIndex !== null &&
        (gapIndex === draggedIndex || gapIndex === draggedIndex + 1);

    const GapZone = ({ gapIndex }) => {
        if (isUselessGap(gapIndex)) return <div className="h-2" />;
        return (
            <div
                className={`transition-all duration-150 rounded-lg flex items-center justify-center gap-2 ${
                    dropGap === gapIndex
                        ? 'h-10 my-1 border-2 border-dashed border-base-500 text-base-300'
                        : 'h-2 border-2 border-transparent'
                }`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); activateGap(gapIndex); }}
                onDragLeave={() => scheduleGapClear()}
                onDrop={(e) => handleGapDrop(e, gapIndex)}
            >
                {dropGap === gapIndex && (
                    <>
                        <Plus size={12} className="pointer-events-none shrink-0" />
                        <span className="text-xs font-medium pointer-events-none">Add Track Here</span>
                    </>
                )}
            </div>
        );
    };

    return (
        <main className="flex-1 bg-base-900 p-8 overflow-y-auto relative">
            {trackLimitError && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-red-900/90 border border-red-500/50 text-red-100 px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-4 duration-300">
                    <AlertCircle size={18} className="text-red-400 shrink-0" />
                    <span className="text-sm font-medium">{trackLimitError}</span>
                    <button onClick={() => setTrackLimitError(null)} className="ml-2 text-red-400 hover:text-red-200 transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}
            <div className="flex flex-col">

                {tracks.map((track, index) => (
                    <React.Fragment key={track.id}>
                        <GapZone gapIndex={index} />
                        <TrackCard
                            trackId={track.id}
                            title={track.title}
                            initiallyExpanded={track.initiallyExpanded}
                            onDelete={() => handleDeleteTrack(track.id)}
                            onDuplicate={(currentValues) => handleDuplicateTrack(track.id, currentValues)}
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragEnd={handleDragEnd}
                            onDragHover={(position) => handleCardDragHover(index, position)}
                            isDragged={draggedIndex === index}
                            initialVolume={track.initialVolume}
                            initialPitch={track.initialPitch}
                            initialSpeed={track.initialSpeed}
                            initialFadeIn={track.initialFadeIn}
                            initialZoom={track.initialZoom}
                            offsetSec={track.offsetSec}
                            artistName={track.artistName}
                            albumArt={track.albumArt}
                            spotifyId={track.spotifyId}
                            bpm={track.bpm}
                            trackKey={track.trackKey}
                            audioUrl={track.audioUrl}
                            audioBlob={track.audioBlob}
                            beatPositions={track.beatPositions}
                            initialSegments={track.initialSegments}
                            isMissing={track.isMissing ?? false}
                        />
                    </React.Fragment>
                ))}

                {tracks.length > 0 && <GapZone gapIndex={tracks.length} />}

                {tracks.length < 5 && (
                    <button
                        onClick={() => handleAddTrack({
                            initialVolume:  settings.defaultVolume,
                            initialZoom:    settings.defaultZoom,
                            initialFadeIn:  settings.defaultFadeIn,
                            initialFadeOut: settings.defaultFadeOut,
                        })}
                        className="w-full flex items-center justify-center gap-2 py-3 mt-2 rounded-lg border-2 border-dashed border-base-700 text-base-400 hover:border-base-500 hover:text-base-200 transition-colors"
                    >
                        <Plus size={16} />
                        <span className="text-sm font-medium">Add New Track</span>
                        <span className="text-xs text-base-500">({tracks.length}/5)</span>
                    </button>
                )}
            </div>
        </main>
    );
}
