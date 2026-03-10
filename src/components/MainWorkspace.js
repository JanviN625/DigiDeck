import React, { useState } from 'react';
import TrackCard from './TrackCard';
import { useMix } from '../spotify/spotifyContext';

export default function MainWorkspace() {
    const { tracks, handleDuplicateTrack, handleDeleteTrack, handleReorderTracks } = useMix();
    const [draggedIndex, setDraggedIndex] = useState(null);

    const handleDragStart = (e, index) => {
        e.dataTransfer.setData('trackIndex', index.toString());
        e.dataTransfer.effectAllowed = 'move';
        setDraggedIndex(index);
    };

    const handleDragEnd = () => setDraggedIndex(null);

    const handleDrop = (e, targetIndex, position) => {
        const dragIndexStr = e.dataTransfer.getData('trackIndex');
        if (!dragIndexStr) return;
        handleReorderTracks(parseInt(dragIndexStr, 10), targetIndex, position);
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
            </div>
        </main>
    );
}
