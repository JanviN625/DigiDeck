import { useState, useEffect } from 'react';
import {
  signInWithPopup,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  updateEmail,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from './firebaseConfig';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const userRef = (userId, ...path) => doc(db, 'users', userId, ...path);

export const AUTH_ERRORS = {
  'auth/wrong-password':        'Current password is incorrect.',
  'auth/invalid-credential':    'Current password is incorrect.',
  'auth/too-many-requests':     'Too many attempts. Please try again later.',
  'auth/email-already-in-use':  'That email is already in use.',
  'auth/requires-recent-login': 'Please sign out and back in to make this change.',
};

export const friendlyError = (err) => AUTH_ERRORS[err.code] || err.message || 'Update failed.';

// ─── FirebaseService ──────────────────────────────────────────────────────────

const FirebaseService = {
  async savePlaylist(userId, playlistId, playlistData) {
    await setDoc(userRef(userId, 'playlists', playlistId), {
      ...playlistData,
      updatedAt: serverTimestamp(),
    });
  },

  async loadPlaylist(userId, playlistId) {
    const snapshot = await getDoc(userRef(userId, 'playlists', playlistId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },

  async getUserPlaylists(userId) {
    const snapshot = await getDocs(collection(db, 'users', userId, 'playlists'));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async deletePlaylist(userId, playlistId) {
    await deleteDoc(userRef(userId, 'playlists', playlistId));
  },

  async saveSpotifyToken(userId, tokenData) {
    await setDoc(userRef(userId, 'tokens', 'spotify'), tokenData);
  },

  async getSpotifyToken(userId) {
    const snapshot = await getDoc(userRef(userId, 'tokens', 'spotify'));
    return snapshot.exists() ? snapshot.data() : null;
  },

  async deleteSpotifyToken(userId) {
    await deleteDoc(userRef(userId, 'tokens', 'spotify'));
  },

};

export default FirebaseService;

// ─── useFirebaseAuth ──────────────────────────────────────────────────────────

export const useFirebaseAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (currentUser) {
          const ref = userRef(currentUser.uid);
          const userSnap = await getDoc(ref);

          if (!userSnap.exists()) {
            await setDoc(ref, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName || null,
              avatarUrl: currentUser.photoURL || null,
              createdAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
              spotify: null,
            });
          } else {
            // Update lastLoginAt on consecutive logins
            const dbUpdates = { lastLoginAt: serverTimestamp() };
            // Ensure Google Auth photo priority is respected
            if (currentUser.photoURL) dbUpdates.avatarUrl = currentUser.photoURL;
            await setDoc(ref, dbUpdates, { merge: true });
          }
          setUser(currentUser);
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('[Firebase] Auth state handler error:', err);
        if (currentUser) setUser(currentUser);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleProfileUpdate = async () => {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        // Explicitly map getters since Object.assign() ignores prototype getters
        setUser({
          ...auth.currentUser,
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
          displayName: auth.currentUser.displayName,
          photoURL: auth.currentUser.photoURL
        });
      }
    };

    window.addEventListener('firebase-profile-updated', handleProfileUpdate);
    return () => {
      window.removeEventListener('firebase-profile-updated', handleProfileUpdate);
    };
  }, []);

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  };

  const loginWithEmail = async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email, password, displayName) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(user, { displayName });
      // Update Firestore immediately so displayName is present before onAuthStateChanged fires
      await setDoc(userRef(user.uid), { displayName }, { merge: true });
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const updateDisplayName = async (newDisplayName) => {
    const uid = auth.currentUser.uid;
    await updateProfile(auth.currentUser, { displayName: newDisplayName });
    await setDoc(userRef(uid), { displayName: newDisplayName }, { merge: true });
    window.dispatchEvent(new Event('firebase-profile-updated'));
  };

  const updateProfilePhoto = async (file) => {
    if (file.size > 5 * 1024 * 1024) throw new Error('Image must be smaller than 5 MB.');
    const uid = auth.currentUser.uid;
    const storageRef = ref(storage, `avatars/${uid}/profile`);
    await uploadBytes(storageRef, file);
    const photoURL = await getDownloadURL(storageRef);
    await updateProfile(auth.currentUser, { photoURL });
    await setDoc(userRef(uid), { avatarUrl: photoURL }, { merge: true });
    window.dispatchEvent(new Event('firebase-profile-updated'));
    return photoURL;
  };

  const removeProfilePhoto = async () => {
    const uid = auth.currentUser.uid;
    try {
      await deleteObject(ref(storage, `avatars/${uid}/profile`));
    } catch {}
    await updateProfile(auth.currentUser, { photoURL: null });
    await setDoc(userRef(uid), { avatarUrl: null }, { merge: true });
    window.dispatchEvent(new Event('firebase-profile-updated'));
  };

  const updateUserEmail = async (newEmail) => {
    const currentUser = auth.currentUser;
    await updateEmail(currentUser, newEmail);
    await setDoc(userRef(currentUser.uid), { email: newEmail }, { merge: true });
    window.dispatchEvent(new Event('firebase-profile-updated'));
  };

  return {
    user, loading, loginWithGoogle, loginWithEmail, signUpWithEmail, signOut,
    updateDisplayName, updateProfilePhoto, removeProfilePhoto,
    updateUserEmail,
  };
};
