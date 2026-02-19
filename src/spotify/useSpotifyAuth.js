import { useState, useEffect } from 'react';
import {
  handleCallback,
  initiateLogin,
  logout as spotifyLogout,
  isLoggedIn,
} from './spotifyAuth';

export function useSpotifyAuth() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());

  useEffect(() => {
    const hasCode = new URLSearchParams(window.location.search).has('code');
    if (!hasCode) return;

    handleCallback().then(success => {
      if (success) {
        setLoggedIn(true);
        console.log('[Spotify Auth] Login successful. User is now logged in.');
      } else {
        console.error('[Spotify Auth] Login failed. Check earlier errors for details.');
      }
    });
  }, []);

  const login = () => {
    console.log('[Spotify Auth] Redirecting to Spotify login...');
    initiateLogin();
  };

  const logout = () => {
    spotifyLogout();
    setLoggedIn(false);
    console.log('[Spotify Auth] Logout successful. User is now logged out.');
  };

  return { loggedIn, login, logout };
}
