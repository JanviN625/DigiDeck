import './App.css';
import { useSpotifyAuth } from './spotify/useSpotifyAuth';

function App() {
  const { loggedIn, profile, login, logout } = useSpotifyAuth();

  const avatarUrl = profile?.images?.[0]?.url;

  return (
    <div className="App">
      <nav className="navbar">
        <button className="spotify-btn" onClick={loggedIn ? logout : login}>
          {loggedIn ? 'Logout' : 'Login with Spotify'}
        </button>
      </nav>

      {loggedIn && profile && (
        <div className="profile-card">
          {avatarUrl && (
            <img
              className="profile-avatar"
              src={avatarUrl}
              alt={`${profile.display_name}'s avatar`}
            />
          )}
          <p className="profile-name">Logged in as: {profile.display_name}</p>
        </div>
      )}
    </div>
  );
}

export default App;
