import { renderHook } from '@testing-library/react';
import { useAudioEngine } from '../audio/useAudioEngine';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../audio/AudioEngine', () => ({
    __esModule: true,
    default: {
        play: jest.fn(),
        pause: jest.fn(),
        seek: jest.fn(),
        setVolume: jest.fn(),
        setPitch: jest.fn(),
        setSpeed: jest.fn(),
        setEQ: jest.fn(),
        addEffect: jest.fn(),
        removeEffect: jest.fn(),
        setEffectEnabled: jest.fn(),
        setEffectParam: jest.fn(),
        applyFadeIn: jest.fn(),
        applyFadeOut: jest.fn(),
        unloadTrack: jest.fn(),
    },
}));

// ─── Per-test setup ───────────────────────────────────────────────────────────

const TRACK_ID = 'track_abc';
let AudioEngine;

beforeEach(() => {
    jest.clearAllMocks();
    AudioEngine = require('../audio/AudioEngine').default;
    // resetMocks:true clears implementations — restore the one that returns a value
    AudioEngine.addEffect.mockReturnValue('effect_1');
});

// ─── Delegation ───────────────────────────────────────────────────────────────

describe('useAudioEngine — delegation', () => {
    it('play delegates to AudioEngine.play with trackId', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.play();
        expect(AudioEngine.play).toHaveBeenCalledWith(TRACK_ID);
    });

    it('pause delegates to AudioEngine.pause with trackId', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.pause();
        expect(AudioEngine.pause).toHaveBeenCalledWith(TRACK_ID);
    });

    it('seek delegates to AudioEngine.seek with trackId and time', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.seek(42.5);
        expect(AudioEngine.seek).toHaveBeenCalledWith(TRACK_ID, 42.5);
    });

    it('setVolume delegates to AudioEngine.setVolume with trackId and value', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setVolume(0.75);
        expect(AudioEngine.setVolume).toHaveBeenCalledWith(TRACK_ID, 0.75);
    });

    it('setPitch delegates to AudioEngine.setPitch with trackId and semitones', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setPitch(-3);
        expect(AudioEngine.setPitch).toHaveBeenCalledWith(TRACK_ID, -3);
    });

    it('setSpeed delegates to AudioEngine.setSpeed with trackId and multiplier', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setSpeed(1.5);
        expect(AudioEngine.setSpeed).toHaveBeenCalledWith(TRACK_ID, 1.5);
    });

    it('setEQ delegates to AudioEngine.setEQ with trackId and eq object', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        const eq = { low: -3, mid: 0, high: 2 };
        result.current.setEQ(eq);
        expect(AudioEngine.setEQ).toHaveBeenCalledWith(TRACK_ID, eq);
    });

    it('addEffect delegates to AudioEngine.addEffect and returns the effect id', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        const id = result.current.addEffect('reverb');
        expect(AudioEngine.addEffect).toHaveBeenCalledWith(TRACK_ID, 'reverb');
        expect(id).toBe('effect_1');
    });

    it('removeEffect delegates to AudioEngine.removeEffect with trackId and effectId', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.removeEffect('effect_1');
        expect(AudioEngine.removeEffect).toHaveBeenCalledWith(TRACK_ID, 'effect_1');
    });

    it('setEffectEnabled delegates to AudioEngine.setEffectEnabled', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setEffectEnabled('effect_1', false);
        expect(AudioEngine.setEffectEnabled).toHaveBeenCalledWith(TRACK_ID, 'effect_1', false);
    });

    it('setEffectParam delegates to AudioEngine.setEffectParam', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setEffectParam('effect_1', 'mix', 0.7);
        expect(AudioEngine.setEffectParam).toHaveBeenCalledWith(TRACK_ID, 'effect_1', 'mix', 0.7);
    });

    it('applyFadeIn delegates to AudioEngine.applyFadeIn with trackId and seconds', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.applyFadeIn(2);
        expect(AudioEngine.applyFadeIn).toHaveBeenCalledWith(TRACK_ID, 2);
    });

    it('applyFadeOut delegates to AudioEngine.applyFadeOut with trackId and seconds', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.applyFadeOut(3);
        expect(AudioEngine.applyFadeOut).toHaveBeenCalledWith(TRACK_ID, 3);
    });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

describe('useAudioEngine — cleanup', () => {
    it('calls AudioEngine.unloadTrack with trackId on unmount', () => {
        const { unmount } = renderHook(() => useAudioEngine(TRACK_ID));
        unmount();
        expect(AudioEngine.unloadTrack).toHaveBeenCalledWith(TRACK_ID);
    });

    it('does not call unloadTrack before unmount', () => {
        renderHook(() => useAudioEngine(TRACK_ID));
        expect(AudioEngine.unloadTrack).not.toHaveBeenCalled();
    });

    it('calls unloadTrack with new trackId when trackId changes', () => {
        const { rerender, unmount } = renderHook(({ id }) => useAudioEngine(id), {
            initialProps: { id: 'track_a' },
        });
        // When trackId changes the old cleanup fires, then re-mounts with new id
        rerender({ id: 'track_b' });
        expect(AudioEngine.unloadTrack).toHaveBeenCalledWith('track_a');
        unmount();
        expect(AudioEngine.unloadTrack).toHaveBeenCalledWith('track_b');
    });
});
