import React, { useState } from 'react';
import TrackCard from './TrackCard';
import { getNextAvailableTrackName } from '../utils/helpers';

export default function MainWorkspace() {
    const [tracks, setTracks] = useState([
        { id: 1, title: 'Track 1', initiallyExpanded: true },
        { id: 2, title: 'Track 2', initiallyExpanded: false }
    ]);

    const handleAddTrack = () => {
        if (tracks.length >= 5) return;

        setTracks([
            ...tracks,
            {
                id: Date.now(),
                title: getNextAvailableTrackName(tracks),
                initiallyExpanded: false
            }
        ]);
    };

    const handleDuplicateTrack = (trackId, currentValues) => {
        if (tracks.length >= 5) return;

        const trackIndex = tracks.findIndex(t => t.id === trackId);
        if (trackIndex === -1) return;

        const newTrack = {
            id: Date.now(),
            title: getNextAvailableTrackName(tracks),
            initiallyExpanded: false,
            ...currentValues
        };

        const newTracks = [...tracks];
        newTracks.splice(trackIndex + 1, 0, newTrack);
        setTracks(newTracks);
    };

    const handleDeleteTrack = (idToRemove) => {
        setTracks(tracks.filter(track => track.id !== idToRemove));
    };

    const [draggedIndex, setDraggedIndex] = useState(null);

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
        if (dragIndex === targetIndex) return;

        const newTracks = [...tracks];
        const [draggedTrack] = newTracks.splice(dragIndex, 1);

        let dropIndex = targetIndex;
        if (dragIndex < targetIndex) {
            dropIndex = targetIndex - 1;
            if (position === 'bottom') {
                dropIndex++;
            }
        } else {
            if (position === 'bottom') {
                dropIndex++;
            }
        }

        newTracks.splice(dropIndex, 0, draggedTrack);
        setTracks(newTracks);
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
                    />
                ))}

                {tracks.length < 5 && (
                    <div
                        onClick={handleAddTrack}
                        className="mt-8 border-2 border-base-700 border-dashed rounded-lg h-32 flex items-center justify-center hover:bg-base-800 transition-colors cursor-pointer text-base-300 hover:text-base-100 shadow-sm"
                    >
                        + Add New Track
                    </div>
                )}
            </div>
        </main>
    );
}
