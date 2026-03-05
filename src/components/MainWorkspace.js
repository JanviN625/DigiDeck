import React, { useState } from 'react';
import TrackCard from './TrackCard';
import TrackSearchModal from './TrackSearchModal';
import { useMix } from '../context/SpotifyContext';

export default function MainWorkspace() {
    const { 
        tracks, 
        handleDuplicateTrack, 
        handleDeleteTrack, 
        handleReorderTracks 
    } = useMix();

    const [draggedIndex, setDraggedIndex] = useState(null);
    const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

    const handleDragStart = (e, index) => {
        e.dataTransfer.setData("trackIndex", index.toString());
        e.dataTransfer.effectAllowed = "move";
        setDraggedIndex(index);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
    };

    const handleDrop = (e, targetIndex, position) => {
        const dragIndexStr = e.dataTransfer.getData("trackIndex");
        if (!dragIndexStr) return;
        const dragIndex = parseInt(dragIndexStr, 10);
        handleReorderTracks(dragIndex, targetIndex, position);
    };

    return (
        <main className="flex-1 bg-base-900 p-8 overflow-y-auto">

            <div className="space-y-4">
                {tracks.map((track, index) => (
                    <TrackCard
                        key={track.id}
                        title={track.title}
                        initiallyExpanded={track.initiallyExpanded}
                        onDelete={() => handleDeleteTrack(track.id)}
                        onDuplicate={(currentValues) => handleDuplicateTrack(track.id, currentValues)}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnd={handleDragEnd}
                        onDrop={(e, position) => handleDrop(e, index, position)}
                        isFirst={index === 0}
                        isLast={index === tracks.length - 1}
                        isDragged={draggedIndex === index}
                        initialVolume={track.initialVolume}
                        initialPitch={track.initialPitch}
                        initialSpeed={track.initialSpeed}
                        initialFadeIn={track.initialFadeIn}
                        initialFadeOut={track.initialFadeOut}
                        artistName={track.artistName}
                        albumArt={track.albumArt}
                        spotifyId={track.spotifyId}
                        bpm={track.bpm}
                        trackKey={track.trackKey}
                        audioUrl={track.audioUrl}
                    />
                ))}

                {tracks.length < 5 && (
                    <div
                        onClick={() => setIsSearchModalOpen(true)}
                        className="mt-8 border-2 border-base-700 border-dashed rounded-lg h-32 flex items-center justify-center hover:bg-base-800 transition-colors cursor-pointer text-base-300 hover:text-base-100 shadow-sm"
                    >
                        + Add New Track
                    </div>
                )}
            </div>

            <TrackSearchModal 
                isOpen={isSearchModalOpen} 
                onClose={() => setIsSearchModalOpen(false)} 
            />
        </main>
    );
}
