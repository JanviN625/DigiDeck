import FirebaseService, { useFirebaseAuth } from '../firebase/firebase';
import {
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile,
    updateEmail,
} from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { renderHook, act } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../firebase/firebaseConfig', () => ({ auth: {}, db: {}, storage: {} }));

jest.mock('firebase/firestore', () => ({
    doc: jest.fn((_db, ...path) => path.join('/')),
    getDoc: jest.fn(),
    setDoc: jest.fn(),
    getDocs: jest.fn(),
    collection: jest.fn((_db, ...path) => path.join('/')),
    deleteDoc: jest.fn(),
    serverTimestamp: jest.fn(() => 'mock_timestamp'),
}));

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
    signInWithPopup: jest.fn(),
    GoogleAuthProvider: jest.fn().mockImplementation(() => ({})),
    createUserWithEmailAndPassword: jest.fn(),
    signInWithEmailAndPassword: jest.fn(),
    signOut: jest.fn(),
    updateProfile: jest.fn(),
    updateEmail: jest.fn(),
}));

jest.mock('firebase/storage', () => ({
    ref: jest.fn(),
    uploadBytes: jest.fn(),
    getDownloadURL: jest.fn(),
    deleteObject: jest.fn(),
}));

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const USER = 'user_123';

const mockUser = {
    uid: 'uid_123',
    email: 'test@test.com',
    displayName: 'Test User',
    photoURL: null,
};

let capturedAuthCallback;

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
    // resetMocks:true (react-scripts) clears inline jest.fn() implementations — restore here.
    const { doc, serverTimestamp, collection } = require('firebase/firestore');
    doc.mockImplementation((_db, ...path) => path.join('/'));
    collection.mockImplementation((_db, ...path) => path.join('/'));
    serverTimestamp.mockReturnValue('mock_timestamp');
    const { onAuthStateChanged } = require('firebase/auth');
    onAuthStateChanged.mockImplementation((auth, cb) => {
        capturedAuthCallback = cb;
        return jest.fn();
    });

    const { ref, uploadBytes, getDownloadURL, deleteObject } = require('firebase/storage');
    ref.mockImplementation((_storage, path) => path);
    uploadBytes.mockResolvedValue({});
    getDownloadURL.mockResolvedValue('https://storage.example/avatar.jpg');
    deleteObject.mockResolvedValue();
});

// ─── FirebaseService — Spotify Token Management ───────────────────────────────

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

// ─── FirebaseService — Playlist Management ────────────────────────────────────

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

// ─── useFirebaseAuth — Initial State ─────────────────────────────────────────

describe('useFirebaseAuth — initial state', () => {
    it('starts with user null and loading true', () => {
        const { result } = renderHook(() => useFirebaseAuth());

        expect(result.current.user).toBeNull();
        expect(result.current.loading).toBe(true);
    });
});

// ─── useFirebaseAuth — Auth State Changes ────────────────────────────────────

describe('useFirebaseAuth — new user', () => {
    it('creates a full user document in Firestore on first login', async () => {
        getDoc.mockResolvedValueOnce({ exists: () => false });
        setDoc.mockResolvedValueOnce();

        renderHook(() => useFirebaseAuth());

        await act(async () => { await capturedAuthCallback(mockUser); });

        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            expect.objectContaining({
                uid: mockUser.uid,
                email: mockUser.email,
                displayName: mockUser.displayName,
                spotify: null,
                createdAt: 'mock_timestamp',
                lastLoginAt: 'mock_timestamp',
            })
        );
    });

    it('sets loading to false and user after the document is created', async () => {
        getDoc.mockResolvedValueOnce({ exists: () => false });
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await capturedAuthCallback(mockUser); });

        expect(result.current.user).toEqual(mockUser);
        expect(result.current.loading).toBe(false);
    });
});

describe('useFirebaseAuth — returning user', () => {
    it('only updates lastLoginAt on subsequent logins', async () => {
        getDoc.mockResolvedValueOnce({ exists: () => true });
        setDoc.mockResolvedValueOnce();

        renderHook(() => useFirebaseAuth());

        await act(async () => { await capturedAuthCallback(mockUser); });

        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            { lastLoginAt: 'mock_timestamp' },
            { merge: true }
        );
        expect(setDoc).toHaveBeenCalledTimes(1);
    });

    it('also writes avatarUrl to Firestore when the returning user has a photoURL', async () => {
        const userWithPhoto = { ...mockUser, photoURL: 'https://photo.example' };
        getDoc.mockResolvedValueOnce({ exists: () => true });
        setDoc.mockResolvedValueOnce();

        renderHook(() => useFirebaseAuth());

        await act(async () => { await capturedAuthCallback(userWithPhoto); });

        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            expect.objectContaining({ lastLoginAt: 'mock_timestamp', avatarUrl: 'https://photo.example' }),
            { merge: true }
        );
    });
});

describe('useFirebaseAuth — signed out', () => {
    it('sets user to null and loading to false when no user', async () => {
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await capturedAuthCallback(null); });

        expect(result.current.user).toBeNull();
        expect(result.current.loading).toBe(false);
    });
});

// ─── useFirebaseAuth — Login Methods ─────────────────────────────────────────

describe('useFirebaseAuth — loginWithGoogle', () => {
    it('calls signInWithPopup with a GoogleAuthProvider instance', async () => {
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await result.current.loginWithGoogle(); });

        expect(signInWithPopup).toHaveBeenCalledTimes(1);
    });

    it('propagates errors thrown by signInWithPopup', async () => {
        signInWithPopup.mockRejectedValueOnce(new Error('popup_closed'));
        const { result } = renderHook(() => useFirebaseAuth());

        await expect(act(async () => {
            await result.current.loginWithGoogle();
        })).rejects.toThrow('popup_closed');
    });
});

describe('useFirebaseAuth — loginWithEmail', () => {
    it('calls signInWithEmailAndPassword with the provided credentials', async () => {
        signInWithEmailAndPassword.mockResolvedValueOnce({ user: mockUser });
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await result.current.loginWithEmail('test@test.com', 'password'); });

        expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, 'test@test.com', 'password');
    });

    it('propagates auth errors (e.g. wrong password)', async () => {
        signInWithEmailAndPassword.mockRejectedValueOnce(new Error('auth/wrong-password'));
        const { result } = renderHook(() => useFirebaseAuth());

        await expect(act(async () => {
            await result.current.loginWithEmail('test@test.com', 'wrong');
        })).rejects.toThrow('auth/wrong-password');
    });
});

describe('useFirebaseAuth — signUpWithEmail', () => {
    it('creates a user and updates profile when displayName is provided', async () => {
        createUserWithEmailAndPassword.mockResolvedValueOnce({ user: mockUser });
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => {
            await result.current.signUpWithEmail('test@test.com', 'password', 'Test User');
        });

        expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({}, 'test@test.com', 'password');
        expect(updateProfile).toHaveBeenCalledWith(mockUser, { displayName: 'Test User' });
        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            { displayName: 'Test User' },
            { merge: true }
        );
    });

    it('skips profile update when no displayName is provided', async () => {
        createUserWithEmailAndPassword.mockResolvedValueOnce({ user: mockUser });
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => {
            await result.current.signUpWithEmail('test@test.com', 'password');
        });

        expect(updateProfile).not.toHaveBeenCalled();
        expect(setDoc).not.toHaveBeenCalled();
    });
});

describe('useFirebaseAuth — signOut', () => {
    it('calls firebaseSignOut', async () => {
        signOut.mockResolvedValueOnce();
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await result.current.signOut(); });

        expect(signOut).toHaveBeenCalledTimes(1);
    });
});

// ─── useFirebaseAuth — Profile Update Event ──────────────────────────────────

describe('useFirebaseAuth — firebase-profile-updated event', () => {
    it('calls reload() and refreshes user state when the event fires', async () => {
        const { auth } = require('../firebase/firebaseConfig');
        const reloadMock = jest.fn().mockResolvedValue(undefined);
        auth.currentUser = { ...mockUser, displayName: 'Updated Name', reload: reloadMock };

        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => {
            window.dispatchEvent(new Event('firebase-profile-updated'));
        });

        expect(reloadMock).toHaveBeenCalledTimes(1);
        expect(result.current.user.displayName).toBe('Updated Name');
    });

    it('does nothing when auth.currentUser is null when the event fires', async () => {
        const { auth } = require('../firebase/firebaseConfig');
        auth.currentUser = null;

        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => {
            window.dispatchEvent(new Event('firebase-profile-updated'));
        });

        expect(result.current.user).toBeNull();
    });
});

// ─── useFirebaseAuth — updateDisplayName ─────────────────────────────────────

describe('useFirebaseAuth — updateDisplayName', () => {
    beforeEach(() => {
        const { auth } = require('../firebase/firebaseConfig');
        auth.currentUser = { uid: mockUser.uid, reload: jest.fn().mockResolvedValue(undefined) };
    });

    it('calls updateProfile with the new display name', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateDisplayName('New Name'); });

        expect(updateProfile).toHaveBeenCalledWith(
            expect.objectContaining({ uid: mockUser.uid }),
            { displayName: 'New Name' }
        );
    });

    it('writes the new name to Firestore with merge', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateDisplayName('New Name'); });

        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            { displayName: 'New Name' },
            { merge: true }
        );
    });

    it('dispatches firebase-profile-updated event', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();
        const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateDisplayName('Name'); });

        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'firebase-profile-updated' }));
        dispatchSpy.mockRestore();
    });
});

// ─── useFirebaseAuth — updateProfilePhoto ────────────────────────────────────

describe('useFirebaseAuth — updateProfilePhoto', () => {
    beforeEach(() => {
        const { auth } = require('../firebase/firebaseConfig');
        auth.currentUser = { uid: mockUser.uid, reload: jest.fn().mockResolvedValue(undefined) };
    });

    it('throws when file exceeds 5 MB', async () => {
        const { result } = renderHook(() => useFirebaseAuth());
        const bigFile = { size: 6 * 1024 * 1024 };

        await expect(act(async () => {
            await result.current.updateProfilePhoto(bigFile);
        })).rejects.toThrow('Image must be smaller than 5 MB.');
    });

    it('uploads to the correct storage path', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();
        const { ref, uploadBytes } = require('firebase/storage');
        const smallFile = { size: 1 * 1024 * 1024 };

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateProfilePhoto(smallFile); });

        expect(ref).toHaveBeenCalledWith({}, `avatars/${mockUser.uid}/profile`);
        expect(uploadBytes).toHaveBeenCalledTimes(1);
    });

    it('updates Firebase Auth profile with the download URL', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();
        const smallFile = { size: 1 * 1024 * 1024 };

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateProfilePhoto(smallFile); });

        expect(updateProfile).toHaveBeenCalledWith(
            expect.anything(),
            { photoURL: 'https://storage.example/avatar.jpg' }
        );
    });

    it('returns the photo URL', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();
        const smallFile = { size: 1 * 1024 * 1024 };

        const { result } = renderHook(() => useFirebaseAuth());
        let url;
        await act(async () => { url = await result.current.updateProfilePhoto(smallFile); });

        expect(url).toBe('https://storage.example/avatar.jpg');
    });
});

// ─── useFirebaseAuth — removeProfilePhoto ────────────────────────────────────

describe('useFirebaseAuth — removeProfilePhoto', () => {
    beforeEach(() => {
        const { auth } = require('../firebase/firebaseConfig');
        auth.currentUser = { uid: mockUser.uid, reload: jest.fn().mockResolvedValue(undefined) };
    });

    it('attempts to delete the storage file', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();
        const { deleteObject } = require('firebase/storage');

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.removeProfilePhoto(); });

        expect(deleteObject).toHaveBeenCalledTimes(1);
    });

    it('still completes even if the storage file does not exist', async () => {
        const { deleteObject } = require('firebase/storage');
        deleteObject.mockRejectedValueOnce(new Error('storage/object-not-found'));
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await expect(act(async () => {
            await result.current.removeProfilePhoto();
        })).resolves.not.toThrow();
    });

    it('sets photoURL to null in Firebase Auth', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.removeProfilePhoto(); });

        expect(updateProfile).toHaveBeenCalledWith(
            expect.anything(),
            { photoURL: null }
        );
    });

    it('sets avatarUrl to null in Firestore', async () => {
        updateProfile.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.removeProfilePhoto(); });

        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            { avatarUrl: null },
            { merge: true }
        );
    });
});

// ─── useFirebaseAuth — updateUserEmail ───────────────────────────────────────

describe('useFirebaseAuth — updateUserEmail', () => {
    beforeEach(() => {
        const { auth } = require('../firebase/firebaseConfig');
        auth.currentUser = { uid: mockUser.uid, email: mockUser.email, reload: jest.fn().mockResolvedValue(undefined) };
    });

    it('calls updateEmail with the new address', async () => {
        updateEmail.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateUserEmail('new@example.com'); });

        expect(updateEmail).toHaveBeenCalledWith(
            expect.objectContaining({ uid: mockUser.uid }),
            'new@example.com'
        );
    });

    it('writes the new email to Firestore with merge', async () => {
        updateEmail.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateUserEmail('new@example.com'); });

        expect(setDoc).toHaveBeenCalledWith(
            `users/${mockUser.uid}`,
            { email: 'new@example.com' },
            { merge: true }
        );
    });

    it('dispatches firebase-profile-updated event on success', async () => {
        updateEmail.mockResolvedValueOnce();
        setDoc.mockResolvedValueOnce();
        const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

        const { result } = renderHook(() => useFirebaseAuth());
        await act(async () => { await result.current.updateUserEmail('new@example.com'); });

        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'firebase-profile-updated' }));
        dispatchSpy.mockRestore();
    });

    it('propagates errors thrown by updateEmail', async () => {
        updateEmail.mockRejectedValueOnce(Object.assign(new Error('requires-recent-login'), { code: 'auth/requires-recent-login' }));

        const { result } = renderHook(() => useFirebaseAuth());
        await expect(act(async () => {
            await result.current.updateUserEmail('new@example.com');
        })).rejects.toThrow('requires-recent-login');
    });
});
