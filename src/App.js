import React from 'react';
import Header from './components/Header';
import LibraryPanel from './components/LibraryPanel';
import AIPanel from './components/AIPanel';
import MainWorkspace from './components/MainWorkspace';
import { useSpotifyAuth } from './spotify/useSpotifyAuth';

function App() {
  const { loggedIn, isLoading, profile, login, logout } = useSpotifyAuth();

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen w-full bg-base-900 justify-center items-center font-sans">
        <div className="w-32 h-32 border-8 border-white/20 border-t-white rounded-full animate-spin shadow-lg"></div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="flex flex-col h-screen w-full bg-base-900 text-base-200 justify-center items-center font-sans">
        <div className="bg-base-800 p-10 rounded-xl shadow-2xl border border-base-700 max-w-lg text-center">
          <div className="flex flex-col items-center justify-center gap-4 mb-6">
            <img src="/icon.png" alt="DigiDeck Logo" className="w-16 h-16 object-contain drop-shadow-lg" />
            <h1 className="text-4xl font-extrabold tracking-tight text-base-200">DigiDeck Studio</h1>
          </div>
          <p className="text-base-200 mb-8 opacity-90 leading-relaxed text-lg">
            Welcome to the AI-Enhanced Music Mashup Studio. You must connect your Spotify account to access the application and utilize playback features.
          </p>
          <button
            onClick={login}
            className="w-full py-4 bg-base-500 hover:bg-base-400 text-base-50 font-bold text-lg rounded-full transition-all transform hover:scale-105 shadow-md flex items-center justify-center gap-2"
          >
            Connect with Spotify
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-base-900 text-base-200 overflow-hidden font-sans">
      <Header profile={profile} logout={logout} />
      <div className="flex flex-1 overflow-hidden">
        <LibraryPanel />
        <MainWorkspace />
        <AIPanel />
      </div>
    </div>
  );
}

export default App;
