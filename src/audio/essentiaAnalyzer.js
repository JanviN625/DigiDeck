// Persistent worker singleton — WASM loads once and stays alive across all analysis calls.
let worker = null;
let activeResolve = null;
let activeReject = null;
const queue = [];

function getWorker() {
    if (!worker) {
        worker = new Worker('/essentia/analyzer.worker.js');

        worker.onmessage = function(e) {
            if (!activeResolve) return;

            if (e.data.type === 'done') {
                const resolve = activeResolve;
                activeResolve = null;
                activeReject = null;
                resolve({
                    bpm: e.data.bpm,
                    key: e.data.key,
                    scale: e.data.scale,
                    beatPositions: e.data.beatPositions,
                });
                processQueue();
            } else if (e.data.type === 'error') {
                const reject = activeReject;
                activeResolve = null;
                activeReject = null;
                reject(new Error(e.data.error));
                processQueue();
            }
            // other message types are silently ignored — activeResolve stays set
        };

        worker.onerror = function(err) {
            const reject = activeReject;
            activeResolve = null;
            activeReject = null;
            worker = null; // worker crashed — allow recreation on next call
            if (reject) reject(err);
            processQueue();
        };
    }
    return worker;
}

function processQueue() {
    if (queue.length === 0) return;
    const { audioData, sampleRate, resolve, reject } = queue.shift();
    activeResolve = resolve;
    activeReject = reject;
    getWorker().postMessage({ type: 'analyze', audioData, sampleRate });
}

export async function analyzeAudioBuffer(audioBuffer) {
    return new Promise((resolve, reject) => {
        const audioData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;

        if (!activeResolve) {
            // Worker is idle — dispatch immediately
            activeResolve = resolve;
            activeReject = reject;
            getWorker().postMessage({ type: 'analyze', audioData, sampleRate });
        } else {
            // Worker is busy — queue for after current job finishes
            queue.push({ audioData, sampleRate, resolve, reject });
        }
    });
}
