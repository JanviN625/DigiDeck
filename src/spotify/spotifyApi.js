import FirebaseService from '../firebase/firebase';
import { auth, db } from '../firebase/firebaseConfig';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = process.env.REACT_APP_SPOTIFY_REDIRECT_URI;

const SCOPE = 'user-read-private user-read-email playlist-read-private playlist-read-collaborative user-library-read';

const KEYS = {
  ACCESS_TOKEN: 'access_token',
  CODE_VERIFIER: 'code_verifier',
  EXPIRES_AT: 'spotify_expires_at',
};

// ─── PKCE Helpers (private) ───────────────────────────────────────────────────

const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
};

const sha256 = async (plain) => {
  const data = new TextEncoder().encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
};

const base64encode = (input) =>
  btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function initiateLogin() {
  if (!CLIENT_ID || !REDIRECT_URI) return;

  const codeVerifier = generateRandomString(64);
  const codeChallenge = base64encode(await sha256(codeVerifier));
  window.localStorage.setItem(KEYS.CODE_VERIFIER, codeVerifier);

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPE,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
  }).toString();

  const width = 450, height = 730;
  const popup = window.open(
    authUrl.toString(),
    'Spotify Login',
    `width=${width},height=${height},top=${window.screen.height / 2 - height / 2},left=${window.screen.width / 2 - width / 2}`
  );

  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    alert('Please disable your popup blocker and try connecting to Spotify again.');
    return Promise.reject(new Error('Popup blocked'));
  }

  return new Promise((resolve, reject) => {
    let timer;

    const messageListener = async (event) => {
      if (event.data?.type !== 'SPOTIFY_AUTH_CALLBACK') return;
      window.removeEventListener('message', messageListener);
      if (timer) clearInterval(timer);
      popup?.close();

      const params = new URLSearchParams(event.data.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error || !code) {
        reject(new Error(error || 'No authorization code returned'));
      } else {
        try { resolve(await processCallbackCode(code)); }
        catch (e) { reject(e); }
      }
    };

    window.addEventListener('message', messageListener);

    // Poll to detect if user closed the popup manually
    timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        window.removeEventListener('message', messageListener);
        reject(new Error('Popup closed before authorization'));
      }
    }, 500);
  });
}

export async function processCallbackCode(code) {
  const codeVerifier = localStorage.getItem(KEYS.CODE_VERIFIER);
  if (!codeVerifier) return false;

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) return false;

  const { access_token, refresh_token, expires_in } = await tokenRes.json();
  const expires_at = Date.now() + expires_in * 1000;

  const currentUser = auth.currentUser;
  if (!currentUser) return false;
  const userId = currentUser.uid;

  // MUST save token locally FIRST to prevent race condition with optimistic Firebase snapshot triggers
  localStorage.setItem(KEYS.ACCESS_TOKEN, access_token);
  localStorage.setItem(KEYS.EXPIRES_AT, String(expires_at));
  localStorage.removeItem(KEYS.CODE_VERIFIER);

  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (profileRes.ok) {
    const profileData = await profileRes.json();
    const userRef = doc(db, 'users', userId);

    // Permanent Avatar and Display Name Overwrite
    const updates = {};
    if (!currentUser.photoURL && profileData.images?.[0]?.url) updates.photoURL = profileData.images[0].url;
    if (!currentUser.displayName && profileData.display_name) updates.displayName = profileData.display_name;

    if (Object.keys(updates).length > 0) {
      try {
        await updateProfile(currentUser, updates);
        // Force a token refresh so UI updates instantly see new photo/name via context
        await currentUser.reload();
        // Notify React to re-render the avatar instantly
        window.dispatchEvent(new Event('firebase-profile-updated'));
      } catch (err) {
        console.error('Failed to make permanent profile update', err);
      }
    }

    // Save minimal connection state to DB
    // Doing this AFTER token set so the UI trigger completes successfully
    const dbUpdates = {
      spotify: { spotifyUserId: profileData.id, connectedAt: serverTimestamp() }
    };
    if (updates.photoURL) dbUpdates.avatarUrl = updates.photoURL;
    if (updates.displayName) dbUpdates.displayName = updates.displayName;

    await setDoc(userRef, dbUpdates, { merge: true });
  }

  await FirebaseService.saveSpotifyToken(userId, { access_token, refresh_token, expires_at });
  return true;
}

export async function refreshAccessToken() {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  const userId = currentUser.uid;

  const tokenData = await FirebaseService.getSpotifyToken(userId);
  if (!tokenData?.refresh_token) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token,
      client_id: CLIENT_ID,
    }),
  });

  if (!res.ok) return null;

  const { access_token, refresh_token, expires_in } = await res.json();
  const expires_at = Date.now() + expires_in * 1000;

  await FirebaseService.saveSpotifyToken(userId, {
    access_token,
    refresh_token: refresh_token ?? tokenData.refresh_token,
    expires_at,
  });

  localStorage.setItem(KEYS.ACCESS_TOKEN, access_token);
  localStorage.setItem(KEYS.EXPIRES_AT, String(expires_at));
  return access_token;
}

export async function getValidAccessToken() {
  const expiresAt = parseInt(localStorage.getItem(KEYS.EXPIRES_AT), 10);
  if (!expiresAt || Date.now() >= expiresAt - 60_000) return refreshAccessToken();
  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export async function disconnectSpotify() {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const userId = currentUser.uid;
    await FirebaseService.deleteSpotifyToken(userId);
    await setDoc(doc(db, 'users', userId), { spotify: null }, { merge: true });
  }
  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  localStorage.removeItem(KEYS.CODE_VERIFIER);
  localStorage.removeItem(KEYS.EXPIRES_AT);
}

export const getAccessToken = () => localStorage.getItem(KEYS.ACCESS_TOKEN);
export const isLoggedIn = () => !!getAccessToken();

// ─── API ──────────────────────────────────────────────────────────────────────

// Gate G5 (Spotify API Failure Visibility): throws on any non-2xx response.
// Callers must catch and surface errors.
export async function fetchSpotifyApi(endpoint, options = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('No valid Spotify access token available.');

  const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let message = `Spotify API Error: ${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error?.message) message += ` - ${parsed.error.message}`;
    } catch (e) { }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const getUserPlaylists = (limit = 20, offset = 0) =>
  fetchSpotifyApi(`/me/playlists?limit=${limit}&offset=${offset}`);

export const getPlaylist = (playlistId) =>
  fetchSpotifyApi(`/playlists/${playlistId}`);

export const getPlaylistTracks = (playlistId, limit = 50, offset = 0) =>
  fetchSpotifyApi(`/playlists/${playlistId}/items?limit=${limit}&offset=${offset}`);

export const getSavedTracks = (limit = 20, offset = 0) =>
  fetchSpotifyApi(`/me/tracks?limit=${limit}&offset=${offset}`);

export function searchSpotify(query, types = ['track', 'playlist', 'artist', 'album'], limit = 10) {
  if (!query) return null;
  const typeString = (Array.isArray(types) ? types : [types]).join(',');
  // Spotify's API rejects URL-encoded commas (%2C), so the param string is built manually.
  return fetchSpotifyApi(`/search?q=${encodeURIComponent(query)}&type=${typeString}&limit=${limit}`);
}

// Default export preserves SpotifyContext spread compatibility
const SpotifyService = {
  fetchSpotifyApi,
  getUserPlaylists,
  getPlaylist,
  getPlaylistTracks,
  getSavedTracks,
  searchSpotify,
};

export default SpotifyService;
