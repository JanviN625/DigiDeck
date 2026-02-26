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
