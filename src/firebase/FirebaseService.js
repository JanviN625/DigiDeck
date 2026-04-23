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
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebaseConfig';

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

  // ─── Slot-Based Project Save / Load (5 fixed slots per user) ────────────────

  // slotId: 'slot_1' … 'slot_5'
  // projectData: { projectName, tracks (audioBlob stripped), masterBpm, globalZoom,
  //                libraryCollapsed, aiCollapsed }
  // isNewSlot: true when writing to an empty slot for the first time (adds createdAt)
  async saveProjectSlot(uid, slotId, projectData, isNewSlot) {
    const ref = doc(db, 'users', uid, 'projectSlots', slotId);
    const { tracks = [], ...rest } = projectData;
    
    const serialized = await Promise.all(tracks.map(async (track) => {
      const { audioBlob, ...restTrack } = track;
      if (audioBlob) {
        const fileRef = storageRef(storage, `users/${uid}/projectSlots/${slotId}/${track.id}.wav`);
        await uploadBytes(fileRef, audioBlob);
        const url = await getDownloadURL(fileRef);
        return { ...restTrack, audioUrl: url };
      }
      return restTrack;
    }));

    const data = {
      ...rest,
      tracks: serialized,
      updatedAt: serverTimestamp(),
    };
    if (isNewSlot) data.createdAt = serverTimestamp();
    await setDoc(ref, data);
  },

  // Returns an array of 5 entries (index 0 = slot_1 … index 4 = slot_5).
  // Each entry is either the saved project data object (with an `id` field) or null if the slot is empty.
  async getProjectSlots(uid) {
    const slotIds = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5'];
    const refs = slotIds.map(id => doc(db, 'users', uid, 'projectSlots', id));
    const snaps = await Promise.all(refs.map(r => getDoc(r)));
    return snaps.map((snap, i) =>
      snap.exists() ? { id: slotIds[i], ...snap.data() } : null
    );
  },

  async deleteProjectSlot(uid, slotId) {
    const ref = doc(db, 'users', uid, 'projectSlots', slotId);
    await deleteDoc(ref);
  },
};

export default FirebaseService;