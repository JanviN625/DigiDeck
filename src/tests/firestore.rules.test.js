import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
if (typeof setImmediate === 'undefined') {
    global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}

let testEnv;

beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../firestore.rules');
    // We intentionally load rules from the actual file so tests break if it changes
    // Set the environment variable to ensure the unit-testing library uses IPv4 explicitly
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    
    testEnv = await initializeTestEnvironment({
        projectId: "digideck-test",
        firestore: {
            rules: fs.readFileSync(rulesPath, 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
    });
});

beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});
// Tests execute as normal against the defined host.
describe('Firestore Security Rules (Claim 1)', () => {
    it('denies unauthenticated read/write to users collection', async () => {
        const unauthedDb = testEnv.unauthenticatedContext().firestore();
        
        await assertFails(getDoc(doc(unauthedDb, 'users/alice')));
        await assertFails(setDoc(doc(unauthedDb, 'users/alice'), { foo: 'bar' }));
    });

    it('allows a user to read/write their own document', async () => {
        const aliceDb = testEnv.authenticatedContext('alice').firestore();
        
        await assertSucceeds(setDoc(doc(aliceDb, 'users/alice'), { profile: 'data' }));
        await assertSucceeds(getDoc(doc(aliceDb, 'users/alice')));
    });

    it('denies a user from reading/writing another user document', async () => {
        const aliceDb = testEnv.authenticatedContext('alice').firestore();
        
        await assertFails(getDoc(doc(aliceDb, 'users/bob')));
        await assertFails(setDoc(doc(aliceDb, 'users/bob'), { malicious: 'data' }));
    });

    // Subcollections constraint - Incident 3 fix
    it('allows a user to access their own subcollections (tokens, projects, uploads)', async () => {
        const aliceDb = testEnv.authenticatedContext('alice').firestore();
        
        await assertSucceeds(setDoc(doc(aliceDb, 'users/alice/tokens/spotify'), { token: 'xyz' }));
        await assertSucceeds(getDoc(doc(aliceDb, 'users/alice/tokens/spotify')));
        
        await assertSucceeds(setDoc(doc(aliceDb, 'users/alice/projects/untitled'), { name: 'mix' }));
    });

    it('denies access to other users subcollections', async () => {
        const bobDb = testEnv.authenticatedContext('bob').firestore();
        
        await assertFails(setDoc(doc(bobDb, 'users/alice/tokens/spotify'), { token: 'hijack' }));
        await assertFails(getDoc(doc(bobDb, 'users/alice/tokens/spotify')));
    });
});
