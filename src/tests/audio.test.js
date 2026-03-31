// ─── soundtouchjs mock (hoisted before imports) ───────────────────────────────

jest.mock('soundtouchjs', () => ({
    SoundTouch: jest.fn(() => ({
        pitchSemitones: 0,
        tempo: 1.0,
        clear: jest.fn(),
    })),
    SimpleFilter: jest.fn(() => ({
        sourcePosition: 0,
        extract: jest.fn(() => 0),
    })),
    getWebAudioNode: jest.fn(() => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
        onaudioprocess: null,
    })),
    WebAudioBufferSource: jest.fn(() => ({ position: 0 })),
}));

// ─── AudioEngine helpers ──────────────────────────────────────────────────────

const createNode = (extras = {}) => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    gain: {
        value: 0,
        cancelScheduledValues: jest.fn(),
        setValueAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
    },
    frequency: { value: 0 },
    type: '',
    fftSize: 256,
    buffer: null,
    delayTime: { value: 0 },
    threshold: { value: -24 },
    ratio: { value: 4 },
    knee: { value: 10 },
    attack: { value: 0.003 },
    release: { value: 0.25 },
    pan: { value: 0 },
    start: jest.fn(),
    stop: jest.fn(),
    onended: null,
    ...extras,
});

const createMockBuffer = (duration = 2, sampleRate = 44100) => {
    const length = Math.floor(duration * sampleRate);
    return {
        numberOfChannels: 2,
        length,
        sampleRate,
        duration,
        getChannelData: jest.fn(() => new Float32Array(length)),
    };
};

const createOfflineCtx = (sampleRate = 44100) => ({
    sampleRate,
    destination: createNode(),
    createGain: jest.fn(() => createNode()),
    createBiquadFilter: jest.fn(() => createNode()),
    createConvolver: jest.fn(() => createNode()),
    createDelay: jest.fn(() => createNode()),
    createDynamicsCompressor: jest.fn(() => createNode()),
    createStereoPanner: jest.fn(() => createNode()),
    createBufferSource: jest.fn(() => createNode()),
    startRendering: jest.fn().mockResolvedValue(createMockBuffer(2, sampleRate)),
});

// ─── EssentiaAnalyzer helpers ─────────────────────────────────────────────────

let mockWorkerInstance = null;

class MockWorker {
    constructor(url) {
        this.url = url;
        this.postMessage = jest.fn();
        this.terminate = jest.fn();
        this.onmessage = null;
        this.onerror = null;
        mockWorkerInstance = this;
    }
}

// ─── AudioEngine ──────────────────────────────────────────────────────────────

describe('AudioEngine', () => {
    let AudioEngine;
    let audioBufferToWAV;
    let mockCtx;

    beforeEach(() => {
        jest.resetModules();

        mockCtx = {
            sampleRate: 44100,
            currentTime: 0,
            state: 'running',
            destination: createNode(),
            createGain: jest.fn(() => createNode()),
            createBiquadFilter: jest.fn(() => createNode()),
            createAnalyser: jest.fn(() => createNode()),
            createConvolver: jest.fn(() => createNode()),
            createDelay: jest.fn(() => createNode()),
            createDynamicsCompressor: jest.fn(() => createNode()),
            createStereoPanner: jest.fn(() => createNode()),
            createBuffer: jest.fn((channels, length, sr) => createMockBuffer(length / sr, sr)),
            createBufferSource: jest.fn(() => createNode()),
            resume: jest.fn().mockResolvedValue(undefined),
        };

        global.AudioContext = jest.fn(() => mockCtx);
        global.webkitAudioContext = undefined;
        global.OfflineAudioContext = jest.fn((channels, length, sr) => createOfflineCtx(sr));

        const mod = require('../audio/AudioEngine');
        AudioEngine = mod.default;
        audioBufferToWAV = mod.audioBufferToWAV;
    });

    // ─── loadTrack ──────────────────────────────────────────────────────────────

    describe('loadTrack', () => {
        it('registers a track in the internal map', async () => {
            const buf = createMockBuffer();
            await AudioEngine.loadTrack('t1', buf);
            expect(AudioEngine.tracks.has('t1')).toBe(true);
        });

        it('stores the provided AudioBuffer on the track entry', async () => {
            const buf = createMockBuffer();
            await AudioEngine.loadTrack('t1', buf);
            expect(AudioEngine.tracks.get('t1').audioBuffer).toBe(buf);
        });

        it('creates the full EQ + gain + analyser node chain', async () => {
            const buf = createMockBuffer();
            await AudioEngine.loadTrack('t1', buf);
            const track = AudioEngine.tracks.get('t1');
            expect(track.eqLow).toBeDefined();
            expect(track.eqMid).toBeDefined();
            expect(track.eqHigh).toBeDefined();
            expect(track.gain).toBeDefined();
            expect(track.analyser).toBeDefined();
        });

        it('unloads an existing track before re-loading the same id', async () => {
            const buf1 = createMockBuffer(1);
            const buf2 = createMockBuffer(3);
            await AudioEngine.loadTrack('t1', buf1);
            await AudioEngine.loadTrack('t1', buf2);
            expect(AudioEngine.tracks.get('t1').audioBuffer).toBe(buf2);
        });

        it('starts with isPlaying false, pauseTime 0, targetVolume 1', async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
            const track = AudioEngine.tracks.get('t1');
            expect(track.isPlaying).toBe(false);
            expect(track.pauseTime).toBe(0);
            expect(track.targetVolume).toBe(1.0);
        });
    });

    // ─── play ───────────────────────────────────────────────────────────────────

    describe('play', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('sets isPlaying to true', () => {
            AudioEngine.play('t1');
            expect(AudioEngine.tracks.get('t1').isPlaying).toBe(true);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.play('nonexistent')).not.toThrow();
        });

        it('does nothing when track is already playing', () => {
            AudioEngine.play('t1');
            const connectCallsBefore = mockCtx.createBiquadFilter.mock.calls.length;
            AudioEngine.play('t1');
            expect(mockCtx.createBiquadFilter.mock.calls.length).toBe(connectCallsBefore);
        });

        it('calls ctx.resume() when AudioContext is suspended', () => {
            mockCtx.state = 'suspended';
            AudioEngine.play('t1');
            expect(mockCtx.resume).toHaveBeenCalledTimes(1);
        });

        it('does not call resume when context is already running', () => {
            mockCtx.state = 'running';
            AudioEngine.play('t1');
            expect(mockCtx.resume).not.toHaveBeenCalled();
        });
    });

    // ─── pause ──────────────────────────────────────────────────────────────────

    describe('pause', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
            AudioEngine.play('t1');
        });

        it('sets isPlaying to false', () => {
            AudioEngine.pause('t1');
            expect(AudioEngine.tracks.get('t1').isPlaying).toBe(false);
        });

        it('does nothing when track is already paused', () => {
            AudioEngine.pause('t1');
            expect(() => AudioEngine.pause('t1')).not.toThrow();
            expect(AudioEngine.tracks.get('t1').isPlaying).toBe(false);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.pause('nonexistent')).not.toThrow();
        });

        it('nullifies stNode after pausing', () => {
            AudioEngine.pause('t1');
            expect(AudioEngine.tracks.get('t1').stNode).toBeNull();
        });
    });

    // ─── seek ───────────────────────────────────────────────────────────────────

    describe('seek', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('sets pauseTime when the track is not playing', () => {
            AudioEngine.seek('t1', 10);
            expect(AudioEngine.tracks.get('t1').pauseTime).toBe(10);
        });

        it('resumes playback after seeking while playing', () => {
            AudioEngine.play('t1');
            AudioEngine.seek('t1', 5);
            expect(AudioEngine.tracks.get('t1').isPlaying).toBe(true);
            expect(AudioEngine.tracks.get('t1').pauseTime).toBe(5);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.seek('nonexistent', 5)).not.toThrow();
        });

        it('accepts 0 as a valid seek position', () => {
            AudioEngine.seek('t1', 0);
            expect(AudioEngine.tracks.get('t1').pauseTime).toBe(0);
        });
    });

    // ─── setVolume ──────────────────────────────────────────────────────────────

    describe('setVolume', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('updates targetVolume on the track entry', () => {
            AudioEngine.setVolume('t1', 0.5);
            expect(AudioEngine.tracks.get('t1').targetVolume).toBe(0.5);
        });

        it('calls gain.gain.setValueAtTime with the new volume', () => {
            AudioEngine.setVolume('t1', 0.75);
            const gainNode = AudioEngine.tracks.get('t1').gain;
            expect(gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.75, mockCtx.currentTime);
        });

        it('cancels any previously scheduled gain values', () => {
            AudioEngine.setVolume('t1', 0.3);
            const gainNode = AudioEngine.tracks.get('t1').gain;
            expect(gainNode.gain.cancelScheduledValues).toHaveBeenCalled();
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.setVolume('nonexistent', 0.5)).not.toThrow();
        });
    });

    // ─── setPitch ───────────────────────────────────────────────────────────────

    describe('setPitch', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('sets soundTouch.pitchSemitones on the track', () => {
            AudioEngine.setPitch('t1', 3);
            expect(AudioEngine.tracks.get('t1').soundTouch.pitchSemitones).toBe(3);
        });

        it('accepts negative semitone values', () => {
            AudioEngine.setPitch('t1', -5);
            expect(AudioEngine.tracks.get('t1').soundTouch.pitchSemitones).toBe(-5);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.setPitch('nonexistent', 2)).not.toThrow();
        });
    });

    // ─── setSpeed ───────────────────────────────────────────────────────────────

    describe('setSpeed', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('sets soundTouch.tempo on the track', () => {
            AudioEngine.setSpeed('t1', 1.5);
            expect(AudioEngine.tracks.get('t1').soundTouch.tempo).toBe(1.5);
        });

        it('accepts sub-1 multipliers', () => {
            AudioEngine.setSpeed('t1', 0.5);
            expect(AudioEngine.tracks.get('t1').soundTouch.tempo).toBe(0.5);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.setSpeed('nonexistent', 1.5)).not.toThrow();
        });
    });

    // ─── setEQ ──────────────────────────────────────────────────────────────────

    describe('setEQ', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('sets eqLow gain', () => {
            AudioEngine.setEQ('t1', { low: 6, mid: 0, high: 0 });
            expect(AudioEngine.tracks.get('t1').eqLow.gain.value).toBe(6);
        });

        it('sets eqMid gain', () => {
            AudioEngine.setEQ('t1', { low: 0, mid: -3, high: 0 });
            expect(AudioEngine.tracks.get('t1').eqMid.gain.value).toBe(-3);
        });

        it('sets eqHigh gain', () => {
            AudioEngine.setEQ('t1', { low: 0, mid: 0, high: 9 });
            expect(AudioEngine.tracks.get('t1').eqHigh.gain.value).toBe(9);
        });

        it('defaults all bands to 0 when values are omitted', () => {
            AudioEngine.setEQ('t1', {});
            const { eqLow, eqMid, eqHigh } = AudioEngine.tracks.get('t1');
            expect(eqLow.gain.value).toBe(0);
            expect(eqMid.gain.value).toBe(0);
            expect(eqHigh.gain.value).toBe(0);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.setEQ('nonexistent', { low: 1 })).not.toThrow();
        });
    });

    // ─── addEffect ──────────────────────────────────────────────────────────────

    describe('addEffect', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('returns an effectId (number) on success', () => {
            const id = AudioEngine.addEffect('t1', 'reverb');
            expect(typeof id).toBe('number');
        });

        it('appends a reverb effect to the effects array', () => {
            AudioEngine.addEffect('t1', 'reverb');
            const effects = AudioEngine.tracks.get('t1').effects;
            expect(effects).toHaveLength(1);
            expect(effects[0].type).toBe('reverb');
        });

        it('appends a delay effect with correct default params', () => {
            AudioEngine.addEffect('t1', 'delay');
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.type).toBe('delay');
            expect(eff.params.time).toBe(0.25);
            expect(eff.params.feedback).toBe(0.3);
        });

        it('appends a compressor effect with correct default params', () => {
            AudioEngine.addEffect('t1', 'compressor');
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.type).toBe('compressor');
            expect(eff.params.threshold).toBe(-24);
            expect(eff.params.ratio).toBe(4);
        });

        it('appends a volume effect', () => {
            AudioEngine.addEffect('t1', 'volume');
            expect(AudioEngine.tracks.get('t1').effects[0].type).toBe('volume');
        });

        it('appends a highpass effect', () => {
            AudioEngine.addEffect('t1', 'highpass');
            expect(AudioEngine.tracks.get('t1').effects[0].type).toBe('highpass');
        });

        it('appends a lowpass effect', () => {
            AudioEngine.addEffect('t1', 'lowpass');
            expect(AudioEngine.tracks.get('t1').effects[0].type).toBe('lowpass');
        });

        it('appends a panner effect', () => {
            AudioEngine.addEffect('t1', 'panner');
            expect(AudioEngine.tracks.get('t1').effects[0].type).toBe('panner');
        });

        it('returns null for an unknown effect type', () => {
            const id = AudioEngine.addEffect('t1', 'unknown_effect');
            expect(id).toBeNull();
        });

        it('returns null when track does not exist', () => {
            expect(AudioEngine.addEffect('nonexistent', 'reverb')).toBeNull();
        });

        it('new effects start as enabled', () => {
            AudioEngine.addEffect('t1', 'delay');
            expect(AudioEngine.tracks.get('t1').effects[0].enabled).toBe(true);
        });

        it('multiple effects can be added and are stored in order', () => {
            AudioEngine.addEffect('t1', 'reverb');
            AudioEngine.addEffect('t1', 'delay');
            AudioEngine.addEffect('t1', 'compressor');
            const types = AudioEngine.tracks.get('t1').effects.map(e => e.type);
            expect(types).toEqual(['reverb', 'delay', 'compressor']);
        });
    });

    // ─── removeEffect ───────────────────────────────────────────────────────────

    describe('removeEffect', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('removes the effect from the effects array', () => {
            const id = AudioEngine.addEffect('t1', 'reverb');
            AudioEngine.removeEffect('t1', id);
            expect(AudioEngine.tracks.get('t1').effects).toHaveLength(0);
        });

        it('removes only the targeted effect when multiple exist', () => {
            const id1 = AudioEngine.addEffect('t1', 'reverb');
            AudioEngine.addEffect('t1', 'delay');
            AudioEngine.removeEffect('t1', id1);
            const types = AudioEngine.tracks.get('t1').effects.map(e => e.type);
            expect(types).toEqual(['delay']);
        });

        it('does nothing for an effectId that does not exist', () => {
            AudioEngine.addEffect('t1', 'reverb');
            expect(() => AudioEngine.removeEffect('t1', 99999)).not.toThrow();
            expect(AudioEngine.tracks.get('t1').effects).toHaveLength(1);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.removeEffect('nonexistent', 1)).not.toThrow();
        });
    });

    // ─── setEffectEnabled ───────────────────────────────────────────────────────

    describe('setEffectEnabled', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('disables an enabled effect', () => {
            const id = AudioEngine.addEffect('t1', 'reverb');
            AudioEngine.setEffectEnabled('t1', id, false);
            expect(AudioEngine.tracks.get('t1').effects[0].enabled).toBe(false);
        });

        it('re-enables a disabled effect', () => {
            const id = AudioEngine.addEffect('t1', 'delay');
            AudioEngine.setEffectEnabled('t1', id, false);
            AudioEngine.setEffectEnabled('t1', id, true);
            expect(AudioEngine.tracks.get('t1').effects[0].enabled).toBe(true);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.setEffectEnabled('nonexistent', 1, false)).not.toThrow();
        });
    });

    // ─── setEffectParam ─────────────────────────────────────────────────────────

    describe('setEffectParam', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('updates reverb mix param and adjusts wet/dry gains', () => {
            const id = AudioEngine.addEffect('t1', 'reverb');
            AudioEngine.setEffectParam('t1', id, 'mix', 0.6);
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.params.mix).toBe(0.6);
            expect(eff.nodes.wetGain.gain.value).toBe(0.6);
            expect(eff.nodes.dryGain.gain.value).toBe(0.4);
        });

        it('updates delay time param on the delay node', () => {
            const id = AudioEngine.addEffect('t1', 'delay');
            AudioEngine.setEffectParam('t1', id, 'time', 0.5);
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.params.time).toBe(0.5);
            expect(eff.nodes.delay.delayTime.value).toBe(0.5);
        });

        it('clamps delay feedback to 0.95 max', () => {
            const id = AudioEngine.addEffect('t1', 'delay');
            AudioEngine.setEffectParam('t1', id, 'feedback', 0.99);
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.nodes.feedback.gain.value).toBe(0.95);
        });

        it('updates compressor threshold', () => {
            const id = AudioEngine.addEffect('t1', 'compressor');
            AudioEngine.setEffectParam('t1', id, 'threshold', -30);
            expect(AudioEngine.tracks.get('t1').effects[0].params.threshold).toBe(-30);
        });

        it('updates panner pan value', () => {
            const id = AudioEngine.addEffect('t1', 'panner');
            AudioEngine.setEffectParam('t1', id, 'pan', -0.5);
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.params.pan).toBe(-0.5);
            expect(eff.nodes.inputGain.pan.value).toBe(-0.5);
        });

        it('updates highpass filter frequency', () => {
            const id = AudioEngine.addEffect('t1', 'highpass');
            AudioEngine.setEffectParam('t1', id, 'frequency', 500);
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.nodes.inputGain.frequency.value).toBe(500);
        });

        it('updates volume gain value', () => {
            const id = AudioEngine.addEffect('t1', 'volume');
            AudioEngine.setEffectParam('t1', id, 'gain', 0.8);
            const eff = AudioEngine.tracks.get('t1').effects[0];
            expect(eff.nodes.inputGain.gain.value).toBe(0.8);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.setEffectParam('nonexistent', 1, 'mix', 0.5)).not.toThrow();
        });

        it('does nothing when effectId does not exist', () => {
            expect(() => AudioEngine.setEffectParam('t1', 99999, 'mix', 0.5)).not.toThrow();
        });
    });

    // ─── applyFadeIn / applyFadeOut ─────────────────────────────────────────────

    describe('applyFadeIn', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('schedules a linear ramp up to targetVolume over the given duration', () => {
            AudioEngine.setVolume('t1', 0.8);
            AudioEngine.applyFadeIn('t1', 2);
            const gainNode = AudioEngine.tracks.get('t1').gain;
            expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, expect.any(Number));
        });

        it('starts the ramp from near-zero (0.001)', () => {
            AudioEngine.applyFadeIn('t1', 1);
            const gainNode = AudioEngine.tracks.get('t1').gain;
            expect(gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.001, mockCtx.currentTime);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.applyFadeIn('nonexistent', 1)).not.toThrow();
        });
    });

    describe('applyFadeOut', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('schedules a linear ramp down to near-zero (0.001) over the given duration', () => {
            AudioEngine.applyFadeOut('t1', 3);
            const gainNode = AudioEngine.tracks.get('t1').gain;
            expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.001, expect.any(Number));
        });

        it('starts the ramp from targetVolume', () => {
            AudioEngine.setVolume('t1', 0.6);
            AudioEngine.applyFadeOut('t1', 2);
            const gainNode = AudioEngine.tracks.get('t1').gain;
            expect(gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.6, mockCtx.currentTime);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.applyFadeOut('nonexistent', 1)).not.toThrow();
        });
    });

    // ─── unloadTrack ────────────────────────────────────────────────────────────

    describe('unloadTrack', () => {
        beforeEach(async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
        });

        it('removes the track from the internal map', () => {
            AudioEngine.unloadTrack('t1');
            expect(AudioEngine.tracks.has('t1')).toBe(false);
        });

        it('does nothing when track does not exist', () => {
            expect(() => AudioEngine.unloadTrack('nonexistent')).not.toThrow();
        });

        it('can load a new track with the same id after unloading', async () => {
            AudioEngine.unloadTrack('t1');
            const newBuf = createMockBuffer(5);
            await AudioEngine.loadTrack('t1', newBuf);
            expect(AudioEngine.tracks.get('t1').audioBuffer).toBe(newBuf);
        });
    });

    // ─── renderOffline ──────────────────────────────────────────────────────────

    describe('renderOffline', () => {
        it('returns null when no tracks are loaded', async () => {
            const result = await AudioEngine.renderOffline();
            expect(result).toBeNull();
        });

        it('creates an OfflineAudioContext and calls startRendering', async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
            await AudioEngine.renderOffline();
            expect(global.OfflineAudioContext).toHaveBeenCalled();
        });

        it('returns the rendered AudioBuffer', async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
            const result = await AudioEngine.renderOffline();
            expect(result).toBeDefined();
            expect(result.sampleRate).toBe(44100);
        });

        it('skips tracks with targetVolume of 0', async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer());
            AudioEngine.setVolume('t1', 0);
            await expect(AudioEngine.renderOffline()).resolves.toBeDefined();
        });

        it('renders multiple tracks without throwing', async () => {
            await AudioEngine.loadTrack('t1', createMockBuffer(2));
            await AudioEngine.loadTrack('t2', createMockBuffer(3));
            await expect(AudioEngine.renderOffline()).resolves.toBeDefined();
        });
    });

    // ─── audioBufferToWAV ───────────────────────────────────────────────────────

    describe('audioBufferToWAV', () => {
        const makeFakeBuffer = (numChannels, numFrames, sampleRate) => {
            const channels = Array.from({ length: numChannels }, () => {
                const data = new Float32Array(numFrames);
                for (let i = 0; i < numFrames; i++) data[i] = Math.sin(i / 10) * 0.5;
                return data;
            });
            return {
                numberOfChannels: numChannels,
                length: numFrames,
                sampleRate,
                duration: numFrames / sampleRate,
                getChannelData: jest.fn((ch) => channels[ch]),
            };
        };

        it('returns an ArrayBuffer', () => {
            const buf = makeFakeBuffer(2, 100, 44100);
            expect(audioBufferToWAV(buf)).toBeInstanceOf(ArrayBuffer);
        });

        it('has the correct total byte length (44-byte header + sample data)', () => {
            const frames = 100, channels = 2, bytesPerSample = 2;
            const expected = 44 + frames * channels * bytesPerSample;
            const buf = makeFakeBuffer(channels, frames, 44100);
            expect(audioBufferToWAV(buf).byteLength).toBe(expected);
        });

        it('starts with the RIFF magic bytes', () => {
            const wav = audioBufferToWAV(makeFakeBuffer(2, 10, 44100));
            const view = new DataView(wav);
            expect(view.getUint8(0)).toBe(0x52);
            expect(view.getUint8(1)).toBe(0x49);
            expect(view.getUint8(2)).toBe(0x46);
            expect(view.getUint8(3)).toBe(0x46);
        });

        it('encodes the correct sample rate in the WAV header', () => {
            const wav = audioBufferToWAV(makeFakeBuffer(2, 10, 48000));
            const view = new DataView(wav);
            expect(view.getUint32(24, true)).toBe(48000);
        });

        it('encodes the correct number of channels in the header', () => {
            const wav = audioBufferToWAV(makeFakeBuffer(1, 10, 44100));
            const view = new DataView(wav);
            expect(view.getUint16(22, true)).toBe(1);
        });

        it('clamps sample values to [-1, 1] without throwing', () => {
            const frames = 10;
            const data = new Float32Array(frames).fill(5.0);
            const buf = {
                numberOfChannels: 1,
                length: frames,
                sampleRate: 44100,
                duration: frames / 44100,
                getChannelData: jest.fn(() => data),
            };
            expect(() => audioBufferToWAV(buf)).not.toThrow();
        });

        it('produces a non-empty buffer for a single-frame, mono input', () => {
            const wav = audioBufferToWAV(makeFakeBuffer(1, 1, 44100));
            expect(wav.byteLength).toBe(44 + 2);
        });
    });
});

// ─── EssentiaAnalyzer ─────────────────────────────────────────────────────────

describe('EssentiaAnalyzer', () => {
    let analyzeAudioBuffer;

    beforeEach(() => {
        jest.resetModules();
        mockWorkerInstance = null;
        jest.clearAllMocks();
        global.Worker = MockWorker;
        ({ analyzeAudioBuffer } = require('../audio/essentiaAnalyzer'));
    });

    afterAll(() => {
        delete global.Worker;
    });

    describe('analyzeAudioBuffer — worker creation', () => {
        it('creates a Worker pointing at the correct script path', () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(100)),
            };

            analyzeAudioBuffer(mockBuffer);

            expect(mockWorkerInstance).not.toBeNull();
            expect(mockWorkerInstance.url).toBe('/essentia/analyzer.worker.js');
        });

        it('sends an analyze message with channel 0 data and sampleRate', () => {
            const channelData = new Float32Array([0.1, 0.2, 0.3]);
            const mockBuffer = {
                sampleRate: 48000,
                getChannelData: jest.fn(() => channelData),
            };

            analyzeAudioBuffer(mockBuffer);

            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
                type: 'analyze',
                audioData: channelData,
                sampleRate: 48000,
            });
        });

        it('always reads from channel index 0 (mono analysis)', () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            analyzeAudioBuffer(mockBuffer);

            expect(mockBuffer.getChannelData).toHaveBeenCalledWith(0);
        });
    });

    describe('analyzeAudioBuffer — success path', () => {
        it('resolves with bpm, key, scale, and beatPositions on a "done" message', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(100)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);

            mockWorkerInstance.onmessage({
                data: { type: 'done', bpm: 128.5, key: 'A', scale: 'minor', beatPositions: [0.0, 0.47, 0.94] },
            });

            const result = await promise;

            expect(result.bpm).toBe(128.5);
            expect(result.key).toBe('A');
            expect(result.scale).toBe('minor');
            expect(result.beatPositions).toEqual([0.0, 0.47, 0.94]);
        });

        it('does not terminate the worker after a "done" message (worker is persistent)', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);
            const workerRef = mockWorkerInstance;

            mockWorkerInstance.onmessage({
                data: { type: 'done', bpm: 120, key: 'C', scale: 'major', beatPositions: [] },
            });
            await promise;

            expect(workerRef.terminate).not.toHaveBeenCalled();
        });

        it('ignores messages with types other than "done" or "error"', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);

            mockWorkerInstance.onmessage({ data: { type: 'progress', percent: 50 } });
            mockWorkerInstance.onmessage({
                data: { type: 'done', bpm: 100, key: 'D', scale: 'major', beatPositions: [] },
            });

            await expect(promise).resolves.toBeDefined();
        });
    });

    describe('analyzeAudioBuffer — error paths', () => {
        it('rejects with the error message when the worker sends an "error" message', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);

            mockWorkerInstance.onmessage({ data: { type: 'error', error: 'WASM failed to load' } });

            await expect(promise).rejects.toThrow('WASM failed to load');
        });

        it('does not terminate the worker after an "error" message (worker is persistent)', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);
            const workerRef = mockWorkerInstance;

            mockWorkerInstance.onmessage({ data: { type: 'error', error: 'Analysis failed' } });
            await promise.catch(() => {});

            expect(workerRef.terminate).not.toHaveBeenCalled();
        });

        it('rejects when worker.onerror fires', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);

            mockWorkerInstance.onerror(new Error('Worker crashed'));

            await expect(promise).rejects.toThrow('Worker crashed');
        });

        it('does not call terminate when onerror fires (worker already crashed)', async () => {
            const mockBuffer = {
                sampleRate: 44100,
                getChannelData: jest.fn(() => new Float32Array(10)),
            };

            const promise = analyzeAudioBuffer(mockBuffer);
            const workerRef = mockWorkerInstance;

            mockWorkerInstance.onerror(new Error('crash'));
            await promise.catch(() => {});

            expect(workerRef.terminate).not.toHaveBeenCalled();
        });
    });
});
