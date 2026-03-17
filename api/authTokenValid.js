const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Replace escaped newlines with actual newlines
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
            })
        });
    } catch (error) {
        console.error('Firebase admin initialization error', error.stack);
    }
}

module.exports = async (req, res) => {
    // CORS setup
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { spotifyToken } = req.body;

    if (!spotifyToken) {
        return res.status(400).json({ error: 'Missing Spotify Token' });
    }

    try {
        // 1. Validate the Spotify token by calling Spotify's /me endpoint
        const spotifyRes = await axios.get('https://api.spotify.com/v1/me', {
            headers: {
                Authorization: `Bearer ${spotifyToken}`
            }
        });

        const userData = spotifyRes.data;
        const spotifyUserId = userData.id;

        if (!spotifyUserId) {
            return res.status(401).json({ error: 'Invalid Spotify Token' });
        }

        // 2. Mint a Firebase Custom Auth Token using the Spotify User ID
        const firebaseToken = await admin.auth().createCustomToken(spotifyUserId);

        // 3. Return the token to the client
        return res.status(200).json({ firebaseToken });

    } catch (error) {
        console.error('Error in /api/auth:', error.response?.data || error.message);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
