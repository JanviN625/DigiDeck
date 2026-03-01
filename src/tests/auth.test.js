import { handleCallback, logout } from '../spotify/spotifyAuth';
import FirebaseService from '../firebase/FirebaseService';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase/firebaseConfig';

// Mock dependencies
jest.mock('../firebase/FirebaseService');
jest.mock('../firebase/firebaseConfig', () => ({
    auth: {}
}));
jest.mock('firebase/auth', () => ({
    signInWithCustomToken: jest.fn()
}));

// Mock globals
const mockLocation = new URL('http://127.0.0.1:3000/callback?code=mock_code');
delete window.location;
window.location = mockLocation;

const mockHistory = {
    replaceState: jest.fn()
};
Object.defineProperty(window, 'history', { value: mockHistory });

describe('Authentication Flow Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();

        // Default fetch mock setup
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete global.fetch;
    });

    describe('Success Scenarios', () => {
        it('should handle full authentication flow successfully', async () => {
            // Setup successful mocks
            localStorage.setItem('code_verifier', 'mock_verifier');

            // 1. Spotify Token Exchange
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'mock_spotify_token',
                    refresh_token: 'mock_refresh',
                    expires_in: 3600
                })
            });

            // 2. Spotify Profile Fetch
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'mock_spotify_user_id' })
            });

            // 3. Custom Token Backend Minting
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ firebaseToken: 'mock_firebase_custom_token' })
            });

            signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'mock_spotify_user_id' } });
            FirebaseService.saveSpotifyToken.mockResolvedValueOnce();

            const result = await handleCallback();

            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(3);
            expect(signInWithCustomToken).toHaveBeenCalledWith(auth, 'mock_firebase_custom_token');
            expect(FirebaseService.saveSpotifyToken).toHaveBeenCalled();
            expect(localStorage.getItem('access_token')).toBe('mock_spotify_token');
        });
    });

    describe('Failure Scenarios', () => {
        it('should fail if Spotify code is missing', async () => {
            window.location = new URL('http://127.0.0.1:3000/callback'); // No code
            const result = await handleCallback();
            expect(result).toBe(false);
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should fail if fetch Spotify token fails (400 Bad Request)', async () => {
            window.location = new URL('http://127.0.0.1:3000/callback?code=mock_code');
            localStorage.setItem('code_verifier', 'mock_verifier');

            fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'invalid_grant' })
            });

            const result = await handleCallback();
            expect(result).toBe(false);
            expect(signInWithCustomToken).not.toHaveBeenCalled();
        });

        it('should fail if backend Firebase custom token minting fails', async () => {
            window.location = new URL('http://127.0.0.1:3000/callback?code=mock_code');
            localStorage.setItem('code_verifier', 'mock_verifier');

            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) });
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'user' }) });
            // Backend minting fails
            fetch.mockResolvedValueOnce({ ok: false, text: async () => 'Server error' });

            // Note: We bypass backend check in local dev so we need to set hostname to something else to test failure
            const originalHostname = window.location.hostname;
            Object.defineProperty(window.location, 'hostname', { value: 'production.com', writable: true });

            const result = await handleCallback();
            expect(result).toBe(false);
            expect(signInWithCustomToken).not.toHaveBeenCalled();

            Object.defineProperty(window.location, 'hostname', { value: originalHostname, writable: true });
        });
    });

    describe('Edge Cases', () => {
        it('should bypass backend custom auth failure gracefully when running locally', async () => {
            // When running locally (127.0.0.1), if the backend serverless function is off,
            // it should NOT return false and should just continue to save the tokens directly to emulator
            window.location = new URL('http://127.0.0.1:3000/callback?code=mock_code');
            localStorage.setItem('code_verifier', 'mock_verifier');

            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) });
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'user' }) });

            // Backend minting fails (Vercel dev server not running)
            fetch.mockResolvedValueOnce({ ok: false, text: async () => 'Not found' });

            const result = await handleCallback();

            // It should still succeed locally!
            expect(result).toBe(true);
            expect(signInWithCustomToken).not.toHaveBeenCalled();
            expect(FirebaseService.saveSpotifyToken).toHaveBeenCalled();
        });

        it('should handle logout securely', () => {
            localStorage.setItem('spotify_user_id', 'mock_id');
            localStorage.setItem('access_token', 'mock_token');

            logout();

            expect(FirebaseService.deleteSpotifyToken).toHaveBeenCalledWith('mock_id');
            expect(localStorage.getItem('access_token')).toBeNull();
            expect(localStorage.getItem('spotify_user_id')).toBeNull();
        });
    });
});
