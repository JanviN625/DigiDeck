import { useEffect, useCallback } from 'react';
import AudioEngine from './AudioEngine';

export const useAudioEngine = (trackId) => {

    const play = useCallback(() => AudioEngine.play(trackId), [trackId]);
    const pause = useCallback(() => AudioEngine.pause(trackId), [trackId]);
    const seek = useCallback((time) => AudioEngine.seek(trackId, time), [trackId]);
    const setVolume = useCallback((val) => AudioEngine.setVolume(trackId, val), [trackId]);
    const setPitch = useCallback((semitones) => AudioEngine.setPitch(trackId, semitones), [trackId]);
    const setSpeed = useCallback((multiplier) => AudioEngine.setSpeed(trackId, multiplier), [trackId]);
    const setEQ = useCallback((eq) => AudioEngine.setEQ(trackId, eq), [trackId]);
    const addEffect = useCallback((type) => AudioEngine.addEffect(trackId, type), [trackId]);
    const removeEffect = useCallback((effectId) => AudioEngine.removeEffect(trackId, effectId), [trackId]);
    const setEffectEnabled = useCallback((effectId, enabled) => AudioEngine.setEffectEnabled(trackId, effectId, enabled), [trackId]);
    const setEffectParam = useCallback((effectId, param, value) => AudioEngine.setEffectParam(trackId, effectId, param, value), [trackId]);
    const applyFadeIn = useCallback((seconds) => AudioEngine.applyFadeIn(trackId, seconds), [trackId]);
    const applyFadeOut = useCallback((seconds) => AudioEngine.applyFadeOut(trackId, seconds), [trackId]);

    // Ensure cleanup of resources on unmount if this hook represents the track lifecycle
    useEffect(() => {
        return () => {
            AudioEngine.unloadTrack(trackId);
        };
    }, [trackId]);

    return {
        play, pause, seek, setVolume, setPitch, setSpeed,
        setEQ, addEffect, removeEffect, setEffectEnabled, setEffectParam, applyFadeIn, applyFadeOut
    };
};
