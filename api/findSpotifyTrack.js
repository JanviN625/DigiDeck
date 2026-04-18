const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { title, artist, bpm, trackKey, candidates } = req.body;
    if (!title) return res.status(400).json({ error: 'Missing title' });
    if (!Array.isArray(candidates) || candidates.length === 0) return res.status(400).json({ error: 'Missing candidates' });

    const candidateList = candidates.slice(0, 5).map((t, i) => {
        const artistStr = (t.artists || []).map(a => a.name).join(', ');
        return `[${i}] "${t.name}" – ${artistStr}`;
    }).join('\n');

    let queryLine = `Title: "${title}"`;
    if (artist) queryLine += `\nArtist: "${artist}"`;
    if (typeof bpm === 'number') queryLine += `\nBPM ≈ ${bpm}`;
    if (trackKey) queryLine += `\nKey: ${trackKey}`;

    const userMessage = `${queryLine}\n\nCandidates:\n${candidateList}`;

    try {
        const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 64,
            system: `You are a music metadata assistant. A user has an audio file and searched Spotify for it. Given the user's known title (and optionally artist, BPM, key), plus a numbered list of Spotify search candidates, choose the index of the best-matching candidate. Consider: non-Latin and romanized titles, soundtrack/OST variants, subtitle qualifiers, remaster or deluxe edition suffixes, alternate artist name spellings, and transliterations. Only pick a candidate if you are confident it is the same song — return null if uncertain. Respond ONLY with valid JSON: {"index": 0} or {"index": null}.`,
            messages: [{ role: 'user', content: userMessage }],
        });
        try {
            const parsed = JSON.parse(response.content[0].text);
            const idx = parsed.index;
            if (idx === null || (Number.isInteger(idx) && idx >= 0 && idx < candidates.length)) {
                return res.status(200).json({ result: { index: idx } });
            }
            return res.status(200).json({ result: { index: null } });
        } catch {
            return res.status(200).json({ result: { index: null } });
        }
    } catch {
        return res.status(200).json({ result: { index: null } });
    }
};
