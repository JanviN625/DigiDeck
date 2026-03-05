import fetch from 'node-fetch';

async function testPlaylists() {
    const token = process.env.SPOTIFY_TOKEN;
    if (!token) {
        console.error("Please provide SPOTIFY_TOKEN via environment variable");
        return;
    }

    try {
        console.log("Fetching user playlists...");
        const plRes = await fetch(`https://api.spotify.com/v1/me/playlists?limit=2`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const plData = await plRes.json();
        
        console.log("Playlists returned:", plData.items?.length);
        if (plData.items && plData.items.length > 0) {
            console.log("\nPlaylist Object keys:");
            console.log(Object.keys(plData.items[0]));
            
            console.log("\nTracks object:");
            console.log(JSON.stringify(plData.items[0].tracks, null, 2));
        }

    } catch (err) {
        console.error("Error during API test:", err);
    }
}

testPlaylists();
