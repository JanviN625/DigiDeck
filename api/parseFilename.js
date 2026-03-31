const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.REACT_APP_ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Missing filename' });

    try {
        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 256,
            system: `You are a music metadata parser. Given a raw audio filename (without extension), extract the song title and artist. Handle: binary-encoded filenames (decode binary bytes to ASCII then parse), non-Latin scripts, "Artist - Title" patterns, or completely opaque names. Respond ONLY with valid JSON: {"title":"...","artist":"..."}. Use null for fields you cannot determine with confidence.`,
            messages: [{ role: 'user', content: `Filename: ${filename}` }],
        });
        try {
            const parsed = JSON.parse(response.content[0].text);
            return res.status(200).json({ result: {
                title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : null,
                artist: typeof parsed.artist === 'string' && parsed.artist.trim() ? parsed.artist.trim() : null,
            }});
        } catch {
            return res.status(200).json({ result: null });
        }
    } catch {
        return res.status(200).json({ result: null });
    }
};
