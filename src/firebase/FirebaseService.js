import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db } from './firebaseConfig';

const FirebaseService = {
  async savePlaylist(spotifyUserId, playlistId, playlistData) {
    const ref = doc(db, 'users', spotifyUserId, 'playlists', playlistId);
    await setDoc(ref, {
      ...playlistData,
      updatedAt: serverTimestamp()
    });
  },

  async loadPlaylist(spotifyUserId, playlistId) {
    const ref = doc(db, 'users', spotifyUserId, 'playlists', playlistId);
    const snapshot = await getDoc(ref);
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  },

  async getUserPlaylists(spotifyUserId) {
    const ref = collection(db, 'users', spotifyUserId, 'playlists');
    const snapshot = await getDocs(ref);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async deletePlaylist(spotifyUserId, playlistId) {
    const ref = doc(db, 'users', spotifyUserId, 'playlists', playlistId);
    await deleteDoc(ref);
  },

  async saveSpotifyToken(spotifyUserId, tokenData) {
    const ref = doc(db, 'users', spotifyUserId, 'tokens', 'spotify');
    await setDoc(ref, tokenData);
  },

  async getSpotifyToken(spotifyUserId) {
    const ref = doc(db, 'users', spotifyUserId, 'tokens', 'spotify');
    const snapshot = await getDoc(ref);
    return snapshot.exists() ? snapshot.data() : null;
  },

  async deleteSpotifyToken(spotifyUserId) {
    const ref = doc(db, 'users', spotifyUserId, 'tokens', 'spotify');
    await deleteDoc(ref);
  }
};

export default FirebaseService;