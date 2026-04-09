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

const ANALYSIS_TIMEOUT_MS = 30000;

export async function analyzeAudioBuffer(audioBuffer) {
    return new Promise((resolve, reject) => {
        const audioData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;

        let settled = false;

        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            // Clear active callbacks so the worker response is ignored harmlessly
            if (activeResolve === wrappedResolve) {
                activeResolve = null;
                activeReject = null;
                processQueue();
            }
            reject(new Error('Essentia analysis timed out after 30s'));
        }, ANALYSIS_TIMEOUT_MS);

        const wrappedResolve = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
        };

        const wrappedReject = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            reject(err);
        };

        if (!activeResolve) {
            // Worker is idle — dispatch immediately
            activeResolve = wrappedResolve;
            activeReject = wrappedReject;
            getWorker().postMessage({ type: 'analyze', audioData, sampleRate });
        } else {
            // Worker is busy — queue for after current job finishes
            queue.push({ audioData, sampleRate, resolve: wrappedResolve, reject: wrappedReject });
        }
    });
}
