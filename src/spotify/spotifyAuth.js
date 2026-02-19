const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = process.env.REACT_APP_SPOTIFY_REDIRECT_URI;

const SCOPE = 'user-read-private user-read-email';

const KEYS = {
  ACCESS_TOKEN: 'access_token',
  CODE_VERIFIER: 'code_verifier',
};

// --- PKCE helpers (per Spotify docs) ---

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

// --- Public API ---

export async function initiateLogin() {
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
    console.error('[Spotify Auth] Code verifier missing — cannot complete login.');
    return false;
  }

  const url = 'https://accounts.spotify.com/api/token';
  const payload = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  };

  const body = await fetch(url, payload);

  if (!body.ok) {
    const err = await body.json();
    console.error('[Spotify Auth] Token exchange failed:', err);
    return false;
  }

  const response = await body.json();
  localStorage.setItem(KEYS.ACCESS_TOKEN, response.access_token);
  localStorage.removeItem(KEYS.CODE_VERIFIER);

  window.history.replaceState({}, document.title, window.location.pathname);

  console.log('[Spotify Auth] Login successful. Access token stored.');
  return true;
}

export function logout() {
  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  console.log('[Spotify Auth] Logout successful. Token cleared.');
}

export function getAccessToken() {
  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export function isLoggedIn() {
  return !!getAccessToken();
}
