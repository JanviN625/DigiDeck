module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { audioUrl } = req.body;
    if (!audioUrl) return res.status(400).json({ error: 'Missing audioUrl' });

    const apiToken = process.env.AUDD_API_TOKEN || 'test';
    try {
        const params = new URLSearchParams({ url: audioUrl, return: 'spotify', api_token: apiToken });
        const auddRes = await fetch(`https://api.audd.io/?${params}`);
        if (!auddRes.ok) return res.status(200).json({ result: null });
        const data = await auddRes.json();
        if (data.status !== 'success' || !data.result) return res.status(200).json({ result: null });
        const r = data.result;
        return res.status(200).json({ result: {
            title: r.title || null,
            artist: r.artist || null,
            spotifyTrackId: r.spotify?.id || null,
            albumArt: r.spotify?.album?.images?.[0]?.url || null,
        }});
    } catch {
        return res.status(200).json({ result: null });
    }
};
