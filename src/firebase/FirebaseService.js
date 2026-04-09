import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  orderBy,
  query,
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
  },

  // ─── Project Save / Load ────────────────────────────────────────────────────

  // Strips audioBlob (raw binary, session-only) before writing to Firestore.
  // All other track fields (audioUrl, spotifyId, segments, EQ, effects, etc.) are preserved.
  async saveProject(uid, projectName, tracks) {
    const id = projectName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'untitled';
    const ref = doc(db, 'users', uid, 'projects', id);
    const serialized = tracks.map(({ audioBlob, ...track }) => track);
    await setDoc(ref, {
      name: projectName.trim() || 'Untitled',
      tracks: serialized,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return id;
  },

  async loadProject(uid, projectId) {
    const ref = doc(db, 'users', uid, 'projects', projectId);
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getUserProjects(uid) {
    const ref = collection(db, 'users', uid, 'projects');
    const q = query(ref, orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async deleteProject(uid, projectId) {
    const ref = doc(db, 'users', uid, 'projects', projectId);
    await deleteDoc(ref);
  },
};

export default FirebaseService;