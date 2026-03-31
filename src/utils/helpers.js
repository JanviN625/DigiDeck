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

// Returns a version of `title` that does not already exist in `existingTitles`.
// Appends (1), (2), … until a unique name is found.
export const getUniqueTrackName = (title, existingTitles) => {
    if (!existingTitles.includes(title)) return title;
    let n = 1;
    while (existingTitles.includes(`${title} (${n})`)) n++;
    return `${title} (${n})`;
};

// Reads metadata tags from a File object using music-metadata-browser.
// Returns { title, artist, albumArtBlob } — any field may be null if absent/unreadable.
export async function readId3Tags(file) {
    try {
        const { parseBlob } = await import('music-metadata-browser');
        const metadata = await parseBlob(file, { skipCovers: false });
        const { title, artist, picture } = metadata.common;
        let albumArtBlob = null;
        if (picture?.length) {
            const pic = picture[0];
            albumArtBlob = new Blob([pic.data], { type: pic.format });
        }
        return { title: title || null, artist: artist || null, albumArtBlob };
    } catch {
        return { title: null, artist: null, albumArtBlob: null };
    }
}

// Checks whether the first Spotify search result is a confident match for a local file's
// ID3 title. Accepts if one title contains the other after normalisation, or if character
// trigram Jaccard similarity is >= 0.5 (handles "feat.", remaster tags, punctuation, etc.).
export function spotifyConfirmMatch(id3Title, spotifyResults) {
    if (!spotifyResults?.length || !id3Title) return null;

    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const t = norm(id3Title);
    const match = spotifyResults[0];
    const s = norm(match.name);
    if (!t || !s) return null;

    if (s.includes(t) || t.includes(s)) return match;

    const trigrams = (str) => {
        const set = new Set();
        for (let i = 0; i < str.length - 2; i++) set.add(str.slice(i, i + 3));
        return set;
    };
    const tTri = trigrams(t);
    const sTri = trigrams(s);
    if (!tTri.size || !sTri.size) return null;
    const intersection = [...tTri].filter(x => sTri.has(x)).length;
    const union = new Set([...tTri, ...sTri]).size;
    return intersection / union >= 0.5 ? match : null;
}

// Builds a Spotify field-filtered query for precision when both fields are known.
export function buildSpotifyQuery(title, artist) {
    if (title && artist) return `track:${title} artist:${artist}`;
    if (title) return title;
    if (artist) return artist;
    return '';
}
