export const getDynamicInputWidth = (text, minCharCount) => {
    return `${Math.max(minCharCount, text.length)}ch`;
};

export const getNextAvailableTrackName = (tracks) => {
    let nextNumber = 1;
    const currentTitles = tracks.map(t => t.title);
    while (currentTitles.includes(`Track ${nextNumber}`)) {
        nextNumber++;
    }
    return `Track ${nextNumber}`;
};

// Helper to convert Spotify's pitch class format to a readable string
export const pitchClassToKey = (pitchClass, mode) => {
    if (pitchClass === undefined || pitchClass === null || pitchClass < 0 || pitchClass > 11) return '[Key]';
    const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const scale = mode === 0 ? 'm' : ''; // 0 = Minor, 1 = Major
    return `${keys[pitchClass]}${scale}`;
};
