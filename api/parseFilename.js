const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            system: `You are a music metadata parser. Given a raw audio filename (without extension), extract the song title and artist name. Files follow many different naming conventions — use context and judgment to determine which segment is the title and which is the artist:\n- Common separator patterns: "Artist - Title", "Title - Artist", underscores as spaces, numbered prefixes (e.g. "01. Title")\n- A segment after a separator could be: the artist name, a romanization or transliteration of the main title, a subtitle, a version label, or a remix credit — do not assume any fixed role based on script alone\n- Non-Latin scripts may appear with a Latin segment that is either the artist name or a phonetic rendering of the same title in another writing system; use all available context to decide\n- Featured artist credits embedded in the name: "feat.", "ft.", "with", "x", "&" between names\n- Parenthetical or bracketed content often contains version info, remix tags, year, or quality labels rather than the primary title or artist\n- Completely opaque filenames (random characters, numeric IDs, hash strings) where no meaningful information can be extracted\nReturn null for any field you cannot determine with reasonable confidence. Respond ONLY with valid JSON: {"title":"...","artist":"..."}.`,
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
