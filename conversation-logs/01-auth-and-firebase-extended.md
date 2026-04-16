# Plan 01 — Auth Redesign & Firebase Storage Setup (Extended Reference)

> This is the full-detail reference version of `01-auth-and-firebase.md`.
> Read the short file first for a quick overview, then consult this file
> for component-level specifics, rationale, and implementation guidance.

---

## Overview

This document specifies the changes needed to move DigiDeck from a
Spotify-forced authentication model to a Firebase-first model with Spotify
as an optional secondary connection. It also covers the Library panel redesign
and Firebase Storage setup required to support user-uploaded audio files.

**Scope:** Auth flow, landing screen, Library panel layout, Firestore schema,
Firebase Storage structure, and the list of files that need to change.
No implementation code is written here — this is the design spec.

---

### Component Library Priority

All UI components follow this resolution order:

1. **HeroUI** (`@heroui/react`) — already installed; use its `Button`, `Chip`,
   `Avatar`, `Divider`, `Input`, `Dropdown`/`DropdownMenu`/`DropdownItem`,
   and `Card` wherever they fit. Prefer HeroUI's built-in props (`radius`,
   `variant`, `size`, `fullWidth`, `isDisabled`, `color`) over manual Tailwind
   overrides when the prop covers the need.
2. **Lucide React** — for icons only, since HeroUI ships no icon set.
   Use Lucide icons inside HeroUI components via `startContent` / `endContent`
   props or as standalone children.
3. **Plain Tailwind + HTML** — only when neither HeroUI nor Lucide provides
   the primitive needed (e.g. warning banner layout, section label text).

### Color Palette Reference

All styling uses only the custom `base` scale from `tailwind.config.js`.
No external color names (green, amber, yellow, etc.) are used.

| Token | Hex | Role in app |
|---|---|---|
| `base-50` | `#F8FAFC` | Near-white text, brightest elements |
| `base-100` | `#E2E8F0` | Light text |
| `base-200` | `#C0C8D0` | Body text |
| `base-300` | `#9BA4B5` | Muted / secondary text |
| `base-400` | `#A63A50` | Accent — warnings, active states, badges |
| `base-500` | `#8C1F38` | Primary accent — buttons, highlights |
| `base-600` | `#6B3D52` | Hover states, mid-tone fills |
| `base-700` | `#59546C` | Borders, dividers, inactive badges |
| `base-800` | `#38405F` | Card / panel backgrounds |
| `base-900` | `#0E131F` | Page / sidebar backgrounds |

---

## 1. What Exists Now (Current State)

| Concern | Current Behaviour |
|---|---|
| Primary identity | Spotify — PKCE OAuth is the only way in |
| Firebase role | Secondary — receives a custom token minted from the Spotify token |
| Landing screen | Forces "Connect with Spotify" before anything is accessible |
| Logout | Clears Spotify tokens; Firebase session ends with them |
| Library panel | Shows Spotify playlists immediately (requires Spotify auth) |
| Firestore key | `users/{spotifyUserId}` — Spotify ID is the document ID |
| File uploads | Not implemented; no Firebase Storage configured |
| Token conversion | `/api/authTokenValid.js` validates Spotify token → mints Firebase custom token |

**Problems this creates:**
- Users without a Spotify account cannot use the app at all
- The forced Spotify connection is fragile — Spotify API changes (Nov 2024
  deprecations) can block the entire app from loading
- Spotify ID as the Firestore key creates dependency on a third-party
  identifier the user does not control

---

## 2. Target State (After These Changes)

| Concern | New Behaviour |
|---|---|
| Primary identity | Firebase Auth — email/password and Google Sign-In |
| Spotify role | Optional secondary connection for catalog browsing |
| Landing screen | Same visual style; Log In / Sign Up replaces "Connect with Spotify" |
| Logout | Firebase `signOut()` only; user record in Firestore is NOT touched |
| Library panel | Two sections — "Your Files" (always) + "Spotify Catalog" (optional) |
| Firestore key | `users/{firebaseUID}` — Firebase UID is the document ID |
| File uploads | Firebase Storage; audio files stored at `users/{firebaseUID}/uploads/` |
| Token conversion | `/api/authTokenValid.js` is retired; no longer used for login |

---

## 3. Landing Screen

### 3.1 Visual

Keep the existing card layout exactly as-is:
- Dark background (`bg-base-900`)
- Centred card (`bg-base-800`, rounded, bordered, shadow)
- DigiDeck logo + "DigiDeck Studio" heading
- Subtitle paragraph

**Only the subtitle text and button(s) change.**

### 3.2 Subtitle Text (replace)

> *Current:* "You must connect your Spotify account to access the application
> and utilize playback features."

> *New:* "Welcome to DigiDeck, an AI-Enhanced Music Mashup Studio. Sign in to
> save your projects, upload tracks, and optionally connect Spotify for catalog
> browsing."

### 3.3 Buttons

Replace the single "Connect with Spotify" button with two side-by-side buttons:

```
[ Log In ]   [ Sign Up ]
```

- Both use HeroUI `Button` with `radius="full"` and equal width
- **Log In:** `variant="bordered"` (outlined)
- **Sign Up:** `variant="solid"` with `className="bg-base-500 text-base-50"` (filled primary)

### 3.4 Authentication Methods (both must be supported)

| Method | Description |
|---|---|
| **Google Sign-In** | Single button, Firebase Auth Google provider. Handles existing and new users automatically. Preferred — fewest steps. |
| **Email / Password** | Standard form with email field, password field, submit. Separate "Sign Up" variant adds a display name field. |

The landing card should show Google Sign-In prominently with a divider
(HeroUI `Divider`) and email/password form below it, or a toggle to switch
between them. Exact layout to be decided at implementation time — the
requirement is that both methods are accessible from the landing screen.

### 3.5 New User Handling

On first successful Firebase sign-in (either method):
1. Check Firestore for `users/{firebaseUID}` document
2. If it does **not** exist → create it with the fields defined in §6.1
3. Proceed to workspace — no separate onboarding step required

### 3.6 Loading State

Unchanged — the existing full-screen spinner is adequate.

---

## 4. Logout Behaviour

- Call Firebase `auth.signOut()` only
- Clear local React state (profile, tracks, etc.)
- Redirect to landing screen
- **Do NOT** delete or modify the `users/{firebaseUID}` Firestore document
- **Do NOT** delete Spotify tokens from Firestore — they persist for the next
  session so the user does not have to reconnect Spotify on every login
- **Do NOT** delete uploaded files from Firebase Storage on logout

---

## 5. Spotify as Optional Secondary Connection

Spotify is no longer part of the login flow. It is an optional integration
the user activates from within the app after signing in.

### 5.1 Entry Points

Two places in the UI can initiate Spotify connection:

1. **Library panel** — "Connect Spotify" button visible when Spotify is not
   connected (see §7 for full Library panel spec)
2. **Profile dropdown** → "Connect Spotify" row, visible only when Spotify
   is not currently connected; becomes "Disconnect Spotify" when it is

### 5.2 Spotify Connection Flow

The PKCE code in `src/spotify/spotifyAuth.js` does not change — it is reused
as-is. What changes is the hook that wraps it.

`useSpotifyAuth.js` is repurposed as `useSpotifyConnect.js`:
- Manages Spotify connection state independently of Firebase auth
- `isSpotifyConnected` — boolean, true when valid Spotify tokens exist in Firestore
- `connectSpotify()` — initiates PKCE flow
- `disconnectSpotify()` — removes Spotify tokens from Firestore, sets
  `isSpotifyConnected` to false, does NOT log the user out of DigiDeck
- On app load: checks Firestore for Spotify tokens; sets initial connection state

Token storage path: `users/{firebaseUID}/tokens/spotify`
Only the parent document ID changes (Spotify ID → Firebase UID); the
subcollection path and document structure are unchanged.

### 5.3 Spotify Token Refresh

Spotify token refresh still happens before Spotify API calls, same as today.
If a refresh fails, the user is prompted to reconnect Spotify via a
non-blocking notification — not a forced logout.

### 5.4 Retiring `/api/authTokenValid.js`

This serverless function exists solely to convert a Spotify access token into
a Firebase custom auth token. With Firebase Auth as the primary identity
system, this conversion is no longer needed and the file can be removed.

---

## 6. Firestore Schema Updates

### 6.1 User Document

**Path:** `users/{firebaseUID}`

```
{
  uid:          string,      // Firebase UID — matches the document ID
  email:        string,
  displayName:  string,
  avatarUrl:    string | null,   // From Google profile; null for email/password
  createdAt:    timestamp,
  lastLoginAt:  timestamp,

  spotify: {                 // OPTIONAL — present only when user has connected Spotify
    spotifyUserId:    string,
    displayName:      string,
    profileImageUrl:  string,
    connectedAt:      timestamp
  } | null
}
```

`spotify` is a map field on the user document, not a subcollection. Set when
the user connects Spotify; set to `null` when they disconnect.

### 6.2 Tokens Subcollection (structure unchanged, key change only)

**Path:** `users/{firebaseUID}/tokens/spotify`

```
{
  accessToken:   string,
  refreshToken:  string,
  expiresAt:     number    // Unix timestamp in milliseconds
}
```

### 6.3 Projects Subcollection (key change only)

**Path:** `users/{firebaseUID}/projects/{projectId}`

Internal structure unchanged. All `spotifyUserId` parameter references in
`FirebaseService.js` are renamed to `userId` and receive the Firebase UID.

### 6.4 Uploads Subcollection (new)

**Path:** `users/{firebaseUID}/uploads/{uploadId}`

```
{
  uploadId:       string,   // matches document ID
  originalName:   string,   // filename as the user had it locally
  storageRef:     string,   // full path in Firebase Storage
  downloadUrl:    string,   // persistent HTTPS URL for fetching the file
  fileSize:       number,   // bytes
  mimeType:       string,   // e.g. "audio/mpeg"
  uploadedAt:     timestamp,
  usedInProjects: [string]  // projectIds referencing this file; used for cleanup
}
```

### 6.5 Track Object in Project (updated for source field)

Each track in a project's `tracks` array gains a `source` field:

**Spotify-sourced track:**
```
{
  source:         "spotify",
  spotifyTrackId: string,
  name:           string,
  artist:         string,
  artwork:        string,
  previewUrl:     string | null,
  settings:       { ... },
  segments:       [ ... ]
}
```

**User-uploaded track:**
```
{
  source:      "upload",
  uploadId:    string,      // references uploads/{uploadId}
  storageRef:  string,
  downloadUrl: string,
  name:        string,
  settings:    { ... },
  segments:    [ ... ]
}
```

> **Note:** BPM and key are intentionally omitted from both track objects —
> will be explained and implemented later (Plan 02).

---

## 7. Library Panel Redesign

### 7.1 High-Level Structure

The panel keeps its existing outer shell (collapse toggle, width, scrollbar
styling). Its inner content is reorganised into two named sections separated
by a divider.

```
┌─────────────────────────────┐
│  Library              [ < ] │  ← header unchanged
├─────────────────────────────┤
│  YOUR FILES                 │  ← Section A (always visible)
│  [ + Upload MP3 ]           │
│  • track1.mp3               │
│  • bassline.wav             │
├ ─ ─ SPOTIFY CATALOG ─ ─ ─ ─┤  ← HeroUI Dividers + label
│  SPOTIFY CATALOG            │  ← Section B (conditional)
│                             │
│  [ not connected state ]    │
│    OR                       │
│  [ playlist list ]          │
└─────────────────────────────┘
```

### 7.2 Section A — Your Files

Always rendered. Requires only Firebase login (no Spotify needed).

**Elements:**
- Section label: `"YOUR FILES"` — `text-[10px] uppercase tracking-widest text-base-400`
- HeroUI `Button` — `radius="full" fullWidth variant="bordered"` with Lucide
  `Upload` icon in `startContent`. Label: `"+ Upload MP3"`.
  Accepted types when wired: `.mp3`, `.wav`, `.flac`, `.aac`.
  No functionality in this plan — button exists as a design element only.
- Uploaded files list — scrollable, same row style as existing playlist items:
  - Lucide `Music` icon (left, `text-base-300`)
  - Filename (truncated, `text-base-200`)
  - File duration if available (`text-xs text-base-400`)
  - HeroUI `Button` — `size="sm" variant="bordered" isDisabled` — label `"Add"`,
    disabled until playback logic is wired in Plan 02
- **Empty state:** `"No files yet. Upload an MP3 to get started."` —
  `text-xs text-base-400 text-center mt-4`, same treatment as current
  "No playlists found" state

### 7.3 Divider Between Sections

HeroUI `Divider` with a centred label overlaid using a flex row:

```
─────  SPOTIFY CATALOG  ─────
```

The label sits between two `Divider` instances in a `flex items-center gap-2`
row. Label text: `text-[10px] uppercase tracking-widest text-base-400`.
Non-interactive.

### 7.4 Section B — Spotify Catalog

This section is conditional on whether Spotify is connected.

---

#### State 1: Spotify Not Connected

Displayed when `isSpotifyConnected` is false.

**Elements:**
- HeroUI `Button` — `radius="full" fullWidth variant="bordered"` with a small
  Spotify logo SVG in `startContent`. Label: `"Connect Spotify"`.
  The palette has no Spotify-green equivalent, so the logo carries brand
  recognition instead of colour; button uses the same neutral bordered style
  as the Upload button for visual consistency.
- Descriptor below button — `<p className="text-xs text-base-300 text-center mt-1">`:
  `"Browse your Spotify playlists for inspiration. Tracks with a preview
   available (30s max) can be added directly to your mix!"`

No playlist list, no search bar, no warning banner in this state.

---

#### State 2: Spotify Connected

Displayed when `isSpotifyConnected` is true.

**Elements, top to bottom:**

1. **Premium warning banner**

   Persistent info block — not a dismissible toast.

   ```
   ┌──────────────────────────────┐
   │ ⚠  Spotify Premium required  │
   │    for in-app playback.      │
   │    Tracks marked ▶ have a   │
   │    30s preview available.    │
   └──────────────────────────────┘
   ```

   HeroUI `Card` with `className="bg-base-900/50 border border-base-400 p-2"`.
   Inside: flex row with Lucide `AlertCircle` icon
   (`size={14} className="text-base-400 shrink-0"`) and
   `<p className="text-xs text-base-300">` for the message text.

2. **Search bar** — unchanged from current "Search Library" placeholder

3. **Playlist list** — unchanged visual style from current implementation
   - Each row: thumbnail, name, owner
   - Click opens `PlaylistTracksModal` (unchanged)

4. **Track rows inside `PlaylistTracksModal`** — two new visual states:

   | Track state | Visual treatment |
   |---|---|
   | `preview_url` present | Full opacity; HeroUI `Chip size="sm" variant="solid"` (`classNames={{ base: "bg-base-500", content: "text-base-50 text-[10px]" }}`) with Lucide `Play` icon (`size={10}`) in `startContent`; `[ Add ]` button enabled |
   | `preview_url` null | Dimmed row (`opacity-50`); HeroUI `Chip size="sm" variant="flat"` (`classNames={{ base: "bg-base-700", content: "text-base-300 text-[10px]" }}`), label `"No preview"`; `[ Add ]` button `isDisabled` |

5. **Disconnect link** — HeroUI `Button` —
   `variant="light" size="sm" className="text-base-400 self-end"`.
   Label: `"Disconnect Spotify"`. No border, no background fill.
   Clicking sets `isSpotifyConnected` to false and returns to State 1.

---

### 7.5 Collapsed State

When the panel is collapsed to icon-only mode, the Lucide `Library` icon is
shown as before. No change to collapse behaviour.

---

## 8. Header Changes

The Header receives its profile data from Firebase Auth, not from Spotify.

### 8.1 Avatar — Priority Chain

The avatar shown in the header button and profile dropdown resolves through
the following priority order. The first non-null source wins.

**Priority 1 — Google profile photo**
If the user signed in with Google and Firebase's `user.photoURL` is non-null,
pass it as `src` to the HeroUI `Avatar`.

**Priority 2 — Spotify profile photo**
If Priority 1 is unavailable (email/password signup, or Google user with no
photo) AND Spotify is connected AND `spotify.profileImageUrl` in Firestore is
non-null, use the Spotify profile image as `src`.

**Priority 3 — Initials avatar (HeroUI Avatar, always available)**
Use HeroUI `Avatar` — it handles initials natively:
- Pass `name={user.displayName ?? user.email}` — HeroUI automatically extracts
  initials and renders them in a coloured circle when `src` is absent or fails
- Override colours: `classNames={{ base: "bg-base-700", name: "text-base-50 font-bold" }}`
- Enable `showFallback` prop to ensure the initials render when `src` errors

HeroUI `Avatar` replaces the entire manual `<img>` / `<span>` branch in
`Header.js`. The component tree only needs to supply the resolved `src`
(Priority 1 → 2 → null) and the `name` string (displayName → email).

**Why no "No Image" placeholder is needed:** Firebase Auth guarantees
`user.email` is always present, so the initials fallback is always populated.

**Priority chain summary:**
```
user.photoURL (Google)
  → spotify.profileImageUrl (if connected + no Google photo)
    → null: HeroUI Avatar renders initials from (displayName ?? email)
            classNames={{ base: "bg-base-700", name: "text-base-50 font-bold" }}
```

### 8.2 Display Name in Dropdown

- Shows `user.displayName` from Firebase Auth if set
- If `displayName` is null (email/password accounts that skipped the name
  field): show `user.email` with `className="truncate"`
- Mirrors the avatar source fallback so name and avatar are always consistent

### 8.3 Profile Dropdown

Replace the existing hand-rolled hover div in `Header.js` with HeroUI
`Dropdown` / `DropdownTrigger` / `DropdownMenu` / `DropdownItem`.
The trigger is the HeroUI `Avatar` from §8.1.

Menu structure:

```
[ Account info    ]   ← DropdownItem
[ Settings        ]   ← DropdownItem
[ Connect Spotify ]   ← DropdownItem (new); label flips to "Disconnect Spotify"
─────────────────────  ← DropdownSection with showDivider, or HeroUI Divider
[ Logout          ]   ← DropdownItem, className="text-base-400"
```

- Spotify row label driven by `isSpotifyConnected`:
  `"Connect Spotify"` when false, `"Disconnect Spotify"` when true
- Use `DropdownSection` with `showDivider` to separate Logout
- Override `DropdownItem` hover colours with `className` only where the base
  palette differs from HeroUI defaults

### 8.4 Everything Else

No changes to the project name input, Save/Load/Export/Preview buttons,
or the overall header layout and height.

---

## 9. Firebase Storage Setup

### 9.1 What Needs to Be Enabled

Firebase Storage must be enabled in the Firebase Console (it is separate from
Firestore and is not on by default). Once enabled, the Storage SDK must be
added to `firebaseConfig.js` alongside the existing `db` and `auth` exports.

### 9.2 Folder Structure

```
[Firebase Storage bucket root]
└── users/
    └── {firebaseUID}/
        └── uploads/
            └── {uploadId}_{sanitised-original-filename}
                  e.g. "a1b2c3_my-track.mp3"
```

- `uploadId` generated at upload time (`crypto.randomUUID()` or Firestore auto-ID)
- Filenames sanitised: spaces → hyphens, special characters stripped
- Each user's files are strictly isolated in their own folder

### 9.3 Security Rules (design intent — not final syntax)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/uploads/{filename} {
      allow read:   if request.auth != null && request.auth.uid == userId;
      allow write:  if request.auth != null
                    && request.auth.uid == userId
                    && request.resource.size < 50 * 1024 * 1024   // 50 MB max
                    && request.resource.contentType.matches('audio/.*');
      allow delete: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 9.4 File Cleanup on Project Delete

When a project is deleted, check each uploaded track's `usedInProjects` array.
If removing this project leaves the array empty, delete the file from Firebase
Storage and remove its `uploads/{uploadId}` Firestore document. This prevents
orphaned audio files accumulating in Storage over time.

---

## 10. Files Affected

### Retire

| File | Reason |
|---|---|
| `src/spotify/useSpotifyAuth.js` | Replaced by Firebase auth hook + Spotify connect hook |
| `api/authTokenValid.js` | Token conversion no longer needed for primary login |

### Rename / Repurpose

| Current | New Name | Change |
|---|---|---|
| `useSpotifyAuth.js` | `useSpotifyConnect.js` | Manages optional Spotify connection only; does not control app auth state |

### Modify

| File | Changes Required |
|---|---|
| `src/App.js` | Use Firebase Auth hook instead of `useSpotifyAuth`; update landing screen JSX |
| `src/components/LibraryPanel.js` | Full redesign per §7; two sections, conditional Spotify state |
| `src/components/Header.js` | Profile source → Firebase user; HeroUI Avatar priority chain; HeroUI Dropdown with Spotify row |
| `src/firebase/firebaseConfig.js` | Add Firebase Storage initialisation and export |
| `src/firebase/FirebaseService.js` | Rename all `spotifyUserId` params to `userId`; add upload-tracking functions |

### Add

| File | Purpose |
|---|---|
| `src/firebase/useFirebaseAuth.js` | Firebase Auth hook — login, signup (email/password + Google), logout, current user state, Firestore profile create-on-first-login |
| `src/components/AuthScreen.js` | Landing/auth screen — login and sign-up forms, Google button |

---

## 11. What Does Not Change

- `src/spotify/spotifyAuth.js` — PKCE code reused as-is by `useSpotifyConnect.js`
- `src/spotify/SpotifyService.js` — all Spotify API calls unchanged
- `src/context/SpotifyContext.js` — still exposes Spotify functions to the component tree
- `src/components/MainWorkspace.js` — no changes
- `src/components/TrackCard.js` — no changes in this plan
- `src/components/AIPanel.js` — no changes in this plan
- `src/components/TrackSearchModal.js` — no changes
- `src/components/PlaylistTracksModal.js` — minor only: add preview/no-preview Chip badges and `isDisabled` state to track rows (§7.4)
- `src/utils/helpers.js` — no changes
- All test files — updated separately after implementation
