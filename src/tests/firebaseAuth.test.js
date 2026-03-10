import { renderHook, act, waitFor } from '@testing-library/react';
import { useFirebaseAuth } from '../firebase/firebase';
import {
    onAuthStateChanged,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let capturedAuthCallback;

jest.mock('../firebase/firebaseConfig', () => ({ auth: {}, db: {} }));

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
    signInWithPopup: jest.fn(),
    GoogleAuthProvider: jest.fn().mockImplementation(() => ({})),
    createUserWithEmailAndPassword: jest.fn(),
    signInWithEmailAndPassword: jest.fn(),
    signOut: jest.fn(),
    updateProfile: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
    doc: jest.fn((_db, ...path) => path.join('/')),
    getDoc: jest.fn(),
    setDoc: jest.fn(),
    serverTimestamp: jest.fn(() => 'mock_timestamp'),
    getDocs: jest.fn(),
    collection: jest.fn(),
    deleteDoc: jest.fn(),
}));

const mockUser = {
    uid: 'uid_123',
    email: 'test@test.com',
    displayName: 'Test User',
    photoURL: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
    onAuthStateChanged.mockImplementation((auth, cb) => {
        capturedAuthCallback = cb;
        return jest.fn();
    });
});

// ─── Initial State ────────────────────────────────────────────────────────────

describe('initial state', () => {
    it('starts with user null and loading true', () => {
        const { result } = renderHook(() => useFirebaseAuth());

        expect(result.current.user).toBeNull();
        expect(result.current.loading).toBe(true);
    });
});

// ─── Auth State Changes ───────────────────────────────────────────────────────

describe('onAuthStateChanged — new user', () => {
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

describe('onAuthStateChanged — returning user', () => {
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
});

describe('onAuthStateChanged — signed out', () => {
    it('sets user to null and loading to false when no user', async () => {
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await capturedAuthCallback(null); });

        expect(result.current.user).toBeNull();
        expect(result.current.loading).toBe(false);
    });
});

// ─── Login Methods ────────────────────────────────────────────────────────────

describe('loginWithGoogle', () => {
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

describe('loginWithEmail', () => {
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

describe('signUpWithEmail', () => {
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

describe('signOut', () => {
    it('calls firebaseSignOut', async () => {
        signOut.mockResolvedValueOnce();
        const { result } = renderHook(() => useFirebaseAuth());

        await act(async () => { await result.current.signOut(); });

        expect(signOut).toHaveBeenCalledTimes(1);
    });
});
