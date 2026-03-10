import {
    fetchSpotifyApi,
    getUserPlaylists,
    getPlaylist,
    getPlaylistTracks,
    getSavedTracks,
    searchSpotify,
} from '../spotify/spotifyApi';

// Provide a valid non-expired token so getValidAccessToken returns immediately
const VALID_EXPIRES_AT = String(Date.now() + 3600000);

jest.mock('../firebase/firebase', () => ({ default: {} }));
jest.mock('../firebase/firebaseConfig', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), setDoc: jest.fn(), serverTimestamp: jest.fn() }));
jest.mock('firebase/auth', () => ({ updateProfile: jest.fn() }));

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('access_token', 'mock_token');
    localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    global.fetch = jest.fn();
});

afterEach(() => { delete global.fetch; });

const mockOk = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const mockErr = (status = 400, body = '{"error":{"message":"Bad Request"}}') => ({
    ok: false, status, statusText: 'Error', text: async () => body,
});

// ─── fetchSpotifyApi ──────────────────────────────────────────────────────────

describe('fetchSpotifyApi', () => {
    it('adds the correct Authorization header', async () => {
        fetch.mockResolvedValueOnce(mockOk({ data: true }));

        await fetchSpotifyApi('/me');

        expect(fetch).toHaveBeenCalledWith(
            'https://api.spotify.com/v1/me',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mock_token' }) })
        );
    });

    it('prepends the base URL for relative endpoints', async () => {
        fetch.mockResolvedValueOnce(mockOk());

        await fetchSpotifyApi('/playlists/123');

        expect(fetch).toHaveBeenCalledWith('https://api.spotify.com/v1/playlists/123', expect.any(Object));
    });

    it('passes through absolute URLs unchanged', async () => {
        fetch.mockResolvedValueOnce(mockOk());
        const url = 'https://api.spotify.com/v1/me/tracks?offset=50';

        await fetchSpotifyApi(url);

        expect(fetch).toHaveBeenCalledWith(url, expect.any(Object));
    });

    it('returns null for 204 No Content responses', async () => {
        fetch.mockResolvedValueOnce({ ok: true, status: 204 });

        const result = await fetchSpotifyApi('/me/player/play');

        expect(result).toBeNull();
    });

    it('throws an error with the Spotify error message on non-2xx responses', async () => {
        fetch.mockResolvedValueOnce(mockErr(400));

        await expect(fetchSpotifyApi('/bad-endpoint')).rejects.toThrow('Spotify API Error: 400');
    });

    it('throws a generic error when the error response body is not JSON', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error', text: async () => 'Internal Error' });

        await expect(fetchSpotifyApi('/bad-endpoint')).rejects.toThrow('Spotify API Error: 500');
    });

    it('throws when no valid access token is available', async () => {
        localStorage.clear();
        const { auth } = require('../firebase/firebaseConfig');
        auth.currentUser = null;

        await expect(fetchSpotifyApi('/me')).rejects.toThrow('No valid Spotify access token available');
    });
});

// ─── Endpoint Functions ───────────────────────────────────────────────────────

describe('getUserPlaylists', () => {
    it('calls the correct endpoint with default limit and offset', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getUserPlaylists();

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/me/playlists?limit=20&offset=0'), expect.any(Object));
    });

    it('passes custom limit and offset params', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getUserPlaylists(50, 20);

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('limit=50&offset=20'), expect.any(Object));
    });
});

describe('getPlaylist', () => {
    it('calls the correct endpoint for the given playlist ID', async () => {
        fetch.mockResolvedValueOnce(mockOk({ id: 'pl_1' }));

        await getPlaylist('pl_1');

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/playlists/pl_1'), expect.any(Object));
    });
});

describe('getPlaylistTracks', () => {
    it('calls the correct endpoint with playlist ID, limit, and offset', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getPlaylistTracks('pl_1', 50, 0);

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/playlists/pl_1/items?limit=50&offset=0'), expect.any(Object));
    });
});

describe('getSavedTracks', () => {
    it('calls the correct endpoint with default params', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getSavedTracks();

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/me/tracks?limit=20&offset=0'), expect.any(Object));
    });
});

// ─── searchSpotify ────────────────────────────────────────────────────────────

describe('searchSpotify', () => {
    it('returns null for an empty query without calling the API', async () => {
        const result = await searchSpotify('');

        expect(result).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('encodes the query and builds the type string correctly for an array', async () => {
        fetch.mockResolvedValueOnce(mockOk({ tracks: { items: [] } }));

        await searchSpotify('test query', ['track', 'artist'], 10);

        const url = fetch.mock.calls[0][0];
        expect(url).toContain('q=test%20query');
        expect(url).toContain('type=track,artist');
    });

    it('handles a single string type (not an array)', async () => {
        fetch.mockResolvedValueOnce(mockOk({ tracks: { items: [] } }));

        await searchSpotify('hello', 'track');

        expect(fetch.mock.calls[0][0]).toContain('type=track');
    });
});

