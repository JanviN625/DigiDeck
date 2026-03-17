import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LibraryPanel from '../components/LibraryPanel';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../spotify/appContext', () => ({
    useSpotify: jest.fn(),
    useMix: jest.fn(),
    useSpotifyConnect: jest.fn(),
}));

jest.mock('../firebase/firebaseConfig', () => ({
    auth: {},
    db: {},
    storage: {},
}));

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn((_db, ...path) => path.join('/')),
    addDoc: jest.fn(),
    onSnapshot: jest.fn(),
    query: jest.fn((col) => col),
    orderBy: jest.fn(() => 'orderBy_createdAt'),
    deleteDoc: jest.fn(),
    doc: jest.fn((_db, ...path) => path.join('/')),
}));

jest.mock('firebase/storage', () => ({
    ref: jest.fn((_storage, path) => ({ path })),
    uploadBytes: jest.fn(),
    getDownloadURL: jest.fn(),
    deleteObject: jest.fn(),
}));

jest.mock('../utils/helpers', () => ({
    readId3Tags: jest.fn().mockResolvedValue({ title: null, artist: null, albumArtBlob: null }),
    spotifyConfirmMatch: jest.fn(() => null),
    getDynamicInputWidth: jest.fn(() => 100),
}));

// Stub PlaylistModal to avoid its own heavy dependency tree.
jest.mock('../components/PlaylistModal', () => ({
    __esModule: true,
    default: ({ isOpen, onClose, playlist }) =>
        isOpen ? (
            <div data-testid="playlist-modal">
                <span>{playlist?.name}</span>
                <button onClick={onClose}>Close</button>
            </div>
        ) : null,
}));

jest.mock('@heroui/react', () => ({
    Button: ({ onPress, children, disabled, ...props }) => (
        <button onClick={onPress} disabled={disabled} {...props}>
            {children}
        </button>
    ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockGetUserPlaylists = jest.fn();
const mockSearchSpotify = jest.fn();
const mockHandleAddTrack = jest.fn();
const mockHandleUpdateTrack = jest.fn();
const mockConnectSpotify = jest.fn();
const mockDisconnectSpotify = jest.fn();

const mockPlaylists = [
    { id: 'p1', name: 'Playlist One', images: [], tracks: { total: 3 } },
    { id: 'p2', name: 'Playlist Two', images: [], tracks: { total: 7 } },
];

const mockUser = { uid: 'uid_123', email: 'user@test.com' };

let capturedAuthCb;
let capturedSnapshotCb;

const setupMocks = (overrides = {}) => {
    const { useSpotify, useMix, useSpotifyConnect } = require('../spotify/appContext');
    const { onAuthStateChanged } = require('firebase/auth');
    const { onSnapshot } = require('firebase/firestore');
    const { collection, doc } = require('firebase/firestore');

    // Restore mock implementations cleared by resetMocks:true
    collection.mockImplementation((_db, ...path) => path.join('/'));
    doc.mockImplementation((_db, ...path) => path.join('/'));

    useSpotify.mockReturnValue({
        getUserPlaylists: mockGetUserPlaylists,
        searchSpotify: mockSearchSpotify,
    });

    useMix.mockReturnValue({
        handleAddTrack: mockHandleAddTrack,
        tracks: [],
        handleUpdateTrack: mockHandleUpdateTrack,
    });

    useSpotifyConnect.mockReturnValue({
        isSpotifyConnected: false,
        connectSpotify: mockConnectSpotify,
        disconnectSpotify: mockDisconnectSpotify,
        isConnecting: false,
        ...((overrides.spotify) || {}),
    });

    onAuthStateChanged.mockImplementation((auth, cb) => {
        capturedAuthCb = cb;
        return jest.fn();
    });

    onSnapshot.mockImplementation((q, cb, errCb) => {
        capturedSnapshotCb = cb;
        return jest.fn();
    });

    mockGetUserPlaylists.mockResolvedValue({ items: mockPlaylists });
    mockSearchSpotify.mockResolvedValue({ tracks: { items: [] } });
};

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCb = null;
    capturedSnapshotCb = null;
    setupMocks();
});

// ─── Initial rendering ────────────────────────────────────────────────────────

describe('LibraryPanel — initial rendering', () => {
    it('renders "Library" heading by default', () => {
        render(<LibraryPanel />);
        expect(screen.getByText('Library')).toBeInTheDocument();
    });

    it('renders the "YOUR FILES" section label', () => {
        render(<LibraryPanel />);
        expect(screen.getByText(/YOUR FILES/i)).toBeInTheDocument();
    });

    it('renders the "SPOTIFY CATALOG" section label', () => {
        render(<LibraryPanel />);
        expect(screen.getByText(/SPOTIFY CATALOG/i)).toBeInTheDocument();
    });

    it('shows collapse button when expanded', () => {
        render(<LibraryPanel />);
        expect(screen.getByTitle('Collapse Library')).toBeInTheDocument();
    });
});

// ─── Collapse / Expand ────────────────────────────────────────────────────────

describe('LibraryPanel — collapse and expand', () => {
    it('collapses when the collapse button is clicked', () => {
        render(<LibraryPanel />);
        fireEvent.click(screen.getByTitle('Collapse Library'));
        // After collapsing, "Library" text heading is gone and expand button appears
        expect(screen.queryByTitle('Collapse Library')).not.toBeInTheDocument();
        expect(screen.getByTitle('Expand Library')).toBeInTheDocument();
    });

    it('expands again when the expand button is clicked', () => {
        render(<LibraryPanel />);
        fireEvent.click(screen.getByTitle('Collapse Library'));
        fireEvent.click(screen.getByTitle('Expand Library'));
        expect(screen.getByTitle('Collapse Library')).toBeInTheDocument();
    });
});

// ─── Upload section ───────────────────────────────────────────────────────────

describe('LibraryPanel — upload section', () => {
    it('shows "Sign in to upload" message when not logged in', () => {
        render(<LibraryPanel />);
        // No auth callback fired yet — currentUser is null
        expect(screen.getByText(/Sign in to upload/i)).toBeInTheDocument();
    });

    it('shows Upload MP3 button (disabled when no user)', () => {
        render(<LibraryPanel />);
        const uploadBtn = screen.getByText(/Upload MP3/i).closest('button');
        expect(uploadBtn).toBeDisabled();
    });

    it('shows "No files yet" message when user is logged in but has no uploads', async () => {
        render(<LibraryPanel />);
        await act(async () => {
            capturedAuthCb(mockUser);
        });
        // Snapshot fires with empty docs
        await act(async () => {
            capturedSnapshotCb({ forEach: () => {} });
        });
        expect(screen.getByText(/No files yet/i)).toBeInTheDocument();
    });

    it('renders user uploads when snapshot has documents', async () => {
        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => {
            capturedSnapshotCb({
                forEach: (cb) => {
                    cb({ id: 'upload_1', data: () => ({ title: 'My Song', artistName: 'Me', downloadUrl: 'https://cdn.example/song.mp3' }) });
                    cb({ id: 'upload_2', data: () => ({ title: 'Another Song', artistName: null, downloadUrl: 'https://cdn.example/song2.mp3' }) });
                },
            });
        });
        expect(screen.getByText('My Song')).toBeInTheDocument();
        expect(screen.getByText('Another Song')).toBeInTheDocument();
    });

    it('clicking an upload calls handleAddTrack', async () => {
        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => {
            capturedSnapshotCb({
                forEach: (cb) => cb({ id: 'up_1', data: () => ({ title: 'Track A', artistName: 'Artist', downloadUrl: 'https://cdn.example/a.mp3' }) }),
            });
        });
        fireEvent.click(screen.getByText('Track A').closest('[title="Add to Workspace"]'));
        await waitFor(() => expect(mockHandleAddTrack).toHaveBeenCalledTimes(1));
    });
});

// ─── Spotify section ──────────────────────────────────────────────────────────

describe('LibraryPanel — Spotify section (not connected)', () => {
    it('shows Connect Spotify button when not connected', () => {
        render(<LibraryPanel />);
        expect(screen.getByText('Connect Spotify')).toBeInTheDocument();
    });

    it('clicking Connect Spotify calls connectSpotify', () => {
        render(<LibraryPanel />);
        fireEvent.click(screen.getByText('Connect Spotify'));
        expect(mockConnectSpotify).toHaveBeenCalledTimes(1);
    });

    it('shows a loading spinner when isConnecting is true', () => {
        setupMocks({ spotify: { isConnecting: true } });
        render(<LibraryPanel />);
        // The animated spinner div is shown instead of the connect button
        expect(screen.queryByText('Connect Spotify')).not.toBeInTheDocument();
    });
});

describe('LibraryPanel — Spotify section (connected)', () => {
    beforeEach(() => {
        setupMocks({ spotify: { isSpotifyConnected: true } });
    });

    it('shows the search input when Spotify is connected', async () => {
        render(<LibraryPanel />);
        await waitFor(() => expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument());
    });

    it('shows playlist names after getUserPlaylists resolves', async () => {
        render(<LibraryPanel />);
        await waitFor(() => expect(screen.getByText('Playlist One')).toBeInTheDocument());
        expect(screen.getByText('Playlist Two')).toBeInTheDocument();
    });

    it('clicking a playlist opens the PlaylistModal', async () => {
        render(<LibraryPanel />);
        await waitFor(() => screen.getByText('Playlist One'));
        fireEvent.click(screen.getByText('Playlist One'));
        expect(screen.getByTestId('playlist-modal')).toBeInTheDocument();
    });

    it('closing PlaylistModal hides it', async () => {
        render(<LibraryPanel />);
        await waitFor(() => screen.getByText('Playlist One'));
        fireEvent.click(screen.getByText('Playlist One'));
        fireEvent.click(screen.getByText('Close'));
        expect(screen.queryByTestId('playlist-modal')).not.toBeInTheDocument();
    });
});
