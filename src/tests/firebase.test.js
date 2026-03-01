import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import FirebaseService from '../firebase/FirebaseService';
import { db } from '../firebase/firebaseConfig';

// Mock Firebase Firestore
jest.mock('firebase/firestore', () => ({
    doc: jest.fn(),
    setDoc: jest.fn(),
    getDoc: jest.fn(),
    collection: jest.fn(),
    getDocs: jest.fn(),
    deleteDoc: jest.fn(),
    serverTimestamp: jest.fn(() => 'mock_timestamp')
}));

jest.mock('../firebase/firebaseConfig', () => ({
    db: {}
}));

describe('FirebaseService Authentication Tests', () => {
    const mockUserId = 'spotify_123';
    const mockTokenData = {
        access_token: 'mock_access',
        refresh_token: 'mock_refresh',
        expires_at: 123456789
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Default doc setup
        doc.mockImplementation((db, ...pathArgs) => pathArgs.join('/'));
    });

    describe('Spotify Token Management', () => {
        it('should save Spotify tokens securely to the correct user document path', async () => {
            setDoc.mockResolvedValueOnce();

            await FirebaseService.saveSpotifyToken(mockUserId, mockTokenData);

            expect(doc).toHaveBeenCalledWith(db, 'users', mockUserId, 'tokens', 'spotify');
            expect(setDoc).toHaveBeenCalledWith('users/spotify_123/tokens/spotify', mockTokenData);
        });

        it('should retrieve existing Spotify tokens from the correct path', async () => {
            getDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => mockTokenData
            });

            const result = await FirebaseService.getSpotifyToken(mockUserId);

            expect(doc).toHaveBeenCalledWith(db, 'users', mockUserId, 'tokens', 'spotify');
            expect(getDoc).toHaveBeenCalledWith('users/spotify_123/tokens/spotify');
            expect(result).toEqual(mockTokenData);
        });

        it('should return null if user does not have a saved token', async () => {
            getDoc.mockResolvedValueOnce({
                exists: () => false
            });

            const result = await FirebaseService.getSpotifyToken(mockUserId);

            expect(getDoc).toHaveBeenCalledWith('users/spotify_123/tokens/spotify');
            expect(result).toBeNull();
        });

        it('should completely delete the Spotify token record upon logout or request', async () => {
            deleteDoc.mockResolvedValueOnce();

            await FirebaseService.deleteSpotifyToken(mockUserId);

            expect(doc).toHaveBeenCalledWith(db, 'users', mockUserId, 'tokens', 'spotify');
            expect(deleteDoc).toHaveBeenCalledWith('users/spotify_123/tokens/spotify');
        });
    });
});
