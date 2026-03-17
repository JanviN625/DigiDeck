import {
    fetchSpotifyApi,
    getUserPlaylists,
    getPlaylist,
    getPlaylistTracks,
    getSavedTracks,
    searchSpotify,
    processCallbackCode,
    refreshAccessToken,
    getValidAccessToken,
    disconnectSpotify,
    getAccessToken,
    isLoggedIn,
} from '../spotify/spotifyApi';
import FirebaseService from '../firebase/firebase';
import { auth } from '../firebase/firebaseConfig';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../firebase/firebase', () => ({
    __esModule: true,
    default: {
        saveSpotifyToken: jest.fn(),
        getSpotifyToken: jest.fn(),
        deleteSpotifyToken: jest.fn(),
    },
}));

jest.mock('../firebase/firebaseConfig', () => ({
    auth: { currentUser: null },
    db: {},
}));

jest.mock('firebase/firestore', () => ({
    doc: jest.fn(() => 'mock_ref'),
    setDoc: jest.fn(),
    serverTimestamp: jest.fn(() => 'mock_timestamp'),
}));

jest.mock('firebase/auth', () => ({
    updateProfile: jest.fn(),
}));

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const VALID_EXPIRES_AT = String(Date.now() + 3600000);

const mockUser = { uid: 'uid_123', photoURL: null, displayName: null, reload: jest.fn() };

const mockOk = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const mockErr = (status = 400, body = '{"error":{"message":"Bad Request"}}') => ({
    ok: false, status, statusText: 'Error', text: async () => body,
});

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    auth.currentUser = null;
    global.fetch = jest.fn();
    // resetMocks:true clears inline jest.fn() implementations — restore here.
    const { doc, serverTimestamp } = require('firebase/firestore');
    doc.mockReturnValue('mock_ref');
    serverTimestamp.mockReturnValue('mock_timestamp');
});

afterEach(() => { delete global.fetch; });

// ─── API Functions ────────────────────────────────────────────────────────────
// These tests require a valid non-expired token in localStorage.

describe('fetchSpotifyApi', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'mock_token');
        localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    });

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

describe('getUserPlaylists', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'mock_token');
        localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    });

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
    beforeEach(() => {
        localStorage.setItem('access_token', 'mock_token');
        localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    });

    it('calls the correct endpoint for the given playlist ID', async () => {
        fetch.mockResolvedValueOnce(mockOk({ id: 'pl_1' }));

        await getPlaylist('pl_1');

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/playlists/pl_1'), expect.any(Object));
    });
});

describe('getPlaylistTracks', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'mock_token');
        localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    });

    it('calls the correct endpoint with playlist ID, limit, and offset', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getPlaylistTracks('pl_1', 50, 0);

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/playlists/pl_1/items?limit=50&offset=0'), expect.any(Object));
    });
});

describe('getSavedTracks', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'mock_token');
        localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    });

    it('calls the correct endpoint with default params', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getSavedTracks();

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/me/tracks?limit=20&offset=0'), expect.any(Object));
    });

    it('passes custom limit and offset params', async () => {
        fetch.mockResolvedValueOnce(mockOk({ items: [] }));

        await getSavedTracks(50, 10);

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('limit=50&offset=10'), expect.any(Object));
    });
});

describe('searchSpotify', () => {
    beforeEach(() => {
        localStorage.setItem('access_token', 'mock_token');
        localStorage.setItem('spotify_expires_at', VALID_EXPIRES_AT);
    });

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

    it('uses the default type array (track,playlist,artist,album) when no types argument is given', async () => {
        fetch.mockResolvedValueOnce(mockOk({ tracks: { items: [] } }));

        await searchSpotify('chill beats');

        expect(fetch.mock.calls[0][0]).toContain('type=track,playlist,artist,album');
    });
});

// ─── Auth Flow ────────────────────────────────────────────────────────────────

describe('processCallbackCode', () => {
    beforeEach(() => {
        localStorage.setItem('code_verifier', 'mock_verifier');
        auth.currentUser = mockUser;
    });

    it('exchanges code for tokens, saves to localStorage, updates Firebase', async () => {
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: false });

        const result = await processCallbackCode('mock_code');

        expect(result).toBe(true);
        expect(localStorage.getItem('access_token')).toBe('at');
        expect(localStorage.getItem('code_verifier')).toBeNull();
        expect(FirebaseService.saveSpotifyToken).toHaveBeenCalledWith('uid_123', expect.objectContaining({ access_token: 'at', refresh_token: 'rt' }));
    });

    it('saves Spotify profile data to Firestore when profile fetch succeeds', async () => {
        const { setDoc } = require('firebase/firestore');
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'spotify_user', display_name: 'DJ Test', images: [] }) });

        await processCallbackCode('mock_code');

        expect(setDoc).toHaveBeenCalledWith('mock_ref', expect.objectContaining({ spotify: expect.objectContaining({ spotifyUserId: 'spotify_user' }) }), { merge: true });
    });

    it('sets Firebase Auth displayName from Spotify profile when not already set', async () => {
        const { updateProfile } = require('firebase/auth');
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'spotify_user', display_name: 'DJ Test', images: [] }) });

        await processCallbackCode('mock_code');

        expect(updateProfile).toHaveBeenCalledWith(mockUser, { displayName: 'DJ Test' });
    });

    it('returns false when no code_verifier is in localStorage', async () => {
        localStorage.removeItem('code_verifier');

        const result = await processCallbackCode('mock_code');

        expect(result).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('returns false when the Spotify token exchange request fails', async () => {
        fetch.mockResolvedValueOnce({ ok: false });

        const result = await processCallbackCode('mock_code');

        expect(result).toBe(false);
        expect(FirebaseService.saveSpotifyToken).not.toHaveBeenCalled();
    });

    it('returns false when there is no authenticated Firebase user', async () => {
        auth.currentUser = null;
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) });

        const result = await processCallbackCode('mock_code');

        expect(result).toBe(false);
    });

    it('updates photoURL from Spotify profile when user has no photoURL but profile has an image', async () => {
        const { updateProfile } = require('firebase/auth');
        auth.currentUser = { ...mockUser, photoURL: null, displayName: 'Existing Name', reload: jest.fn() };
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({
                id: 'sp_user',
                display_name: 'DJ Test',
                images: [{ url: 'https://spotify-img.example' }],
            }) });

        await processCallbackCode('mock_code');

        expect(updateProfile).toHaveBeenCalledWith(
            auth.currentUser,
            expect.objectContaining({ photoURL: 'https://spotify-img.example' })
        );
    });

    it('skips updateProfile when user already has both displayName and photoURL', async () => {
        const { updateProfile } = require('firebase/auth');
        auth.currentUser = { ...mockUser, photoURL: 'https://existing.example', displayName: 'Already Set', reload: jest.fn() };
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({
                id: 'sp_user',
                display_name: 'DJ Test',
                images: [{ url: 'https://spotify-img.example' }],
            }) });

        await processCallbackCode('mock_code');

        expect(updateProfile).not.toHaveBeenCalled();
    });

    it('calls currentUser.reload() after updating the profile', async () => {
        const reloadMock = jest.fn().mockResolvedValue(undefined);
        auth.currentUser = { ...mockUser, reload: reloadMock };
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'sp_user', display_name: 'DJ Test', images: [] }) });

        await processCallbackCode('mock_code');

        expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('returns true and saves the token even when Spotify profile fetch fails', async () => {
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: false, status: 403 });

        const result = await processCallbackCode('mock_code');

        expect(result).toBe(true);
        expect(FirebaseService.saveSpotifyToken).toHaveBeenCalledWith('uid_123', expect.objectContaining({ access_token: 'at' }));
    });
});

describe('refreshAccessToken', () => {
    it('fetches a new access token and saves it to localStorage and Firebase', async () => {
        auth.currentUser = mockUser;
        FirebaseService.getSpotifyToken.mockResolvedValueOnce({ refresh_token: 'old_rt' });
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'new_at', expires_in: 3600 }) });
        FirebaseService.saveSpotifyToken.mockResolvedValueOnce();

        const result = await refreshAccessToken();

        expect(result).toBe('new_at');
        expect(localStorage.getItem('access_token')).toBe('new_at');
        expect(FirebaseService.saveSpotifyToken).toHaveBeenCalledWith('uid_123', expect.objectContaining({ access_token: 'new_at' }));
    });

    it('retains the existing refresh token if none is returned in the response', async () => {
        auth.currentUser = mockUser;
        FirebaseService.getSpotifyToken.mockResolvedValueOnce({ refresh_token: 'old_rt' });
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'new_at', expires_in: 3600 }) });

        await refreshAccessToken();

        expect(FirebaseService.saveSpotifyToken).toHaveBeenCalledWith('uid_123', expect.objectContaining({ refresh_token: 'old_rt' }));
    });

    it('returns null when there is no authenticated Firebase user', async () => {
        auth.currentUser = null;

        const result = await refreshAccessToken();

        expect(result).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('returns null when no refresh token is stored in Firebase', async () => {
        auth.currentUser = mockUser;
        FirebaseService.getSpotifyToken.mockResolvedValueOnce(null);

        const result = await refreshAccessToken();

        expect(result).toBeNull();
    });

    it('returns null when the Spotify refresh request fails', async () => {
        auth.currentUser = mockUser;
        FirebaseService.getSpotifyToken.mockResolvedValueOnce({ refresh_token: 'rt' });
        fetch.mockResolvedValueOnce({ ok: false });

        const result = await refreshAccessToken();

        expect(result).toBeNull();
    });
});

describe('getValidAccessToken', () => {
    it('returns the cached token when it is not yet expired', async () => {
        localStorage.setItem('access_token', 'cached_token');
        localStorage.setItem('spotify_expires_at', String(Date.now() + 3600000));

        const result = await getValidAccessToken();

        expect(result).toBe('cached_token');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('calls refreshAccessToken when the token is expired', async () => {
        localStorage.setItem('access_token', 'old_token');
        localStorage.setItem('spotify_expires_at', String(Date.now() - 1000));
        auth.currentUser = mockUser;
        FirebaseService.getSpotifyToken.mockResolvedValueOnce({ refresh_token: 'rt' });
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'refreshed', expires_in: 3600 }) });

        const result = await getValidAccessToken();

        expect(result).toBe('refreshed');
    });

    it('calls refreshAccessToken when no expiry exists in localStorage', async () => {
        auth.currentUser = null;

        const result = await getValidAccessToken();

        expect(result).toBeNull();
    });
});

describe('disconnectSpotify', () => {
    it('clears all Spotify keys from localStorage', async () => {
        auth.currentUser = mockUser;
        localStorage.setItem('access_token', 'tok');
        localStorage.setItem('code_verifier', 'cv');
        localStorage.setItem('spotify_expires_at', '9999');
        FirebaseService.deleteSpotifyToken.mockResolvedValueOnce();
        const { setDoc } = require('firebase/firestore');
        setDoc.mockResolvedValueOnce();

        await disconnectSpotify();

        expect(localStorage.getItem('access_token')).toBeNull();
        expect(localStorage.getItem('code_verifier')).toBeNull();
        expect(localStorage.getItem('spotify_expires_at')).toBeNull();
    });

    it('deletes the Spotify token from Firebase and clears the spotify field', async () => {
        auth.currentUser = mockUser;
        FirebaseService.deleteSpotifyToken.mockResolvedValueOnce();
        const { setDoc } = require('firebase/firestore');
        setDoc.mockResolvedValueOnce();

        await disconnectSpotify();

        expect(FirebaseService.deleteSpotifyToken).toHaveBeenCalledWith('uid_123');
        expect(setDoc).toHaveBeenCalledWith('mock_ref', { spotify: null }, { merge: true });
    });

    it('still clears localStorage even when no Firebase user is signed in', async () => {
        auth.currentUser = null;
        localStorage.setItem('access_token', 'tok');

        await disconnectSpotify();

        expect(localStorage.getItem('access_token')).toBeNull();
        expect(FirebaseService.deleteSpotifyToken).not.toHaveBeenCalled();
    });
});

describe('getAccessToken', () => {
    it('returns the token stored in localStorage', () => {
        localStorage.setItem('access_token', 'my_token');
        expect(getAccessToken()).toBe('my_token');
    });

    it('returns null when no token is stored', () => {
        expect(getAccessToken()).toBeNull();
    });
});

describe('isLoggedIn', () => {
    it('returns true when an access token exists', () => {
        localStorage.setItem('access_token', 'tok');
        expect(isLoggedIn()).toBe(true);
    });

    it('returns false when no access token exists', () => {
        expect(isLoggedIn()).toBe(false);
    });
});
