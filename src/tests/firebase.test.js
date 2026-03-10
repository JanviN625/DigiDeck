import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, serverTimestamp } from 'firebase/firestore';
import FirebaseService from '../firebase/firebase';
import { db } from '../firebase/firebaseConfig';

jest.mock('../firebase/firebaseConfig', () => ({ db: {}, auth: {} }));

jest.mock('firebase/firestore', () => ({
    doc: jest.fn((_db, ...path) => path.join('/')),
    setDoc: jest.fn(),
    getDoc: jest.fn(),
    collection: jest.fn((_db, ...path) => path.join('/')),
    getDocs: jest.fn(),
    deleteDoc: jest.fn(),
    serverTimestamp: jest.fn(() => 'mock_timestamp'),
}));

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(() => jest.fn()),
    signInWithPopup: jest.fn(),
    GoogleAuthProvider: jest.fn(),
    createUserWithEmailAndPassword: jest.fn(),
    signInWithEmailAndPassword: jest.fn(),
    signOut: jest.fn(),
    updateProfile: jest.fn(),
}));

const USER = 'user_123';

beforeEach(() => {
    jest.clearAllMocks();
    doc.mockImplementation((_db, ...path) => path.join('/'));
    collection.mockImplementation((_db, ...path) => path.join('/'));
    serverTimestamp.mockReturnValue('mock_timestamp');
});

// ─── Spotify Token Management ─────────────────────────────────────────────────

describe('saveSpotifyToken', () => {
    it('writes token data to the correct Firestore path', async () => {
        const tokenData = { access_token: 'tok', refresh_token: 'ref', expires_at: 9999 };
        setDoc.mockResolvedValueOnce();

        await FirebaseService.saveSpotifyToken(USER, tokenData);

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'tokens', 'spotify');
        expect(setDoc).toHaveBeenCalledWith(`users/${USER}/tokens/spotify`, tokenData);
    });
});

describe('getSpotifyToken', () => {
    it('returns token data when the document exists', async () => {
        const tokenData = { access_token: 'tok', refresh_token: 'ref' };
        getDoc.mockResolvedValueOnce({ exists: () => true, data: () => tokenData });

        const result = await FirebaseService.getSpotifyToken(USER);

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'tokens', 'spotify');
        expect(result).toEqual(tokenData);
    });

    it('returns null when the document does not exist', async () => {
        getDoc.mockResolvedValueOnce({ exists: () => false });

        const result = await FirebaseService.getSpotifyToken(USER);

        expect(result).toBeNull();
    });
});

describe('deleteSpotifyToken', () => {
    it('deletes the token document from the correct path', async () => {
        deleteDoc.mockResolvedValueOnce();

        await FirebaseService.deleteSpotifyToken(USER);

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'tokens', 'spotify');
        expect(deleteDoc).toHaveBeenCalledWith(`users/${USER}/tokens/spotify`);
    });
});

// ─── Playlist Management ──────────────────────────────────────────────────────

describe('savePlaylist', () => {
    it('writes playlist data with an updatedAt timestamp', async () => {
        setDoc.mockResolvedValueOnce();
        const data = { name: 'My Mix' };

        await FirebaseService.savePlaylist(USER, 'playlist_1', data);

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'playlists', 'playlist_1');
        expect(setDoc).toHaveBeenCalledWith(
            `users/${USER}/playlists/playlist_1`,
            { ...data, updatedAt: 'mock_timestamp' }
        );
    });
});

describe('loadPlaylist', () => {
    it('returns playlist data with id when the document exists', async () => {
        const data = { name: 'My Mix' };
        getDoc.mockResolvedValueOnce({ exists: () => true, id: 'playlist_1', data: () => data });

        const result = await FirebaseService.loadPlaylist(USER, 'playlist_1');

        expect(result).toEqual({ id: 'playlist_1', ...data });
    });

    it('returns null when the document does not exist', async () => {
        getDoc.mockResolvedValueOnce({ exists: () => false });

        const result = await FirebaseService.loadPlaylist(USER, 'playlist_1');

        expect(result).toBeNull();
    });
});

describe('getUserPlaylists', () => {
    it('returns an array of playlists with their ids', async () => {
        const mockDocs = [
            { id: 'p1', data: () => ({ name: 'Playlist 1' }) },
            { id: 'p2', data: () => ({ name: 'Playlist 2' }) },
        ];
        getDocs.mockResolvedValueOnce({ docs: mockDocs });

        const result = await FirebaseService.getUserPlaylists(USER);

        expect(collection).toHaveBeenCalledWith(db, 'users', USER, 'playlists');
        expect(result).toEqual([
            { id: 'p1', name: 'Playlist 1' },
            { id: 'p2', name: 'Playlist 2' },
        ]);
    });

    it('returns an empty array when no playlists exist', async () => {
        getDocs.mockResolvedValueOnce({ docs: [] });

        const result = await FirebaseService.getUserPlaylists(USER);

        expect(result).toEqual([]);
    });
});

describe('deletePlaylist', () => {
    it('deletes the playlist document from the correct path', async () => {
        deleteDoc.mockResolvedValueOnce();

        await FirebaseService.deletePlaylist(USER, 'playlist_1');

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'playlists', 'playlist_1');
        expect(deleteDoc).toHaveBeenCalledWith(`users/${USER}/playlists/playlist_1`);
    });
});

// ─── Upload Record Management ─────────────────────────────────────────────────

describe('saveUploadRecord', () => {
    it('writes upload data with an uploadedAt timestamp', async () => {
        setDoc.mockResolvedValueOnce();
        const data = { fileName: 'track.mp3' };

        await FirebaseService.saveUploadRecord(USER, 'upload_1', data);

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'uploads', 'upload_1');
        expect(setDoc).toHaveBeenCalledWith(
            `users/${USER}/uploads/upload_1`,
            { ...data, uploadedAt: 'mock_timestamp' }
        );
    });
});

describe('deleteUploadRecord', () => {
    it('deletes the upload document from the correct path', async () => {
        deleteDoc.mockResolvedValueOnce();

        await FirebaseService.deleteUploadRecord(USER, 'upload_1');

        expect(doc).toHaveBeenCalledWith(db, 'users', USER, 'uploads', 'upload_1');
        expect(deleteDoc).toHaveBeenCalledWith(`users/${USER}/uploads/upload_1`);
    });
});
