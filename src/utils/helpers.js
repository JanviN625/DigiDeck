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

// Builds a normalized track data object from a Spotify track response.
// TODO: bpm and trackKey will be populated via a third-party audio analysis API (e.g. AudD, ACRCloud)
export const resolveTrackData = (track) => ({
    title: track.name,
    spotifyId: track.id,
    artistName: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    albumArt: track.album?.images?.[0]?.url,
    audioUrl: track.preview_url || null,
});
