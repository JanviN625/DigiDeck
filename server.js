require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const express = require('express');
const app = express();

app.use(express.json({ limit: '64kb' }));

app.use('/api/aiChat', require('./api/aiChat'));
app.use('/api/authTokenValid', require('./api/authTokenValid'));
app.use('/api/identifyTrack', require('./api/identifyTrack'));
app.use('/api/parseFilename', require('./api/parseFilename'));

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
    console.log(`API server running at http://127.0.0.1:${PORT}`);
});
