const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.REACT_APP_ANTHROPIC_API_KEY });

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

    const { messages, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid messages array' });
    }

    try {
        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 1024,
            system: systemPrompt || 'You are a DJ assistant for DigiDeck, a music mashup studio.',
            messages: messages.slice(-20),
        });

        return res.status(200).json({ content: response.content[0].text });
    } catch (error) {
        console.error('Error in /api/aiChat:', error.message);
        if (error instanceof Anthropic.AuthenticationError) {
            return res.status(401).json({ error: 'Invalid API key' });
        }
        if (error instanceof Anthropic.RateLimitError) {
            return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
        }
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
