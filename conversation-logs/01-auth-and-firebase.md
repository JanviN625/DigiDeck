# Plan 01 — Auth Redesign & Firebase Storage

## Component & Style Rules
- **Components:** HeroUI first → Lucide (icons only) → plain Tailwind
- **Colors:** `base` scale from `tailwind.config.js` only (`base-50` … `base-900`)

---

## 1. What Changes and Why

| Concern | Before | After |
|---|---|---|
| Primary login | Spotify PKCE forced | Firebase Auth (Google + email/password) |
| Spotify | Required for access | Optional catalog connection |
| Firestore key | `users/{spotifyUserId}` | `users/{firebaseUID}` |
| Landing screen | "Connect with Spotify" | Log In / Sign Up buttons |
| Logout | Clears Spotify + Firebase | Firebase `signOut()` only — Firestore untouched |
| File uploads | Not implemented | Firebase Storage |
| `/api/authTokenValid.js` | Mints Firebase token from Spotify | **Retired** |

---

## 2. Landing Screen

Keep existing card layout (`bg-base-900` page, `bg-base-800` card, logo, heading).

**Change subtitle to:**
> "Welcome to DigiDeck, an AI-Enhanced Music Mashup Studio. Sign in to save your projects, upload tracks, and optionally connect Spotify for catalog browsing."

**Replace button with:**
```
[ Log In ]   [ Sign Up ]
```
Both HeroUI `Button radius="full"`. Log In → `variant="bordered"`. Sign Up → `variant="solid" className="bg-base-500 text-base-50"`.

**Auth methods (both required):**
- **Google Sign-In** — Firebase Google provider, one button, handles new + returning users
- **Email / Password** — form with email, password; Sign Up adds display name field

**New user:** on first sign-in, check Firestore for `users/{uid}` — if missing, create it (§4), then proceed to workspace.

---

## 3. Logout

- Firebase `auth.signOut()` only
- Do **not** delete `users/{uid}` document
- Do **not** delete Spotify tokens — persist for next session
- Do **not** touch Firebase Storage files

---

## 4. Firestore Schema

### User document — `users/{firebaseUID}`
```
uid, email, displayName, avatarUrl, createdAt, lastLoginAt,
spotify: { spotifyUserId, displayName, profileImageUrl, connectedAt } | null
```
`spotify` map is set on Spotify connect, nulled on disconnect.

### Tokens — `users/{firebaseUID}/tokens/spotify`
```
accessToken, refreshToken, expiresAt (unix ms)
```

### Projects — `users/{firebaseUID}/projects/{projectId}`
Structure unchanged. All `spotifyUserId` params renamed to `userId`.

### Uploads — `users/{firebaseUID}/uploads/{uploadId}` *(new)*
```
uploadId, originalName, storageRef, downloadUrl,
fileSize, mimeType, uploadedAt, usedInProjects: [projectId]
```

### Track object `source` field *(added to project tracks array)*
```js
// Spotify track
{ source: "spotify", spotifyTrackId, name, artist, artwork, previewUrl, settings, segments }

// Uploaded track
{ source: "upload", uploadId, storageRef, downloadUrl, name, settings, segments }
```
> BPM and key are **not** stored here — will be explained and implemented later.

---

## 5. Spotify — Optional Secondary Connection

- PKCE code in `spotifyAuth.js` unchanged
- `useSpotifyAuth.js` → repurposed as `useSpotifyConnect.js`:
  - `isSpotifyConnected` — true when valid tokens exist in Firestore
  - `connectSpotify()` — triggers PKCE flow
  - `disconnectSpotify()` — clears tokens from Firestore, does **not** log user out
- Token refresh still runs before Spotify API calls; on failure → prompt reconnect (not logout)

**Entry points to connect/disconnect:** Library panel button + profile dropdown row

---

## 6. Library Panel

```
┌─────────────────────────────┐
│  Library              [ < ] │
├─────────────────────────────┤
│  YOUR FILES                 │
│  [ + Upload MP3 ]           │  ← HeroUI Button, always visible
│  • filename.mp3  [ Add ]    │  ← Lucide Music icon; Add = HeroUI Button isDisabled
│  (empty state if none)      │
├── ─── SPOTIFY CATALOG ── ───┤  ← two HeroUI Dividers + label
│  [see states below]         │
└─────────────────────────────┘
```

### Spotify section states

**Not connected:**
HeroUI `Button radius="full" fullWidth variant="bordered"` + Spotify SVG icon → `"Connect Spotify"`
Below: `text-xs text-base-300` descriptor text.

**Connected:**
1. HeroUI `Card` warning — Lucide `AlertCircle text-base-400` + `text-xs text-base-300` message:
   *"Spotify Premium required for in-app playback. Tracks marked ▶ have a 30s preview."*
2. Search bar (existing placeholder, unchanged)
3. Playlist list (unchanged)
4. Track rows in `PlaylistTracksModal` get two new states:

| State | Treatment |
|---|---|
| `preview_url` present | Full opacity; HeroUI `Chip size="sm" variant="solid" bg-base-500` with Lucide `Play` icon |
| `preview_url` null | Dimmed; HeroUI `Chip size="sm" variant="flat" bg-base-700 text-base-300` — "No preview"; Add button disabled |

5. HeroUI `Button variant="light" size="sm" className="text-base-400 self-end"` → `"Disconnect Spotify"`

---

## 7. Header

### Avatar — priority chain
```
1. user.photoURL (Google)
2. spotify.profileImageUrl (if connected + no Google photo)
3. HeroUI Avatar with name={displayName ?? email} → auto-generates initials
   classNames={{ base: "bg-base-700", name: "text-base-50 font-bold" }}
```
HeroUI `Avatar` replaces the manual `<img>` / `<span>` branch in `Header.js`.

### Display name
`displayName` if set, else `email` (truncated). Consistent with avatar source.

### Profile dropdown
Replace hand-rolled div with HeroUI `Dropdown` / `DropdownTrigger` / `DropdownMenu` / `DropdownItem`.

```
Account info
Settings
Connect Spotify   ← flips to "Disconnect Spotify" when connected
──────────────
Logout            ← text-base-400
```

---

## 8. Firebase Storage

**Folder structure:**
```
users/{firebaseUID}/uploads/{uploadId}_{sanitised-filename}.mp3
```

**Security rules (intent):** authenticated users read/write/delete only their own folder; 50 MB max per file; audio MIME types only.

**Cleanup:** when a project is deleted, remove Storage files whose `usedInProjects` array becomes empty.

---

## 9. Files Affected

| Action | File | Notes |
|---|---|---|
| **Retire** | `src/spotify/useSpotifyAuth.js` | Replaced by two new hooks |
| **Retire** | `api/authTokenValid.js` | No longer needed |
| **Rename** | `useSpotifyAuth.js` → `useSpotifyConnect.js` | Optional Spotify only |
| **Modify** | `src/App.js` | Use Firebase auth hook; new landing screen |
| **Modify** | `src/components/LibraryPanel.js` | Two-section redesign |
| **Modify** | `src/components/Header.js` | Firebase profile; HeroUI Avatar + Dropdown |
| **Modify** | `src/firebase/firebaseConfig.js` | Add Storage init + export |
| **Modify** | `src/firebase/FirebaseService.js` | `spotifyUserId` → `userId`; add upload functions |
| **Add** | `src/firebase/useFirebaseAuth.js` | Login, signup, logout, profile create |
| **Add** | `src/components/AuthScreen.js` | Landing/auth screen |

**Unchanged:** `spotifyAuth.js`, `SpotifyService.js`, `SpotifyContext.js`,
`MainWorkspace.js`, `TrackCard.js`, `AIPanel.js`, `TrackSearchModal.js`, `helpers.js`
