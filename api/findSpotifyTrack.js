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

    // ── Deterministic pre-check ──────────────────────────────────────────────────
    // Extract the "core" of the query title by stripping everything after the first
    // separator ( – / | or space-dash-space). If a candidate title starts with or
    // contains that core verbatim, it is a reliable match and we return immediately
    // without spending an LLM call. This covers cases like non-Latin script titles
    // where Claude may over-hedge due to post-separator differences (romanizations,
    // artist names, subtitles) that have nothing to do with whether the song matches.
    const titleCore = title.split(/\s*[-–—/|]\s*/)[0].trim();
    if (titleCore.length >= 3) {
        const directIdx = candidates.slice(0, 5).findIndex(c =>
            c.name && (c.name.startsWith(titleCore) || c.name.includes(titleCore))
        );
        if (directIdx !== -1) {
            return res.status(200).json({ result: { index: directIdx } });
        }
    }

    // ── LLM fallback for ambiguous cases ─────────────────────────────────────────
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
            system: `You are a music metadata assistant. A user has an audio file and searched Spotify for it. Given the query (title and optionally artist, BPM, key) plus a numbered list of Spotify search candidates, choose the index of the best-matching candidate.\n\nMatching guidelines:\n- Any segment after a separator in the query title (dash, slash, parenthesis) could represent: the artist name, a romanization or transliteration of the main title, a subtitle, a version descriptor, or other file metadata — do not assume a fixed role; use all context to interpret it\n- If the query title contains native-script characters that appear verbatim in a candidate title, treat that as a strong match signal even if the surrounding text differs\n- Candidate titles may include romanizations, transliterations, alternate-script renderings, or combined native+romanized forms of the same song — these count as matches when the underlying song is the same\n- Subtitle qualifiers, OST or soundtrack labels, remaster or edition tags, featured artist credits, and similar additions do not disqualify a match if the core song identity aligns\n- Artist names may be spelled, romanized, or stylized differently between the query and candidates\n- A karaoke, instrumental, pitch-shifted, or cover version is NOT a match for the original recording\n- If an artist field is provided, use it to break ties between otherwise similar candidates\n\nReturn null only when no candidate is a plausible match. Respond ONLY with valid JSON: {"index": 0} or {"index": null}.`,
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
