import { getValidAccessToken } from './spotifyAuth';

/**
 * Helper to fetch from Spotify API with the current access token.
 * 
 * In accordance with Design V1.1 Gate G5 (Spotify API Failure Visibility), 
 * this function will NOT fail silently. It throws an explicit error on any 
 * non-2xx response. The calling component or service must catch and surface this error.
 */
export async function fetchSpotifyApi(endpoint, options = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('No valid Spotify access token available.');
  }

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
    // Gate G5 enforcement: throw an error on non-2xx status
    const errorBody = await response.text();
    let message = `Spotify API Error: ${response.status} ${response.statusText}`;
    try {
        const parsed = JSON.parse(errorBody);
        if (parsed.error && parsed.error.message) {
            message += ` - ${parsed.error.message}`;
        }
    } catch (e) {
        // Body was not JSON, ignore
    }
    
    throw new Error(message);
  }

  // Handle 204 No Content
  if (response.status === 204) {
      return null;
  }

  return response.json();
}

/**
 * Fetches the current user's playlists.
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<Object>}
 */
export async function getUserPlaylists(limit = 20, offset = 0) {
    return fetchSpotifyApi(`/me/playlists?limit=${limit}&offset=${offset}`);
}
  
/**
 * Fetches details for a specific playlist.
 * @param {string} playlistId 
 * @returns {Promise<Object>}
 */
export async function getPlaylist(playlistId) {
    return fetchSpotifyApi(`/playlists/${playlistId}`);
}
  
/**
 * Fetches tracks within a specific playlist.
 * @param {string} playlistId 
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<Object>}
 */
export async function getPlaylistTracks(playlistId, limit = 50, offset = 0) {
    return fetchSpotifyApi(`/playlists/${playlistId}/items?limit=${limit}&offset=${offset}`);
}

/**
 * Fetches the user's "Liked Songs".
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<Object>}
 */
export async function getSavedTracks(limit = 20, offset = 0) {
    return fetchSpotifyApi(`/me/tracks?limit=${limit}&offset=${offset}`);
}

/**
 * Performs a catalog search (Design F16).
 * @param {string} query 
 * @param {Array<string>} types 
 * @param {number} limit 
 * @returns {Promise<Object>}
 */
export async function searchSpotify(query, types = ['track', 'playlist', 'artist', 'album'], limit = 10) {
    if (!query) return null;
    const typeArray = Array.isArray(types) ? types : [types];
    const typeString = typeArray.join(',');
    const encodedQuery = encodeURIComponent(query);
    
    // Spotify's API does not like it when the type comma is URL-encoded as %2C 
    // by URLSearchParams, so we concatenate the param string manually.
    return fetchSpotifyApi(`/search?q=${encodedQuery}&type=${typeString}&limit=${limit}`);
}

/**
 * Fetches Spotify's external ML AI recommendations (Design F10).
 * Included here per Design V1.1 (RF3, G2). 
 * The return from this function should be gated by Gate G2 
 * (Recommendation Count Boundary) by the caller.
 * 
 * @param {Array<string>} seedTracks Array of Spotify track IDs (max 5)
 * @param {number} targetBpm 
 * @param {number} targetKey Spotify pitch class integer
 * @param {number} limit Default 10
 * @returns {Promise<Object>}
 */
export async function getRecommendations(seedTracks, targetBpm, targetKey, limit = 10) {
    if (!seedTracks || seedTracks.length === 0) {
        throw new Error("seedTracks is required for getRecommendations");
    }
    
    const seeds = seedTracks.slice(0, 5).join(','); // Spotify API hard limit is 5 seeds
    
    const params = new URLSearchParams();
    if (seeds) params.append('seed_tracks', seeds);
    if (limit) params.append('limit', String(limit));

    if (targetBpm !== undefined && targetBpm !== null && targetBpm !== '[BPM]') {
        params.append('target_tempo', String(targetBpm));
    }

    if (targetKey !== undefined && targetKey !== null && targetKey !== '[key]') {
        params.append('target_key', String(targetKey));
    }

    return fetchSpotifyApi(`/recommendations?${params.toString()}`);
}

/**
 * Fetches the audio features (BPM, Key, etc.) for a specific track.
 * @param {string} trackId 
 * @returns {Promise<Object>}
 */
export async function getAudioFeatures(trackId) {
    if (!trackId) return null;
    return fetchSpotifyApi(`/audio-features/${trackId}`);
}

/**
 * Fetches the audio features for multiple tracks.
 * @param {Array<string>} trackIds (Max 100)
 * @returns {Promise<Object>}
 */
export async function getMultipleAudioFeatures(trackIds) {
    if (!trackIds || trackIds.length === 0) return null;
    
    // API limits to 100 max
    const idsString = trackIds.slice(0, 100).join(',');
    return fetchSpotifyApi(`/audio-features?ids=${idsString}`);
}

/**
 * Commands the Spotify Web Player to play a specific track on a specific device
 * @param {string} spotifyUri The Spotify URI of the track (e.g. spotify:track:xxxxx)
 * @param {string} deviceId The Web Playback SDK device ID
 * @returns {Promise<void>}
 */
export async function playTrack(spotifyUri, deviceId) {
    if (!spotifyUri || !deviceId) return;

    return fetchSpotifyApi(`/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [spotifyUri] })
    });
}

const SpotifyService = {
  fetchSpotifyApi,
  getUserPlaylists,
  getPlaylist,
  getPlaylistTracks,
  getSavedTracks,
  searchSpotify,
  getRecommendations,
  getAudioFeatures,
  getMultipleAudioFeatures,
  playTrack,
};

export default SpotifyService;
