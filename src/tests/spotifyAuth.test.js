import {
    processCallbackCode,
    refreshAccessToken,
    getValidAccessToken,
    disconnectSpotify,
    getAccessToken,
    isLoggedIn,
} from '../spotify/spotifyApi';
import FirebaseService from '../firebase/firebase';
import { auth } from '../firebase/firebaseConfig';

jest.mock('../firebase/firebase', () => ({
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

const mockUser = { uid: 'uid_123', photoURL: null, displayName: null, reload: jest.fn() };

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    auth.currentUser = null;
    global.fetch = jest.fn();
});

afterEach(() => { delete global.fetch; });

// ─── processCallbackCode ──────────────────────────────────────────────────────

describe('processCallbackCode', () => {
    beforeEach(() => {
        localStorage.setItem('code_verifier', 'mock_verifier');
        auth.currentUser = mockUser;
    });

    it('exchanges code for tokens, saves to localStorage, updates Firebase', async () => {
        fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: false }); // profile fetch optional

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
});

// ─── refreshAccessToken ───────────────────────────────────────────────────────

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

// ─── getValidAccessToken ──────────────────────────────────────────────────────

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

// ─── disconnectSpotify ────────────────────────────────────────────────────────

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

// ─── getAccessToken / isLoggedIn ──────────────────────────────────────────────

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
