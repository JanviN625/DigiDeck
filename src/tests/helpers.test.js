import {
    getDynamicInputWidth,
    getNextAvailableTrackName,
    getUniqueTrackName,
    readId3Tags,
    spotifyConfirmMatch,
} from '../utils/helpers';

// ─── getDynamicInputWidth ─────────────────────────────────────────────────────

describe('getDynamicInputWidth', () => {
    it('returns minCharCount when text is shorter', () => {
        expect(getDynamicInputWidth('Hi', 14)).toBe('14ch');
    });

    it('returns text length when text exceeds minCharCount', () => {
        expect(getDynamicInputWidth('A very long project name here!', 14)).toBe('30ch');
    });

    it('returns minCharCount for an empty string', () => {
        expect(getDynamicInputWidth('', 14)).toBe('14ch');
    });

    it('returns exact length when text length equals minCharCount', () => {
        expect(getDynamicInputWidth('12345678901234', 14)).toBe('14ch');
    });

    it('handles a single character', () => {
        expect(getDynamicInputWidth('X', 1)).toBe('1ch');
    });
});

// ─── getNextAvailableTrackName ────────────────────────────────────────────────

describe('getNextAvailableTrackName', () => {
    it('returns Track 1 when the track list is empty', () => {
        expect(getNextAvailableTrackName([])).toBe('Track 1');
    });

    it('returns Track 2 when only Track 1 exists', () => {
        expect(getNextAvailableTrackName([{ title: 'Track 1' }])).toBe('Track 2');
    });

    it('fills the first gap — returns Track 2 when Track 1 and Track 3 exist', () => {
        const tracks = [{ title: 'Track 1' }, { title: 'Track 3' }];
        expect(getNextAvailableTrackName(tracks)).toBe('Track 2');
    });

    it('skips all existing sequential numbers and returns the next one', () => {
        const tracks = [
            { title: 'Track 1' },
            { title: 'Track 2' },
            { title: 'Track 3' },
        ];
        expect(getNextAvailableTrackName(tracks)).toBe('Track 4');
    });

    it('ignores non-default track names when finding the next number', () => {
        const tracks = [{ title: 'My Custom Track' }, { title: 'Track 1' }];
        expect(getNextAvailableTrackName(tracks)).toBe('Track 2');
    });
});

// ─── getUniqueTrackName ───────────────────────────────────────────────────────

describe('getUniqueTrackName', () => {
    it('returns the title unchanged when there is no collision', () => {
        expect(getUniqueTrackName('My Track', ['Track 1', 'Track 2'])).toBe('My Track');
    });

    it('appends (1) on the first collision', () => {
        expect(getUniqueTrackName('Track 1', ['Track 1', 'Track 2'])).toBe('Track 1 (1)');
    });

    it('increments the suffix until a unique name is found', () => {
        const existing = ['Track 1', 'Track 1 (1)', 'Track 1 (2)'];
        expect(getUniqueTrackName('Track 1', existing)).toBe('Track 1 (3)');
    });

    it('handles an empty existing titles list', () => {
        expect(getUniqueTrackName('My Song', [])).toBe('My Song');
    });

    it('returns title unchanged when existing list contains different names', () => {
        expect(getUniqueTrackName('Alpha', ['Beta', 'Gamma'])).toBe('Alpha');
    });
});

// ─── readId3Tags ──────────────────────────────────────────────────────────────

jest.mock('music-metadata-browser', () => ({ parseBlob: jest.fn() }), { virtual: true });

describe('readId3Tags', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns title and artist when metadata contains both', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockResolvedValueOnce({
            common: { title: 'My Song', artist: 'My Artist', picture: [] },
        });

        const result = await readId3Tags(new Blob(['audio'], { type: 'audio/mp3' }));

        expect(result.title).toBe('My Song');
        expect(result.artist).toBe('My Artist');
        expect(result.albumArtBlob).toBeNull();
    });

    it('returns an albumArtBlob when an embedded picture is present', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        const fakeData = new Uint8Array([0xff, 0xd8, 0xff]);
        parseBlob.mockResolvedValueOnce({
            common: {
                title: 'Art Track',
                artist: null,
                picture: [{ data: fakeData, format: 'image/jpeg' }],
            },
        });

        const result = await readId3Tags(new Blob(['audio']));

        expect(result.albumArtBlob).toBeInstanceOf(Blob);
        expect(result.albumArtBlob.type).toBe('image/jpeg');
    });

    it('returns all nulls when parseBlob throws', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockRejectedValueOnce(new Error('corrupt file'));

        const result = await readId3Tags(new Blob(['audio']));

        expect(result).toEqual({ title: null, artist: null, albumArtBlob: null });
    });

    it('returns null title and artist when metadata fields are absent', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockResolvedValueOnce({
            common: { picture: [] },
        });

        const result = await readId3Tags(new Blob(['audio']));

        expect(result.title).toBeNull();
        expect(result.artist).toBeNull();
    });

    it('returns null albumArtBlob when picture array is empty', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockResolvedValueOnce({
            common: { title: 'No Art', artist: 'Artist', picture: [] },
        });

        const result = await readId3Tags(new Blob(['audio']));

        expect(result.albumArtBlob).toBeNull();
    });
});

// ─── spotifyConfirmMatch ──────────────────────────────────────────────────────

const makeTrack = (name) => ({
    name,
    artists: [{ name: 'Artist' }],
    album: { images: [{ url: 'http://img.example' }] },
});

describe('spotifyConfirmMatch', () => {
    it('returns null when spotifyResults is empty', () => {
        expect(spotifyConfirmMatch('My Song', [])).toBeNull();
    });

    it('returns null when spotifyResults is null', () => {
        expect(spotifyConfirmMatch('My Song', null)).toBeNull();
    });

    it('returns null when id3Title is an empty string', () => {
        expect(spotifyConfirmMatch('', [makeTrack('My Song')])).toBeNull();
    });

    it('returns null when id3Title is falsy', () => {
        expect(spotifyConfirmMatch(null, [makeTrack('My Song')])).toBeNull();
    });

    it('matches when the Spotify title contains the id3 title (substring)', () => {
        const track = makeTrack('My Song (Remastered 2024)');
        expect(spotifyConfirmMatch('My Song', [track])).toBe(track);
    });

    it('matches when the id3 title contains the Spotify title (substring)', () => {
        const track = makeTrack('Song');
        expect(spotifyConfirmMatch('My Song Extended Cut', [track])).toBe(track);
    });

    it('matches identical titles exactly', () => {
        const track = makeTrack('Bohemian Rhapsody');
        expect(spotifyConfirmMatch('Bohemian Rhapsody', [track])).toBe(track);
    });

    it('returns null when titles are completely dissimilar', () => {
        const track = makeTrack('Completely Different Track Here');
        expect(spotifyConfirmMatch('xyz', [track])).toBeNull();
    });

    it('only checks the first result — ignores subsequent matches', () => {
        const wrong = makeTrack('Wrong Song');
        const right = makeTrack('Right Song');
        // Only the first result is evaluated; 'Right Song' is not checked
        expect(spotifyConfirmMatch('Right Song', [wrong, right])).toBeNull();
    });

    it('normalises punctuation and casing before comparing', () => {
        const track = makeTrack("Don't Stop Me Now");
        expect(spotifyConfirmMatch('dont stop me now', [track])).toBe(track);
    });

    it('matches via trigram similarity when titles differ in formatting (>= 0.5)', () => {
        // 'starmanremaster2012' vs 'starman' — 'starman' is contained in the normalised form
        const track = makeTrack('Starman (Remaster 2012)');
        expect(spotifyConfirmMatch('Starman', [track])).toBe(track);
    });
});
