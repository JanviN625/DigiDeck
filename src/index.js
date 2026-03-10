import React from 'react';
import ReactDOM from 'react-dom/client';
import { HeroUIProvider } from "@heroui/react";
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { AppProviders } from './spotify/spotifyContext';

const urlParams = new URLSearchParams(window.location.search);

if (window.opener && urlParams.has('code')) {
  window.opener.postMessage({ type: 'SPOTIFY_AUTH_CALLBACK', search: window.location.search }, '*');
  document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background-color:#0E131F;color:white;font-family:sans-serif;"><h3>Authenticating...</h3></div>';
} else {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <HeroUIProvider>
        <AppProviders>
          <main className="dark text-foreground bg-background">
            <App />
          </main>
        </AppProviders>
      </HeroUIProvider>
    </React.StrictMode>
  );

  reportWebVitals();
}
