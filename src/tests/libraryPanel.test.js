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
        const uploadBtn = screen.getByRole('button', { name: /Upload MP3/i });
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
        fireEvent.click(screen.getByTitle('Add to Workspace'));
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
        expect(await screen.findByPlaceholderText(/Search/i)).toBeInTheDocument();
    });

    it('shows playlist names after getUserPlaylists resolves', async () => {
        render(<LibraryPanel />);
        expect(await screen.findByText('Playlist One')).toBeInTheDocument();
        expect(screen.getByText('Playlist Two')).toBeInTheDocument();
    });

    it('clicking a playlist opens the PlaylistModal', async () => {
        render(<LibraryPanel />);
        fireEvent.click(await screen.findByText('Playlist One'));
        expect(screen.getByTestId('playlist-modal')).toBeInTheDocument();
    });

    it('closing PlaylistModal hides it', async () => {
        render(<LibraryPanel />);
        fireEvent.click(await screen.findByText('Playlist One'));
        fireEvent.click(screen.getByText('Close'));
        expect(screen.queryByTestId('playlist-modal')).not.toBeInTheDocument();
    });

    it('shows an error message when getUserPlaylists throws', async () => {
        mockGetUserPlaylists.mockRejectedValue(new Error('Network failure'));
        render(<LibraryPanel />);
        expect(await screen.findByText('Network failure')).toBeInTheDocument();
    });
});

// ─── Upload tip dismiss ───────────────────────────────────────────────────────

describe('LibraryPanel — upload tip dismiss', () => {
    it('shows the tip when user is logged in', async () => {
        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => { capturedSnapshotCb({ forEach: () => {} }); });
        expect(screen.getByText(/Name your file as the song title/i)).toBeInTheDocument();
    });

    it('hides the tip when the X button inside it is clicked', async () => {
        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => { capturedSnapshotCb({ forEach: () => {} }); });

        // eslint-disable-next-line testing-library/no-node-access
        const tipText = screen.getByText(/Name your file as the song title/i);
        // eslint-disable-next-line testing-library/no-node-access
        const tipContainer = tipText.closest('div');
        // eslint-disable-next-line testing-library/no-node-access
        const dismissBtn = tipContainer.querySelector('button');
        fireEvent.click(dismissBtn);

        expect(screen.queryByText(/Name your file as the song title/i)).not.toBeInTheDocument();
    });
});

// ─── Delete upload ────────────────────────────────────────────────────────────

describe('LibraryPanel — delete upload', () => {
    const singleUpload = {
        id: 'upload_1',
        data: () => ({
            title: 'Song To Delete',
            artistName: 'Artist',
            downloadUrl: 'https://cdn.example/song.mp3',
            storagePath: 'uploads/uid_123/song.mp3',
        }),
    };

    it('calls deleteObject and deleteDoc when delete button is clicked', async () => {
        const { deleteObject } = require('firebase/storage');
        const { deleteDoc } = require('firebase/firestore');
        deleteObject.mockResolvedValueOnce();
        deleteDoc.mockResolvedValueOnce();

        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => {
            capturedSnapshotCb({ forEach: (cb) => cb(singleUpload) });
        });

        const deleteBtn = screen.getByTitle('Delete file');
        fireEvent.click(deleteBtn);
        await waitFor(() => expect(deleteObject).toHaveBeenCalled());

        expect(deleteDoc).toHaveBeenCalled();
    });

    it('does not propagate the click to the parent (no handleAddTrack call)', async () => {
        const { deleteObject } = require('firebase/storage');
        deleteObject.mockResolvedValueOnce();

        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => {
            capturedSnapshotCb({ forEach: (cb) => cb(singleUpload) });
        });

        const deleteBtn = screen.getByTitle('Delete file');
        fireEvent.click(deleteBtn);

        expect(mockHandleAddTrack).not.toHaveBeenCalled();
    });
});

// ─── File upload ──────────────────────────────────────────────────────────────

describe('LibraryPanel — file upload', () => {
    beforeEach(() => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false }); // fingerprint step fails silently
        // resetMocks:true clears .mockResolvedValue — restore readId3Tags here.
        const { readId3Tags } = require('../utils/helpers');
        readId3Tags.mockResolvedValue({ title: null, artist: null, albumArtBlob: null });
    });
    afterEach(() => { delete global.fetch; });

    const triggerFileUpload = async (filename = 'track.mp3') => {
        // eslint-disable-next-line testing-library/no-node-access
        const fileInput = document.querySelector('input[type="file"]');
        const file = new File(['audio'], filename, { type: 'audio/mpeg' });
        Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
        fireEvent.change(fileInput);
    };

    it('shows "Uploading..." while the upload is in progress', async () => {
        const { uploadBytes } = require('firebase/storage');
        uploadBytes.mockReturnValue(new Promise(() => {})); // never resolves

        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => { capturedSnapshotCb({ forEach: () => {} }); });

        await triggerFileUpload();

        expect(screen.getByText('Uploading...')).toBeInTheDocument();
    });

    it('calls uploadBytes with the correct storage path on upload', async () => {
        const { uploadBytes, getDownloadURL, ref } = require('firebase/storage');
        uploadBytes.mockResolvedValueOnce({});
        getDownloadURL.mockResolvedValueOnce('https://cdn.example/track.mp3');

        render(<LibraryPanel />);
        await act(async () => { capturedAuthCb(mockUser); });
        await act(async () => { capturedSnapshotCb({ forEach: () => {} }); });

        await triggerFileUpload('my-song.mp3');
        await waitFor(() => expect(uploadBytes).toHaveBeenCalled());

        expect(ref).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('my-song.mp3'));
    });

    it('does not trigger upload when no user is signed in', async () => {
        const { uploadBytes } = require('firebase/storage');

        render(<LibraryPanel />);
        // No capturedAuthCb fired → currentUser is null

        await triggerFileUpload();

        expect(uploadBytes).not.toHaveBeenCalled();
    });
});

// ─── Spotify search ───────────────────────────────────────────────────────────

describe('LibraryPanel — Spotify search results', () => {
    beforeEach(() => {
        setupMocks({ spotify: { isSpotifyConnected: true } });
    });

    const typeQuery = async (text) => {
        const input = await screen.findByPlaceholderText(/Search Library.../i);
        fireEvent.change(input, {
            target: { value: text },
        });
    };

    it('shows tracks returned by searchSpotify after debounce', async () => {
        mockSearchSpotify.mockResolvedValue({
            tracks: {
                items: [{ id: 't1', name: 'Found Track', artists: [{ name: 'DJ Test' }], album: { images: [] } }],
            },
        });
        render(<LibraryPanel />);
        await typeQuery('Found Track');
        expect(await screen.findByText('Found Track', {}, { timeout: 1500 })).toBeInTheDocument();
        expect(screen.getByText('DJ Test')).toBeInTheDocument();
    });

    it('shows "No tracks found" when search returns empty items', async () => {
        mockSearchSpotify.mockResolvedValue({ tracks: { items: [] } });
        render(<LibraryPanel />);
        await typeQuery('xyznothing999');
        expect(await screen.findByText(/No tracks found/i, {}, { timeout: 1500 })).toBeInTheDocument();
    });

    it('shows an error message when searchSpotify rejects', async () => {
        mockSearchSpotify.mockRejectedValue(new Error('Search failed'));
        render(<LibraryPanel />);
        await typeQuery('error query');
        expect(await screen.findByText('Search failed', {}, { timeout: 1500 })).toBeInTheDocument();
    });

    it('clears results when the search input is cleared via X button', async () => {
        mockSearchSpotify.mockResolvedValue({
            tracks: {
                items: [{ id: 't1', name: 'Found Track', artists: [], album: { images: [] } }],
            },
        });
        render(<LibraryPanel />);
        await typeQuery('Found Track');
        await screen.findByText('Found Track', {}, { timeout: 1500 });

        // The X clear button appears when there is a search query
        const clearBtn = screen.getByRole('button', { name: '' });
        fireEvent.click(clearBtn);
        await waitFor(() => expect(screen.queryByText('Found Track')).not.toBeInTheDocument());
    });
});
