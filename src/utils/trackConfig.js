// Shared effect configuration — single source of truth for
// both TrackCard.js (UI controls) and AIPanel.js (AI capability description).
// Any change here automatically propagates to the system prompt Claude receives.

export const EFFECT_CONFIGS = {
    volume: {
        label: 'Volume',
        defaultParams: { gain: 1.0 },
        paramDefs: [
            { key: 'gain', label: 'Gain', min: 0, max: 2, step: 0.01, unit: 'x' },
        ],
    },
    filter: {
        label: 'Pass Filter',
        defaultParams: { filterType: 'highpass', frequency: 300, rampIn: 0, rampOut: 0 },
        paramDefs: [
            { key: 'filterType', label: 'Type', type: 'select', options: [
                { value: 'highpass', label: 'High-pass' },
                { value: 'lowpass',  label: 'Low-pass'  },
            ]},
            { key: 'frequency', label: 'Cutoff', min: 20, max: 20000, step: 1, unit: 'Hz' },
            { key: 'rampIn',  label: 'Ramp In',  min: 0, max: 30, step: 0.1, unit: 's' },
            { key: 'rampOut', label: 'Ramp Out', min: 0, max: 30, step: 0.1, unit: 's' },
        ],
    },
    panner: {
        label: 'Stereo Pan',
        defaultParams: { pan: 0, lfoRate: 0, lfoDepth: 1.0 },
        paramDefs: [
            { key: 'pan', label: 'Pan', min: -1, max: 1, step: 0.01 },
            { key: 'lfoRate', label: 'Auto Rate', min: 0, max: 10, step: 0.1, unit: 'Hz' },
            { key: 'lfoDepth', label: 'Depth', min: 0, max: 1, step: 0.01 },
        ],
    },
    reverb: {
        label: 'Reverb',
        defaultParams: { mix: 0.3 },
        paramDefs: [
            { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
        ],
    },
    delay: {
        label: 'Delay',
        defaultParams: { time: 0.25, feedback: 0.3, mix: 0.5 },
        paramDefs: [
            { key: 'time', label: 'Time', min: 0, max: 1, step: 0.01, unit: 's' },
            { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, step: 0.01 },
            { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
        ],
    },
    compressor: {
        label: 'Compressor',
        defaultParams: { threshold: -24, ratio: 4, knee: 10 },
        paramDefs: [
            { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, unit: 'dB' },
            { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
            { key: 'knee', label: 'Knee', min: 0, max: 40, step: 1, unit: 'dB' },
        ],
    },
};

/**
 * Generates the effects block for the Claude system prompt directly from EFFECT_CONFIGS.
 * Adding or changing an effect here automatically updates what Claude knows about the app.
 */
export function buildEffectsCapabilities() {
    return Object.entries(EFFECT_CONFIGS)
        .map(([type, config]) => {
            const params = config.paramDefs
                .map(p => {
                    if (p.type === 'select') {
                        return `${p.label}: ${p.options.map(o => o.label).join(' | ')}`;
                    }
                    const range = (p.min < 0 && p.max > 0)
                        ? `–${Math.abs(p.min)} to +${p.max}${p.unit ? ' ' + p.unit : ''}`
                        : `${p.min}–${p.max}${p.unit ? ' ' + p.unit : ''}`;
                    const def = config.defaultParams[p.key];
                    return `${p.label} ${range}${def !== undefined ? `, default ${def}` : ''}`;
                })
                .join(', ');
            return `  ${type}: ${params}`;
        })
        .join('\n');
}
