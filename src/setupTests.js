// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

jest.mock('./firebase/firebaseConfig', () => {
    return {
        auth: {},
        db: {},
        storage: {},
    };
});

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: (auth, cb) => {
        cb(null);
        return () => {};
    },
}));

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
