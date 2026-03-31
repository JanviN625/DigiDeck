import FirebaseService from '../firebase/FirebaseService';
import { auth } from '../firebase/firebaseConfig';
import { signInWithCustomToken } from 'firebase/auth';

const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = process.env.REACT_APP_SPOTIFY_REDIRECT_URI;

const SCOPE = 'user-read-private user-read-email'; // Definitely need more scopes, add later

const KEYS = {
  ACCESS_TOKEN: 'access_token',
  CODE_VERIFIER: 'code_verifier',
  EXPIRES_AT: 'spotify_expires_at',
  USER_ID: 'spotify_user_id',
};

// Helper functions for PKCE flow (Spotify docs)
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
};

const sha256 = async (plain) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
};

const base64encode = (input) => {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

export async function initiateLogin() {
  if (!CLIENT_ID) {
    console.error('REACT_APP_SPOTIFY_CLIENT_ID is undefined.');
    return;
  }
  if (!REDIRECT_URI) {
    console.error('REACT_APP_SPOTIFY_REDIRECT_URI is undefined.');
    return;
  }

  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

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

  window.location.href = authUrl.toString();
}

export async function handleCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  if (error) {
    console.error('[Spotify Auth] Authorization denied:', error);
    return false;
  }

  if (!code) return false;

  const codeVerifier = localStorage.getItem(KEYS.CODE_VERIFIER);

  if (!codeVerifier) {
    console.error('[Spotify Auth] Code verifier missing (login and callback origins must match -> 127.0.0.1 not localhost).');
    return false;
  }

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

  if (!tokenRes.ok) {
    console.error('[Spotify Auth] Token exchange failed:', await tokenRes.json());
    return false;
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();
  const expires_at = Date.now() + expires_in * 1000;

  // Fetch user ID to key Firebase document
  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!profileRes.ok) {
    console.error('[Spotify Auth] Failed to fetch user ID after token exchange.');
    return false;
  }

  const { id: userId } = await profileRes.json();

  // ----- Authenticate with Firebase via Custom Token -----
  try {
    const authRes = await fetch('/api/authTokenValid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotifyToken: access_token })
    });

    if (!authRes.ok) {
      console.error('[Firebase Auth] Failed to get Firebase custom token:', await authRes.text());
      if (window.location.hostname !== '127.0.0.1') return false;
    } else {
      const { firebaseToken } = await authRes.json();
      await signInWithCustomToken(auth, firebaseToken);
    }
  } catch (error) {
    console.error('[Firebase Auth] Firebase login failed', error);
    if (window.location.hostname !== '127.0.0.1') return false;
  }
  // -------------------------------------------------------

  await FirebaseService.saveSpotifyToken(userId, { access_token, refresh_token, expires_at });

  localStorage.setItem(KEYS.ACCESS_TOKEN, access_token);
  localStorage.setItem(KEYS.EXPIRES_AT, String(expires_at));
  localStorage.setItem(KEYS.USER_ID, userId);
  localStorage.removeItem(KEYS.CODE_VERIFIER);

  window.history.replaceState({}, document.title, window.location.pathname);

  return true;
}

export async function refreshAccessToken() {
  const userId = localStorage.getItem(KEYS.USER_ID);
  if (!userId) return null;

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

  if (!res.ok) {
    console.error('[Spotify Auth] Token refresh failed:', await res.json());
    return null;
  }

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
  const isExpired = !expiresAt || Date.now() >= expiresAt - 60_000;

  if (isExpired) return refreshAccessToken();

  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export function logout() {
  const userId = localStorage.getItem(KEYS.USER_ID);
  if (userId) FirebaseService.deleteSpotifyToken(userId);

  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  localStorage.removeItem(KEYS.CODE_VERIFIER);
  localStorage.removeItem(KEYS.EXPIRES_AT);
  localStorage.removeItem(KEYS.USER_ID);
}

export function getAccessToken() {
  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export function isLoggedIn() {
  return !!getAccessToken();
}

export async function fetchUserProfile() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error('[Spotify Auth] Failed to fetch user profile:', response.status);
    return null;
  }

  return response.json();
}
