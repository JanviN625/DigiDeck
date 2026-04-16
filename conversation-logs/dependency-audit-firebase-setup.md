# Dependency Audit & Firebase Emulator Setup
**Date:** 2026-02-25
**Branch:** `auth-and-services`

---

## Session Summary

This session covered auditing the project's npm dependencies for completeness and setting up the Firebase Firestore emulator so peers can run it locally.

---

## 1. Dependency Audit

**Request:** Find any missing packages/libraries and install them so peers can successfully install and run the code.

**Findings:** All packages used in source files were already declared in `package.json`. No missing npm packages were found.

| Import used in source | Package in `package.json` | Status |
|---|---|---|
| `react`, `react-dom/client` | `react`, `react-dom` | ✅ Present |
| `firebase/app`, `firebase/firestore` | `firebase` | ✅ Present |
| `@testing-library/react` | `@testing-library/react` | ✅ Present |
| `@testing-library/jest-dom` | `@testing-library/jest-dom` | ✅ Present |

**Note on extraneous packages:** `npm ls` showed many "extraneous" packages in local `node_modules` (Firebase CLI tools, etc.). These are installed locally but not imported by the app — peers will not get them on `npm install` and do not need them.

**Note on environment variables:** Peers will need a `.env` file with the following variables (not committable to git):

```
REACT_APP_SPOTIFY_CLIENT_ID=
REACT_APP_SPOTIFY_REDIRECT_URI=
REACT_APP_FIREBASE_API_KEY=
REACT_APP_FIREBASE_AUTH_DOMAIN=
REACT_APP_FIREBASE_PROJECT_ID=
REACT_APP_FIREBASE_STORAGE_BUCKET=
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=
REACT_APP_FIREBASE_APP_ID=
```

---

## 2. Firebase / Firestore Emulator Setup

**Request:** Identify and fix what was missing for Firestore.

**Problems identified:**
- `firebase-tools` (the Firebase CLI) was not installed — required to run the emulator
- `firestore.rules` was missing — initially flagged as needed
- `firestore.indexes.json` was missing — initially flagged as needed
- No `emulators` npm script existed

**Initial fix applied:**
- Installed `firebase-tools` as a devDependency
- Created `firestore.rules` with permissive dev rules
- Created `firestore.indexes.json` (empty)
- Added `"firestore"` block to `firebase.json` referencing those files
- Added `"emulators": "firebase emulators:start"` to `package.json` scripts

**Revised after user feedback (fewer files):**
User asked whether the same goal could be achieved without the extra files.

**Answer:** Yes — `firestore.rules` and `firestore.indexes.json` are only needed for deploying rules to production. The emulator runs with default open rules without them.

**Final minimal changes (what's committed):**

`package.json` — two changes only:
```json
"scripts": {
  ...
  "emulators": "firebase emulators:start"
},
"devDependencies": {
  "firebase-tools": "^15.7.0",
  "typescript": "^4.9.5"
}
```

`firestore.rules` and `firestore.indexes.json` were deleted.
`firebase.json` was reverted to its original form (no `"firestore"` block added).

---

## 3. Peer Setup Instructions (after this session)

```bash
# 1. Install dependencies (includes firebase-tools now)
npm install

# 2. Authenticate with Firebase (one-time)
firebase login

# 3. Start the Firestore emulator
npm run emulators

# 4. In a separate terminal, start the app
npm start
```

The app connects to the emulator automatically when running on `127.0.0.1` (see `src/firebase/firebaseConfig.js`).
