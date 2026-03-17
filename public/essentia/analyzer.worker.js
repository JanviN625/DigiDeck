// Mock required browser globals for the WASM glue code
self.document = { currentScript: false };
self.window = self;

importScripts('/essentia/essentia-wasm.web.js');
importScripts('/essentia/essentia.js-core.js');

let essentia = null;

// Initialize Essentia
self.onmessage = function(e) {
    if (e.data.type === 'analyze') {
        const audioData = e.data.audioData; // Float32Array (channel 0)
        
        const sampleRate = e.data.sampleRate || 44100;
        
        if (!essentia) {
            // Wait for Essentia WASM to load
            EssentiaWASM().then(function(wasmModule) {
                // eslint-disable-next-line no-undef
                essentia = new Essentia(wasmModule);
                performAnalysis(audioData, sampleRate);
            }).catch(err => {
                self.postMessage({ type: 'error', error: 'Failed to load Essentia WASM: ' + err.message });
            });
        } else {
            performAnalysis(audioData, sampleRate);
        }
    }
};

function performAnalysis(audioData, sampleRate) {
    try {
        const audioVector = essentia.arrayToVector(audioData);
        
        // Compute BPM
        const bpmResult = essentia.PercivalBpmEstimator(audioVector, 1024, 2048, 128, 128, 210, 50, sampleRate);
        
        // Compute Key - 'temperley' profile is a very robust cognitive model for generic music, especially for resolving relative minor/major keys across diverse genres.
        const keyResult = essentia.KeyExtractor(audioVector, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "temperley", sampleRate, 0.0001, 440, "cosine", "hann");
        
        // Get beat positions (using defaults)
        const beatsResult = essentia.BeatTrackerMultiFeature(audioVector);
        
        const output = {
            type: 'done',
            bpm: Math.round(bpmResult.bpm),
            key: keyResult.key,
            scale: keyResult.scale,
            beatPositions: essentia.vectorToArray(beatsResult.ticks)
        };

        // free memory
        audioVector.delete();
        
        self.postMessage(output);
    } catch(err) {
        self.postMessage({ type: 'error', error: err.message });
    }
}
