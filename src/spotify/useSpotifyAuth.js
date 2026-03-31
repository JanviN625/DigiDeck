import { useState, useEffect, useRef } from 'react';
import {
  handleCallback,
  initiateLogin,
  logout as spotifyLogout,
  isLoggedIn,
  fetchUserProfile,
} from './spotifyAuth';

const SPOTIFY_USER_ID_KEY = 'spotify_user_id';

// PKCE helpers (Spotify docs)
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

export function useSpotifyAuth() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [profile, setProfile] = useState(null);
  const [userId, setUserId] = useState(localStorage.getItem(SPOTIFY_USER_ID_KEY));
  const [isLoading, setIsLoading] = useState(false);
  const callbackRan = useRef(false);

  // Exchange auth code for token on callback
  useEffect(() => {
    const hasCode = new URLSearchParams(window.location.search).has('code');
    if (!hasCode) return;
    if (callbackRan.current) return;
    callbackRan.current = true;
    setIsLoading(true);

    handleCallback().then(success => {
      if (success) {
        setLoggedIn(true);
        setUserId(localStorage.getItem(SPOTIFY_USER_ID_KEY));
      } else {
        console.error('[Spotify Auth] Login failed. Check earlier errors for details.');
      }
      setIsLoading(false);
    });
  }, []);

  // Fetch profile whenever login state becomes true; clear it on logout
  useEffect(() => {
    if (!loggedIn) {
      setProfile(null);
      setUserId(null);
      return;
    }

    fetchUserProfile().then(data => {
      if (data) {
        setProfile(data);
      } else {
        spotifyLogout();
        setLoggedIn(false);
      }
    });
  }, [loggedIn]);

  const login = () => {
    initiateLogin();
  };

  const logout = () => {
    spotifyLogout();
    setLoggedIn(false);
  };

  return { loggedIn, profile, userId, isLoading, login, logout };
}
