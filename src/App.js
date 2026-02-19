import './App.css';
import { useSpotifyAuth } from './spotify/useSpotifyAuth';

function App() {
  const { loggedIn, login, logout } = useSpotifyAuth();

  return (
    <div className="App">
      <nav className="navbar">
        <button className="spotify-btn" onClick={loggedIn ? logout : login}>
          {loggedIn ? 'Logout' : 'Login with Spotify'}
        </button>
      </nav>
    </div>
  );
}

export default App;
