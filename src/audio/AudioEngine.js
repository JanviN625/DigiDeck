import { SoundTouch, SimpleFilter, getWebAudioNode, WebAudioBufferSource } from 'soundtouchjs';

class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.tracks = new Map();
    }

    async loadTrack(trackId, audioBuffer) {
        if (this.tracks.has(trackId)) {
            this.unloadTrack(trackId);
        }

        // SoundTouch instance — pitch and tempo are independent
        const soundTouch = new SoundTouch();
        soundTouch.pitchSemitones = 0;
        soundTouch.tempo = 1.0;

        // EQs
        const eqLow = this.ctx.createBiquadFilter();
        eqLow.type = 'lowshelf';
        eqLow.frequency.value = 200;

        const eqMid = this.ctx.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = 1000;

        const eqHigh = this.ctx.createBiquadFilter();
        eqHigh.type = 'highshelf';
        eqHigh.frequency.value = 8000;

        const gain = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 256;

        // Static chain — stNode plugs into eqLow on each play()
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(gain);
        gain.connect(analyser);
        analyser.connect(this.masterGain);

        this.tracks.set(trackId, {
            soundTouch,
            stNode: null,
            stSource: null,
            stFilter: null,
            eqLow, eqMid, eqHigh, gain, analyser,
            audioBuffer,
            isPlaying: false,
            effects: [],
            startTime: 0,
            pauseTime: 0,
            targetVolume: 1.0,
        });
    }

    play(trackId) {
        const track = this.tracks.get(trackId);
        if (!track || track.isPlaying) return;

        // Browsers suspend AudioContext until a user gesture — resume before playing.
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        // Tear down any previous ScriptProcessorNode
        if (track.stNode) {
            try { track.stNode.disconnect(); } catch {}
            track.stNode.onaudioprocess = null;
            track.stNode = null;
        }

        // Clear stale SoundTouch internal buffers to prevent glitching on seek/resume
        track.soundTouch.clear();

        const stSource = new WebAudioBufferSource(track.audioBuffer);
        const stFilter = new SimpleFilter(stSource, track.soundTouch);

        // SimpleFilter owns the read cursor — must set sourcePosition on the filter,
        // not on stSource (SimpleFilter overwrites stSource.position on every extract call).
        stFilter.sourcePosition = Math.round(track.pauseTime * track.audioBuffer.sampleRate);

        const stNode = getWebAudioNode(this.ctx, stFilter);

        track.stSource = stSource;
        track.stFilter = stFilter;
        track.stNode = stNode;

        stNode.connect(track.eqLow);

        // Restore gain to target in case a previous fade-out left it near zero.
        // applyFadeIn() will immediately override this if a fade-in is requested.
        track.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        track.gain.gain.setValueAtTime(track.targetVolume, this.ctx.currentTime);

        track.startTime = this.ctx.currentTime - track.pauseTime;
        track.isPlaying = true;
    }

    pause(trackId) {
        const track = this.tracks.get(trackId);
        if (!track || !track.isPlaying) return;

        // Record true audio position — read from stFilter.sourcePosition which is the
        // end-of-last-read cursor, more accurate than stSource.position (start-of-read).
        track.pauseTime = track.stFilter
            ? track.stFilter.sourcePosition / track.audioBuffer.sampleRate
            : 0;

        if (track.stNode) {
            try { track.stNode.disconnect(); } catch {}
            track.stNode.onaudioprocess = null;
            track.stNode = null;
        }

        track.isPlaying = false;
    }

    seek(trackId, timeSeconds) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        const wasPlaying = track.isPlaying;
        if (wasPlaying) this.pause(trackId);
        track.pauseTime = timeSeconds;
        if (wasPlaying) this.play(trackId);
    }

    setVolume(trackId, value) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        track.targetVolume = value;
        track.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        track.gain.gain.setValueAtTime(value, this.ctx.currentTime);
    }

    setPitch(trackId, semitones) {
        const track = this.tracks.get(trackId);
        if (track) track.soundTouch.pitchSemitones = semitones;
    }

    setSpeed(trackId, multiplier) {
        const track = this.tracks.get(trackId);
        if (track) track.soundTouch.tempo = multiplier;
    }

    setEQ(trackId, { low = 0, mid = 0, high = 0 }) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        track.eqLow.gain.value = low;
        track.eqMid.gain.value = mid;
        track.eqHigh.gain.value = high;
    }

    // ─── Effects ────────────────────────────────────────────────────────────────

    addEffect(trackId, effectType) {
        const track = this.tracks.get(trackId);
        if (!track) return null;

        const effectId = Date.now();
        let nodes, defaultParams;

        if (effectType === 'reverb') {
            const inputGain = this.ctx.createGain();
            const outputGain = this.ctx.createGain();
            const convolver = this.ctx.createConvolver();
            convolver.buffer = this._generateImpulse(2, 0.5);
            const wetGain = this.ctx.createGain();
            const dryGain = this.ctx.createGain();
            wetGain.gain.value = 0.3;
            dryGain.gain.value = 0.7;
            nodes = { inputGain, outputGain, convolver, wetGain, dryGain };
            defaultParams = { mix: 0.3 };
        } else if (effectType === 'delay') {
            const inputGain = this.ctx.createGain();
            const outputGain = this.ctx.createGain();
            const delay = this.ctx.createDelay(2.0);
            delay.delayTime.value = 0.25;
            const feedback = this.ctx.createGain();
            feedback.gain.value = 0.3;
            const wetGain = this.ctx.createGain();
            const dryGain = this.ctx.createGain();
            wetGain.gain.value = 0.5;
            dryGain.gain.value = 0.5;
            nodes = { inputGain, outputGain, delay, feedback, wetGain, dryGain };
            defaultParams = { time: 0.25, feedback: 0.3, mix: 0.5 };
        } else if (effectType === 'compressor') {
            const compressor = this.ctx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.ratio.value = 4;
            compressor.knee.value = 10;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            nodes = { inputGain: compressor, outputGain: compressor };
            defaultParams = { threshold: -24, ratio: 4, knee: 10 };
        } else if (effectType === 'volume') {
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = 1.0;
            nodes = { inputGain: gainNode, outputGain: gainNode };
            defaultParams = { gain: 1.0 };
        } else if (effectType === 'filter') {
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 300;
            nodes = { inputGain: filter, outputGain: filter };
            defaultParams = { filterType: 'highpass', frequency: 300 };
        } else if (effectType === 'highpass') {
            // Legacy — kept for backwards compatibility with saved workspaces
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 300;
            nodes = { inputGain: filter, outputGain: filter };
            defaultParams = { frequency: 300 };
        } else if (effectType === 'lowpass') {
            // Legacy — kept for backwards compatibility with saved workspaces
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 8000;
            nodes = { inputGain: filter, outputGain: filter };
            defaultParams = { frequency: 8000 };
        } else if (effectType === 'panner') {
            const panner = this.ctx.createStereoPanner();
            panner.pan.value = 0;
            nodes = { inputGain: panner, outputGain: panner };
            defaultParams = { pan: 0 };
        } else {
            return null;
        }

        const effect = { id: effectId, type: effectType, enabled: true, nodes, params: defaultParams };
        track.effects.push(effect);
        this._reconnectEffectsChain(trackId);
        return effectId;
    }

    removeEffect(trackId, effectId) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        const effect = track.effects.find(e => e.id === effectId);
        if (!effect) return;
        this._disconnectEffectNodes(effect);
        track.effects = track.effects.filter(e => e.id !== effectId);
        this._reconnectEffectsChain(trackId);
    }

    setEffectEnabled(trackId, effectId, enabled) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        const effect = track.effects.find(e => e.id === effectId);
        if (!effect) return;
        effect.enabled = enabled;
        this._reconnectEffectsChain(trackId);
    }

    setEffectParam(trackId, effectId, param, value) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        const effect = track.effects.find(e => e.id === effectId);
        if (!effect) return;
        effect.params[param] = value;

        if (effect.type === 'reverb') {
            if (param === 'mix') {
                effect.nodes.wetGain.gain.value = value;
                effect.nodes.dryGain.gain.value = 1 - value;
            }
        } else if (effect.type === 'delay') {
            if (param === 'time') effect.nodes.delay.delayTime.value = value;
            if (param === 'feedback') effect.nodes.feedback.gain.value = Math.min(0.95, value);
            if (param === 'mix') {
                effect.nodes.wetGain.gain.value = value;
                effect.nodes.dryGain.gain.value = 1 - value;
            }
        } else if (effect.type === 'compressor') {
            if (param === 'threshold') effect.nodes.inputGain.threshold.value = value;
            if (param === 'ratio') effect.nodes.inputGain.ratio.value = value;
            if (param === 'knee') effect.nodes.inputGain.knee.value = value;
        } else if (effect.type === 'volume') {
            if (param === 'gain') effect.nodes.inputGain.gain.value = value;
        } else if (effect.type === 'filter') {
            if (param === 'filterType') effect.nodes.inputGain.type = value;
            if (param === 'frequency') effect.nodes.inputGain.frequency.value = value;
        } else if (effect.type === 'highpass' || effect.type === 'lowpass') {
            if (param === 'frequency') effect.nodes.inputGain.frequency.value = value;
        } else if (effect.type === 'panner') {
            if (param === 'pan') effect.nodes.inputGain.pan.value = value;
        }
    }

    _disconnectEffectNodes(effect) {
        const { nodes, type } = effect;
        const safe = (node) => { try { node.disconnect(); } catch {} };
        safe(nodes.inputGain);
        if (nodes.outputGain !== nodes.inputGain) safe(nodes.outputGain);
        if (type === 'reverb') {
            safe(nodes.convolver);
            safe(nodes.wetGain);
            safe(nodes.dryGain);
        } else if (type === 'delay') {
            safe(nodes.delay);
            safe(nodes.feedback);
            safe(nodes.wetGain);
            safe(nodes.dryGain);
        }
    }

    _reconnectEffectsChain(trackId) {
        const track = this.tracks.get(trackId);
        if (!track) return;

        try { track.eqHigh.disconnect(); } catch {}
        try { track.gain.disconnect(); } catch {}
        track.effects.forEach(eff => this._disconnectEffectNodes(eff));

        // Re-wire internal effect node structure
        track.effects.forEach(eff => {
            if (eff.type === 'reverb') {
                eff.nodes.inputGain.connect(eff.nodes.convolver);
                eff.nodes.inputGain.connect(eff.nodes.dryGain);
                eff.nodes.convolver.connect(eff.nodes.wetGain);
                eff.nodes.wetGain.connect(eff.nodes.outputGain);
                eff.nodes.dryGain.connect(eff.nodes.outputGain);
            } else if (eff.type === 'delay') {
                eff.nodes.inputGain.connect(eff.nodes.delay);
                eff.nodes.inputGain.connect(eff.nodes.dryGain);
                eff.nodes.delay.connect(eff.nodes.feedback);
                eff.nodes.feedback.connect(eff.nodes.delay);
                eff.nodes.delay.connect(eff.nodes.wetGain);
                eff.nodes.wetGain.connect(eff.nodes.outputGain);
                eff.nodes.dryGain.connect(eff.nodes.outputGain);
            }
        });

        const enabled = track.effects.filter(e => e.enabled);
        if (enabled.length === 0) {
            track.eqHigh.connect(track.gain);
        } else {
            track.eqHigh.connect(enabled[0].nodes.inputGain);
            for (let i = 0; i < enabled.length - 1; i++) {
                enabled[i].nodes.outputGain.connect(enabled[i + 1].nodes.inputGain);
            }
            enabled[enabled.length - 1].nodes.outputGain.connect(track.gain);
        }
        track.gain.connect(track.analyser);
        track.analyser.connect(this.masterGain);
    }

    _generateImpulse(duration, decay) {
        return this._generateImpulseForCtx(this.ctx, duration, decay);
    }

    _generateImpulseForCtx(ctx, duration, decay) {
        const length = ctx.sampleRate * duration;
        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const channel = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 10);
            }
        }
        return impulse;
    }

    // Synchronously pre-processes a track's AudioBuffer through SoundTouch pitch/speed
    // so it can be used in OfflineAudioContext (ScriptProcessorNode is real-time only).
    _processBufferOffline(track) {
        const { audioBuffer, soundTouch } = track;
        const pitch = soundTouch.pitchSemitones;
        const tempo = soundTouch.tempo;

        if (pitch === 0 && tempo === 1.0) return audioBuffer;

        const st = new SoundTouch();
        st.pitchSemitones = pitch;
        st.tempo = tempo;

        const source = new WebAudioBufferSource(audioBuffer);
        const filter = new SimpleFilter(source, st);

        const outputFrames = Math.ceil(audioBuffer.length / tempo);
        const chunkSize = 8192;
        const interleaved = new Float32Array(chunkSize * 2);
        const leftOut = new Float32Array(outputFrames + chunkSize);
        const rightOut = new Float32Array(outputFrames + chunkSize);

        let totalFrames = 0;
        let extracted;
        while (totalFrames < outputFrames + chunkSize) {
            extracted = filter.extract(interleaved, chunkSize);
            if (extracted === 0) break;
            for (let i = 0; i < extracted; i++) {
                leftOut[totalFrames + i] = interleaved[i * 2];
                rightOut[totalFrames + i] = interleaved[i * 2 + 1];
            }
            totalFrames += extracted;
        }

        const outBuffer = this.ctx.createBuffer(2, totalFrames, audioBuffer.sampleRate);
        outBuffer.getChannelData(0).set(leftOut.subarray(0, totalFrames));
        outBuffer.getChannelData(1).set(rightOut.subarray(0, totalFrames));
        return outBuffer;
    }

    // Replicates a single live effect into an OfflineAudioContext node chain.
    _buildOfflineEffect(offlineCtx, effect) {
        if (effect.type === 'reverb') {
            const inputGain = offlineCtx.createGain();
            const outputGain = offlineCtx.createGain();
            const convolver = offlineCtx.createConvolver();
            convolver.buffer = this._generateImpulseForCtx(offlineCtx, 2, 0.5);
            const wetGain = offlineCtx.createGain();
            wetGain.gain.value = effect.params.mix;
            const dryGain = offlineCtx.createGain();
            dryGain.gain.value = 1 - effect.params.mix;
            inputGain.connect(convolver);
            inputGain.connect(dryGain);
            convolver.connect(wetGain);
            wetGain.connect(outputGain);
            dryGain.connect(outputGain);
            return { input: inputGain, output: outputGain };
        } else if (effect.type === 'delay') {
            const inputGain = offlineCtx.createGain();
            const outputGain = offlineCtx.createGain();
            const delay = offlineCtx.createDelay(2.0);
            delay.delayTime.value = effect.params.time;
            const feedback = offlineCtx.createGain();
            feedback.gain.value = Math.min(0.95, effect.params.feedback);
            const wetGain = offlineCtx.createGain();
            wetGain.gain.value = effect.params.mix;
            const dryGain = offlineCtx.createGain();
            dryGain.gain.value = 1 - effect.params.mix;
            inputGain.connect(delay);
            inputGain.connect(dryGain);
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(wetGain);
            wetGain.connect(outputGain);
            dryGain.connect(outputGain);
            return { input: inputGain, output: outputGain };
        } else if (effect.type === 'compressor') {
            const compressor = offlineCtx.createDynamicsCompressor();
            compressor.threshold.value = effect.params.threshold;
            compressor.ratio.value = effect.params.ratio;
            compressor.knee.value = effect.params.knee;
            return { input: compressor, output: compressor };
        } else if (effect.type === 'volume') {
            const gainNode = offlineCtx.createGain();
            gainNode.gain.value = effect.params.gain;
            return { input: gainNode, output: gainNode };
        } else if (effect.type === 'filter') {
            const filter = offlineCtx.createBiquadFilter();
            filter.type = effect.params.filterType || 'highpass';
            filter.frequency.value = effect.params.frequency;
            return { input: filter, output: filter };
        } else if (effect.type === 'highpass') {
            const filter = offlineCtx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = effect.params.frequency;
            return { input: filter, output: filter };
        } else if (effect.type === 'lowpass') {
            const filter = offlineCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = effect.params.frequency;
            return { input: filter, output: filter };
        } else if (effect.type === 'panner') {
            const panner = offlineCtx.createStereoPanner();
            panner.pan.value = effect.params.pan;
            return { input: panner, output: panner };
        }
        return null;
    }

    // Renders all loaded tracks with their current pitch, speed, EQ, effects, and
    // volume settings into a single stereo AudioBuffer via OfflineAudioContext.
    // Note: renders from position 0 (full track) regardless of current playhead.
    async renderOffline() {
        const trackIds = [...this.tracks.keys()];
        if (trackIds.length === 0) return null;

        const sampleRate = this.ctx.sampleRate;

        let maxDuration = 0;
        for (const id of trackIds) {
            const t = this.tracks.get(id);
            const duration = t.audioBuffer.duration / t.soundTouch.tempo;
            maxDuration = Math.max(maxDuration, duration);
        }

        // Extra second to accommodate reverb/delay tails
        const totalSamples = Math.ceil(sampleRate * maxDuration) + sampleRate;
        const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
        const offlineMaster = offlineCtx.createGain();
        offlineMaster.connect(offlineCtx.destination);

        for (const id of trackIds) {
            const track = this.tracks.get(id);
            if (track.targetVolume === 0) continue;

            const processedBuffer = this._processBufferOffline(track);

            const eqLow = offlineCtx.createBiquadFilter();
            eqLow.type = 'lowshelf';
            eqLow.frequency.value = 200;
            eqLow.gain.value = track.eqLow.gain.value;

            const eqMid = offlineCtx.createBiquadFilter();
            eqMid.type = 'peaking';
            eqMid.frequency.value = 1000;
            eqMid.gain.value = track.eqMid.gain.value;

            const eqHigh = offlineCtx.createBiquadFilter();
            eqHigh.type = 'highshelf';
            eqHigh.frequency.value = 8000;
            eqHigh.gain.value = track.eqHigh.gain.value;

            eqLow.connect(eqMid);
            eqMid.connect(eqHigh);

            let lastNode = eqHigh;
            for (const effect of track.effects.filter(e => e.enabled)) {
                const built = this._buildOfflineEffect(offlineCtx, effect);
                if (built) {
                    lastNode.connect(built.input);
                    lastNode = built.output;
                }
            }

            const gain = offlineCtx.createGain();
            gain.gain.value = track.targetVolume;
            lastNode.connect(gain);
            gain.connect(offlineMaster);

            const source = offlineCtx.createBufferSource();
            source.buffer = processedBuffer;
            source.connect(eqLow);
            source.start(0);
        }

        return await offlineCtx.startRendering();
    }

    applySegmentAudio(trackId, { pitch, speed, eqLow, eqMid, eqHigh }) {
        this.setPitch(trackId, pitch);
        this.setSpeed(trackId, speed);
        this.setEQ(trackId, { low: eqLow, mid: eqMid, high: eqHigh });
    }

    applyFadeIn(trackId, seconds) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        track.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        track.gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
        track.gain.gain.linearRampToValueAtTime(track.targetVolume, this.ctx.currentTime + seconds);
    }

    applyFadeOut(trackId, seconds) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        track.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        track.gain.gain.setValueAtTime(track.targetVolume, this.ctx.currentTime);
        track.gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + seconds);
    }

    unloadTrack(trackId) {
        const track = this.tracks.get(trackId);
        if (!track) return;
        if (track.stNode) {
            try { track.stNode.disconnect(); } catch {}
            track.stNode.onaudioprocess = null;
        }
        track.eqLow.disconnect();
        track.eqMid.disconnect();
        track.eqHigh.disconnect();
        track.effects.forEach(eff => this._disconnectEffectNodes(eff));
        track.gain.disconnect();
        track.analyser.disconnect();
        this.tracks.delete(trackId);
    }
}

const audioEngine = new AudioEngine();
export default audioEngine;

// Encodes an AudioBuffer to a 16-bit stereo WAV ArrayBuffer.
export function audioBufferToWAV(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = buffer.length * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    const str = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }
    return ab;
}
