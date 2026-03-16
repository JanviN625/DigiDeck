/**
 * aiPrompt.test.js
 *
 * Verifies the system prompt sent to the AI API accurately represents the
 * app's controls and constraints. No real API calls are made — fetch is
 * intercepted and the request body is inspected.
 *
 * All tests use the proxy path (/api/aiChat) so the body exposes
 * `systemPrompt` directly.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIPanel from '../components/AIPanel';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../firebase/firebase', () => ({
    useFirebaseAuth: jest.fn(),
}));

jest.mock('../spotify/appContext', () => ({
    useMix: jest.fn(),
}));

jest.mock('@heroui/react', () => ({
    Avatar: ({ name, icon, classNames, ...rest }) => (
        <div data-testid="avatar" {...rest}>{name ?? 'icon'}</div>
    ),
    ScrollShadow: ({ children, className, ...rest }) => (
        <div className={className} {...rest}>{children}</div>
    ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders AIPanel with given tracks, sends one message, waits for fetch. */
const setupAndSend = async (tracks = [], message = 'test') => {
    const { useFirebaseAuth } = require('../firebase/firebase');
    const { useMix } = require('../spotify/appContext');
    useFirebaseAuth.mockReturnValue({
        user: { displayName: 'User', email: 'u@test.com', photoURL: null },
    });
    useMix.mockReturnValue({ tracks });

    render(<AIPanel />);
    await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
    fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
        target: { value: message },
    });
    fireEvent.click(screen.getByTitle('Send'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
};

/** Reads systemPrompt from the most recent /api/aiChat fetch call. */
const getPrompt = () => {
    const calls = global.fetch.mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1].body);
    return body.systemPrompt;
};

/** Reads the full request body from the most recent fetch call. */
const getBody = () => {
    const calls = global.fetch.mock.calls;
    return JSON.parse(calls[calls.length - 1][1].body);
};

// ─── Base track fixture ───────────────────────────────────────────────────────

const makeTrack = (overrides = {}) => ({
    audioUrl: 'track.mp3',
    title: 'Test Track',
    artistName: 'Test Artist',
    bpm: 128,
    trackKey: 'C major',
    energy: 0.80,
    isLocal: false,
    initialSegments: [],
    ...overrides,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ content: 'ok' }),
        })
    );
    // Ensure proxy path is used (no direct API key)
    delete process.env.REACT_APP_ANTHROPIC_API_KEY;
});

// ─── Empty mix ────────────────────────────────────────────────────────────────

describe('system prompt — empty mix', () => {
    it('mentions "empty" when no tracks loaded', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toMatch(/empty/i);
    });

    it('still includes APP_CAPABILITIES when mix is empty', async () => {
        await setupAndSend([]);
        const p = getPrompt();
        expect(p).toContain('Speed');
        expect(p).toContain('EQ');
        expect(p).toContain('Pitch');
    });

    it('does not include "Current mix" section when mix is empty', async () => {
        await setupAndSend([]);
        expect(getPrompt()).not.toContain('Current mix');
    });
});

// ─── BPM constraint ───────────────────────────────────────────────────────────

describe('system prompt — BPM constraint', () => {
    it('marks BPM as READ-ONLY / DISPLAY ONLY', async () => {
        await setupAndSend([makeTrack()]);
        expect(getPrompt()).toMatch(/READ-ONLY|DISPLAY ONLY/i);
    });

    it('includes the track\'s actual BPM value', async () => {
        await setupAndSend([makeTrack({ bpm: 140 })]);
        expect(getPrompt()).toContain('140');
    });

    it('includes "(analysing…)" when BPM is null', async () => {
        await setupAndSend([makeTrack({ bpm: null })]);
        expect(getPrompt()).toContain('(analysing…)');
    });

    it('rules tell AI not to instruct user to change BPM', async () => {
        await setupAndSend([makeTrack()]);
        expect(getPrompt()).toMatch(/BPM is read-only/i);
    });

    it('rules direct AI to recommend Speed instead of BPM changes', async () => {
        await setupAndSend([makeTrack()]);
        expect(getPrompt()).toMatch(/Speed/);
    });
});

// ─── Speed constraint ─────────────────────────────────────────────────────────

describe('system prompt — speed constraint', () => {
    it('states minimum speed as 0.25', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('0.25');
    });

    it('states maximum speed as 2.00', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('2.00');
    });

    it('describes speed as continuous (not fixed presets)', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toMatch(/continuous/i);
    });

    it('includes BPM calculation formula in rules', async () => {
        await setupAndSend([makeTrack()]);
        expect(getPrompt()).toMatch(/target BPM|BPM.*÷/i);
    });
});

// ─── EQ constraints ───────────────────────────────────────────────────────────

describe('system prompt — EQ constraint', () => {
    it('states EQ lower bound as –12 dB', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('–12');
    });

    it('states EQ upper bound as +12 dB', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('+12');
    });

    it('mentions Low shelf band (200 Hz)', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('200 Hz');
    });

    it('mentions Mid peaking band (1 kHz)', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('1 kHz');
    });

    it('mentions High shelf band (8 kHz)', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('8 kHz');
    });

    it('mentions EQ step size of 0.5 dB', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('0.5 dB');
    });

    it('mentions kill switch for full cuts', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toMatch(/kill/i);
    });
});

// ─── Pitch constraint ─────────────────────────────────────────────────────────

describe('system prompt — pitch constraint', () => {
    it('recommends staying within ±3 semitones', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toContain('±3');
    });

    it('mentions semitone steps', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toMatch(/semitone/i);
    });

    it('notes quality degrades beyond ±3', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toMatch(/degrad/i);
    });
});

// ─── Effects constraints ──────────────────────────────────────────────────────

describe('system prompt — effects constraints', () => {
    it('includes reverb with mix range 0–1', async () => {
        await setupAndSend([]);
        const p = getPrompt();
        expect(p).toContain('reverb');
        expect(p).toMatch(/mix 0–1/);
    });

    it('includes delay with time, feedback, mix params', async () => {
        await setupAndSend([]);
        const p = getPrompt();
        expect(p).toContain('delay');
        expect(p).toContain('feedback');
        expect(p).toContain('time');
    });

    it('includes compressor with threshold and ratio', async () => {
        await setupAndSend([]);
        const p = getPrompt();
        expect(p).toContain('compressor');
        expect(p).toContain('threshold');
        expect(p).toContain('ratio');
    });

    it('includes highpass and lowpass filters', async () => {
        await setupAndSend([]);
        const p = getPrompt();
        expect(p).toContain('highpass');
        expect(p).toContain('lowpass');
    });

    it('includes panner with –1 to +1 range', async () => {
        await setupAndSend([]);
        const p = getPrompt();
        expect(p).toContain('panner');
        expect(p).toMatch(/–1.*\+1|\+1.*–1/);
    });

    it('states volume gain range 0–2.0×', async () => {
        await setupAndSend([]);
        expect(getPrompt()).toMatch(/gain 0–2\.0/);
    });
});

// ─── Track data in prompt ─────────────────────────────────────────────────────

describe('system prompt — track data', () => {
    it('includes track title', async () => {
        await setupAndSend([makeTrack({ title: 'Blue Monday' })]);
        expect(getPrompt()).toContain('Blue Monday');
    });

    it('includes artist name', async () => {
        await setupAndSend([makeTrack({ artistName: 'New Order' })]);
        expect(getPrompt()).toContain('New Order');
    });

    it('includes BPM value', async () => {
        await setupAndSend([makeTrack({ bpm: 132 })]);
        expect(getPrompt()).toContain('132');
    });

    it('includes key', async () => {
        await setupAndSend([makeTrack({ trackKey: 'D minor' })]);
        expect(getPrompt()).toContain('D minor');
    });

    it('includes Camelot position for known key', async () => {
        // D minor → 7A in Camelot wheel
        await setupAndSend([makeTrack({ trackKey: 'D minor' })]);
        expect(getPrompt()).toContain('7A');
    });

    it('includes Camelot position for C major (8B)', async () => {
        await setupAndSend([makeTrack({ trackKey: 'C major' })]);
        expect(getPrompt()).toContain('8B');
    });

    it('includes energy value', async () => {
        await setupAndSend([makeTrack({ energy: 0.72 })]);
        expect(getPrompt()).toContain('0.72');
    });

    it('labels Spotify preview source', async () => {
        await setupAndSend([makeTrack({ isLocal: false })]);
        expect(getPrompt()).toContain('Spotify preview');
    });

    it('labels uploaded file source', async () => {
        await setupAndSend([makeTrack({ isLocal: true })]);
        expect(getPrompt()).toContain('uploaded file');
    });

    it('includes "Current mix" section when tracks exist', async () => {
        await setupAndSend([makeTrack()]);
        expect(getPrompt()).toContain('Current mix');
    });

    it('tracks without audioUrl or spotifyId are excluded', async () => {
        // Track has neither audioUrl nor spotifyId
        await setupAndSend([{ title: 'Ghost', bpm: 100 }]);
        // Should fall back to empty mix prompt
        expect(getPrompt()).toMatch(/empty/i);
    });
});

// ─── Segment data in prompt ───────────────────────────────────────────────────

describe('system prompt — segment data', () => {
    it('includes segment pitch value', async () => {
        const track = makeTrack({
            initialSegments: [{
                startPct: 0, endPct: 1, pitch: 2, speed: 1.0,
                fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0, effects: [],
            }],
        });
        await setupAndSend([track]);
        expect(getPrompt()).toContain('+2 st');
    });

    it('includes segment speed value', async () => {
        const track = makeTrack({
            initialSegments: [{
                startPct: 0, endPct: 1, pitch: 0, speed: 1.5,
                fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0, effects: [],
            }],
        });
        await setupAndSend([track]);
        expect(getPrompt()).toContain('1.5x');
    });

    it('includes fade in duration when set', async () => {
        const track = makeTrack({
            initialSegments: [{
                startPct: 0, endPct: 1, pitch: 0, speed: 1.0,
                fadeIn: 3, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0, effects: [],
            }],
        });
        await setupAndSend([track]);
        expect(getPrompt()).toContain('3s');
    });

    it('includes active effect in segment data', async () => {
        const track = makeTrack({
            initialSegments: [{
                startPct: 0, endPct: 1, pitch: 0, speed: 1.0,
                fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0,
                effects: [{ type: 'reverb', enabled: true, params: { mix: 0.3 } }],
            }],
        });
        await setupAndSend([track]);
        expect(getPrompt()).toContain('reverb');
        expect(getPrompt()).toContain('mix=0.3');
    });

    it('lists disabled effects separately', async () => {
        const track = makeTrack({
            initialSegments: [{
                startPct: 0, endPct: 1, pitch: 0, speed: 1.0,
                fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0,
                effects: [{ type: 'delay', enabled: false, params: { time: 0.25, feedback: 0.3, mix: 0.5 } }],
            }],
        });
        await setupAndSend([track]);
        expect(getPrompt()).toContain('disabled');
        expect(getPrompt()).toContain('delay');
    });

    it('shows range label for multi-segment tracks', async () => {
        const track = makeTrack({
            initialSegments: [
                { startPct: 0, endPct: 0.5, pitch: 0, speed: 1.0, fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0, effects: [] },
                { startPct: 0.5, endPct: 1.0, pitch: 1, speed: 1.25, fadeIn: 0, fadeOut: 0, eqLow: 0, eqMid: 0, eqHigh: 0, effects: [] },
            ],
        });
        await setupAndSend([track]);
        // Segment ranges shown as percentages
        expect(getPrompt()).toContain('0%–50%');
        expect(getPrompt()).toContain('50%–100%');
    });
});

// ─── API call parameters ──────────────────────────────────────────────────────

describe('API call parameters', () => {
    it('calls /api/aiChat proxy when no direct API key set', async () => {
        await setupAndSend([], 'hello');
        expect(global.fetch).toHaveBeenCalledWith('/api/aiChat', expect.any(Object));
    });

    it('sends messages as an array', async () => {
        await setupAndSend([], 'hello');
        expect(Array.isArray(getBody().messages)).toBe(true);
    });

    it('first message in payload has role "user"', async () => {
        await setupAndSend([], 'hello');
        const msgs = getBody().messages;
        expect(msgs[0].role).toBe('user');
    });

    it('caps messages at 20 when chat history is long', async () => {
        // Pre-populate a chat with 30 messages (mix of user/assistant)
        const messages = Array.from({ length: 30 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `msg ${i}`,
        }));
        const chats = [{ id: 1, title: 'Big', messages, createdAt: Date.now() }];
        localStorage.setItem('digideck-ai-chats', JSON.stringify(chats));
        localStorage.setItem('digideck-active-chat-id', '1');

        const { useFirebaseAuth } = require('../firebase/firebase');
        const { useMix } = require('../spotify/appContext');
        useFirebaseAuth.mockReturnValue({ user: { displayName: 'U', email: 'u@t.com', photoURL: null } });
        useMix.mockReturnValue({ tracks: [] });

        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: 'new message' },
        });
        fireEvent.click(screen.getByTitle('Send'));
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());

        expect(getBody().messages.length).toBeLessThanOrEqual(20);
    });

    it('includes systemPrompt in request body', async () => {
        await setupAndSend([], 'hello');
        expect(typeof getBody().systemPrompt).toBe('string');
        expect(getBody().systemPrompt.length).toBeGreaterThan(0);
    });
});
