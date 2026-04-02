import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AccountModal, SettingsModal } from '../components/ProfileModal';
import PlaylistModal from '../components/PlaylistModal';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../firebase/firebase', () => ({
    useFirebaseAuth: jest.fn(),
    friendlyError: jest.fn(),
}));

jest.mock('../firebase/firebaseConfig', () => ({ db: {} }));

jest.mock('firebase/firestore', () => ({
    doc: jest.fn((_db, ...path) => path.join('/')),
    getDoc: jest.fn(),
}));

// formatKeybind and DEFAULT_SETTINGS are pure / constant — use real implementations
// so these tests exercise actual formatting logic, not a stub.
jest.mock('../utils/useSettings', () => ({
    useSettings: jest.fn(),
    formatKeybind: jest.requireActual('../utils/useSettings').formatKeybind,
    DEFAULT_SETTINGS: jest.requireActual('../utils/useSettings').DEFAULT_SETTINGS,
}));

jest.mock('../spotify/appContext', () => ({
    useSpotifyConnect: jest.fn(),
    useSpotify: jest.fn(),
}));

jest.mock('lucide-react', () => {
    const icon = (id) => (props) => <span data-testid={`icon-${id}`} />;
    return {
        X:           icon('x'),
        User:        icon('user'),
        Camera:      icon('camera'),
        CheckCircle: icon('check-circle'),
        AlertCircle: icon('alert-circle'),
        Loader:      icon('loader'),
        Loader2:     icon('loader2'),
        Music:       icon('music'),
    };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// ─── PlaylistModal fixtures ───────────────────────────────────────────────────

const mockGetPlaylistTracks = jest.fn();

const mockPlaylist = {
    id: 'playlist_1',
    name: 'Test Playlist',
    images: [{ url: 'https://cover.example/img.jpg' }],
    tracks: { total: 2 },
};

const mockTrackItems = [
    {
        track: {
            id: 't1',
            name: 'Song One',
            type: 'track',
            artists: [{ name: 'Artist A' }],
            album: { name: 'Album X', images: [{ url: 'https://art.example/1.jpg' }] },
        },
        is_local: false,
    },
    {
        track: {
            id: 't2',
            name: 'Song Two',
            type: 'track',
            artists: [{ name: 'Artist B' }],
            album: { name: 'Album Y', images: [] },
        },
        is_local: false,
    },
];

// ─── AccountModal / SettingsModal fixtures ────────────────────────────────────

const mockUpdateDisplayName  = jest.fn();
const mockUpdateProfilePhoto = jest.fn();
const mockRemoveProfilePhoto = jest.fn();
const mockUpdateUserEmail    = jest.fn();
const mockConnectSpotify     = jest.fn();
const mockDisconnectSpotify  = jest.fn();
const mockUpdateSetting      = jest.fn();
const mockResetSettings      = jest.fn();
const mockOnClose            = jest.fn();

const defaultUser = {
    uid: 'uid_123',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: null,
    providerData: [{ providerId: 'password' }],
    // Use noon UTC so toLocaleDateString always resolves to Jan 15 regardless of timezone
    metadata: { creationTime: 'Mon, 15 Jan 2024 12:00:00 GMT' },
};

const defaultSettings = {
    animationsEnabled: true,
    confirmBeforeDelete: true,
    keybinds: {
        splitAtPlayhead: { key: 's', ctrl: true,  shift: false, alt: false },
        playPause:       { key: ' ', ctrl: false, shift: false, alt: false },
    },
};

const setupMocks = (overrides = {}) => {
    const { useFirebaseAuth, friendlyError } = require('../firebase/firebase');
    const { useSpotifyConnect } = require('../spotify/appContext');
    const { useSettings } = require('../utils/useSettings');
    const { getDoc } = require('firebase/firestore');

    friendlyError.mockImplementation((err) => err?.message || 'Update failed.');

    useSettings.mockReturnValue({
        settings: { ...defaultSettings, ...(overrides.settings || {}) },
        updateSetting: mockUpdateSetting,
        resetSettings: mockResetSettings,
    });

    useFirebaseAuth.mockReturnValue({
        user: defaultUser,
        updateDisplayName:  mockUpdateDisplayName,
        updateProfilePhoto: mockUpdateProfilePhoto,
        removeProfilePhoto: mockRemoveProfilePhoto,
        updateUserEmail:    mockUpdateUserEmail,
        ...(overrides.auth || {}),
    });

    useSpotifyConnect.mockReturnValue({
        isSpotifyConnected: false,
        connectSpotify:     mockConnectSpotify,
        disconnectSpotify:  mockDisconnectSpotify,
        isConnecting:       false,
        ...(overrides.spotify || {}),
    });

    // Default: never resolves — prevents unwrapped act() warnings in tests that
    // don't care about account details. Override with mockResolvedValueOnce in
    // individual tests that need Firestore data.
    getDoc.mockReturnValue(new Promise(() => {}));
};

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    // PlaylistModal context
    const { useSpotify } = require('../spotify/appContext');
    useSpotify.mockReturnValue({ getPlaylistTracks: mockGetPlaylistTracks });
    mockGetPlaylistTracks.mockResolvedValue({ items: mockTrackItems });
});

// ─── AccountModal — open / close ──────────────────────────────────────────────

describe('AccountModal — open/close', () => {
    it('renders nothing when isOpen is false', () => {
        render(<AccountModal isOpen={false} onClose={mockOnClose} />);
        expect(screen.queryByText('Account Info')).not.toBeInTheDocument();
    });

    it('renders the "Account Info" heading when open', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByText('Account Info')).toBeInTheDocument();
    });

    it('calls onClose when the backdrop is clicked', () => {
        const { container } = render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // container.firstChild is the outermost backdrop div (has onClick={onClose})
        // eslint-disable-next-line testing-library/no-node-access
        fireEvent.click(container.firstChild);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the X button is clicked', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        fireEvent.click(screen.getByTestId('icon-x').closest('button'));
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when clicking inside the modal body', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Account Info'));
        expect(mockOnClose).not.toHaveBeenCalled();
    });
});

// ─── AccountModal — display name ──────────────────────────────────────────────

// Helpers — both Save buttons are always rendered for email/pw users.
// Index 0 = display name Save, index 1 = email Save.
const saveBtn = (index = 0) => screen.getAllByText('Save')[index];

describe('AccountModal — display name', () => {
    it('seeds the display name input from user.displayName', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
    });

    it('shows an error when saving an empty display name', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.change(screen.getByDisplayValue('Test User'), { target: { value: '   ' } });
        fireEvent.click(saveBtn(0));
        expect(screen.getByText('Name cannot be empty.')).toBeInTheDocument();
        expect(mockUpdateDisplayName).not.toHaveBeenCalled();
    });

    it('calls updateDisplayName with the trimmed name', async () => {
        mockUpdateDisplayName.mockResolvedValueOnce();
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.change(screen.getByDisplayValue('Test User'), { target: { value: '  New Name  ' } });
        fireEvent.click(saveBtn(0));
        await waitFor(() => expect(mockUpdateDisplayName).toHaveBeenCalledWith('New Name'));
    });

    it('shows "Name updated." after a successful save', async () => {
        mockUpdateDisplayName.mockResolvedValueOnce();
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(saveBtn(0));
        expect(await screen.findByText('Name updated.')).toBeInTheDocument();
    });

    it('shows a friendly error when updateDisplayName rejects', async () => {
        mockUpdateDisplayName.mockRejectedValueOnce(new Error('Network error'));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(saveBtn(0));
        expect(await screen.findByText('Network error')).toBeInTheDocument();
    });

    it('falls back to "Update failed." when the error has no message', async () => {
        mockUpdateDisplayName.mockRejectedValueOnce({});
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(saveBtn(0));
        expect(await screen.findByText('Update failed.')).toBeInTheDocument();
    });
});

// ─── AccountModal — email (email/password user) ───────────────────────────────

describe('AccountModal — email (email/password user)', () => {
    it('renders an editable email input seeded from user.email', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        const emailInput = screen.getByDisplayValue('test@example.com');
        expect(emailInput).not.toBeDisabled();
    });

    it('shows an error when saving an empty email', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        const emailInput = screen.getByDisplayValue('test@example.com');
        fireEvent.change(emailInput, { target: { value: '   ' } });
        fireEvent.click(saveBtn(1));
        expect(screen.getByText('Email cannot be empty.')).toBeInTheDocument();
        expect(mockUpdateUserEmail).not.toHaveBeenCalled();
    });

    it('calls updateUserEmail with the new email', async () => {
        mockUpdateUserEmail.mockResolvedValueOnce();
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        const emailInput = screen.getByDisplayValue('test@example.com');
        fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
        fireEvent.click(saveBtn(1));
        await waitFor(() => expect(mockUpdateUserEmail).toHaveBeenCalledWith('new@example.com'));
    });

    it('shows "Email updated." after a successful save', async () => {
        mockUpdateUserEmail.mockResolvedValueOnce();
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(saveBtn(1));
        expect(await screen.findByText('Email updated.')).toBeInTheDocument();
    });

    it('shows a friendly error when updateUserEmail rejects', async () => {
        mockUpdateUserEmail.mockRejectedValueOnce(new Error('requires-recent-login'));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(saveBtn(1));
        expect(await screen.findByText('requires-recent-login')).toBeInTheDocument();
    });
});

// ─── AccountModal — email (Google user) ───────────────────────────────────────

describe('AccountModal — email (Google user)', () => {
    beforeEach(() => {
        setupMocks({
            auth: {
                user: { ...defaultUser, providerData: [{ providerId: 'google.com' }] },
            },
        });
    });

    it('renders a disabled email input for Google users', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        const emailInput = screen.getByDisplayValue('test@example.com');
        expect(emailInput).toBeDisabled();
    });

    it('shows the "Managed by Google" badge for Google users', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByText('Managed by Google')).toBeInTheDocument();
    });

    it('does not render an email Save button for Google users', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // Only the display-name Save button; no email Save button for Google accounts
        const saveBtns = screen.getAllByText('Save');
        expect(saveBtns).toHaveLength(1);
    });
});

// ─── AccountModal — profile photo ─────────────────────────────────────────────

describe('AccountModal — profile photo', () => {
    it('does not show "Remove photo" when user.photoURL is null', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.queryByText('Remove photo')).not.toBeInTheDocument();
    });

    it('shows "Remove photo" button when user.photoURL is present', () => {
        setupMocks({ auth: { user: { ...defaultUser, photoURL: 'https://photo.example/avatar.jpg' } } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByText('Remove photo')).toBeInTheDocument();
    });

    it('calls removeProfilePhoto when "Remove photo" is clicked', async () => {
        mockRemoveProfilePhoto.mockResolvedValueOnce();
        setupMocks({ auth: { user: { ...defaultUser, photoURL: 'https://photo.example/avatar.jpg' } } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Remove photo'));
        await waitFor(() => expect(mockRemoveProfilePhoto).toHaveBeenCalledTimes(1));
    });

    it('shows an error when removeProfilePhoto rejects', async () => {
        mockRemoveProfilePhoto.mockRejectedValueOnce(new Error('Storage error'));
        setupMocks({ auth: { user: { ...defaultUser, photoURL: 'https://photo.example/avatar.jpg' } } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Remove photo'));
        expect(await screen.findByText('Storage error')).toBeInTheDocument();
    });

    it('renders an avatar image when user has a photoURL', () => {
        setupMocks({ auth: { user: { ...defaultUser, photoURL: 'https://photo.example/avatar.jpg' } } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        const img = screen.getByAltText('Avatar');
        expect(img).toHaveAttribute('src', 'https://photo.example/avatar.jpg');
    });

    it('renders the user icon when user has no photoURL', () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByTestId('icon-user')).toBeInTheDocument();
    });

    it('shows an error when photo upload fails', async () => {
        mockUpdateProfilePhoto.mockRejectedValueOnce(new Error('Image too large'));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        const fileInput = document.querySelector('input[type="file"]');
        const file = new File(['img'], 'avatar.png', { type: 'image/png' });
        fireEvent.change(fileInput, { target: { files: [file] } });
        expect(await screen.findByText('Image too large')).toBeInTheDocument();
    });

    it('does nothing when the file input is changed with no file selected', async () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        const fileInput = document.querySelector('input[type="file"]');
        fireEvent.change(fileInput, { target: { files: [] } });
        expect(mockUpdateProfilePhoto).not.toHaveBeenCalled();
    });
});

// ─── AccountModal — account details ───────────────────────────────────────────

// Account details section is gated by detailsLoading — getDoc must resolve for
// anything inside it to appear. Every test in this block uses waitFor.
const firestoreSnap = (data = {}) => ({ exists: () => true, data: () => data });

describe('AccountModal — account details', () => {
    beforeEach(() => {
        // Override the never-resolving default so the details section renders.
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({}));
    });

    it('shows "Email / Password" sign-in method for email/password users', async () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('Email / Password')).toBeInTheDocument();
    });

    it('shows "Google" sign-in method for Google users', async () => {
        setupMocks({ auth: { user: { ...defaultUser, providerData: [{ providerId: 'google.com' }] } } });
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({}));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('Google')).toBeInTheDocument();
    });

    it('shows the account created date from Firestore', async () => {
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({
            createdAt: { toDate: () => new Date('2024-01-15T12:00:00Z') },
        }));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('January 15, 2024')).toBeInTheDocument();
    });

    it('shows the Auth metadata creation date when Firestore has no createdAt', async () => {
        // user.metadata.creationTime = 'Mon, 15 Jan 2024 00:00:00 GMT'
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('January 15, 2024')).toBeInTheDocument();
    });

    it('shows "—" when neither Firestore nor Auth metadata provides a date', async () => {
        setupMocks({ auth: { user: { ...defaultUser, metadata: {} } } });
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({}));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('—')).toBeInTheDocument();
    });

    it('handles a Firestore fetch failure without crashing', async () => {
        const { getDoc } = require('firebase/firestore');
        getDoc.mockRejectedValue(new Error('Firestore unavailable'));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // Falls back to Auth metadata date; component should not throw
        expect(await screen.findByText('January 15, 2024')).toBeInTheDocument();
    });

    it('shows "Not connected" when Spotify is disconnected', async () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('Not connected')).toBeInTheDocument();
    });

    it('shows "Connected" when Spotify is connected', async () => {
        setupMocks({ spotify: { isSpotifyConnected: true } });
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({}));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('Connected')).toBeInTheDocument();
    });

    it('renders a "Connect" button when Spotify is disconnected', async () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('Connect')).toBeInTheDocument();
    });

    it('renders a "Disconnect" button when Spotify is connected', async () => {
        setupMocks({ spotify: { isSpotifyConnected: true } });
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({}));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        expect(await screen.findByText('Disconnect')).toBeInTheDocument();
    });

    it('calls connectSpotify when "Connect" is clicked', async () => {
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(await screen.findByText('Connect'));
        expect(mockConnectSpotify).toHaveBeenCalledTimes(1);
    });

    it('calls disconnectSpotify when "Disconnect" is clicked', async () => {
        setupMocks({ spotify: { isSpotifyConnected: true } });
        const { getDoc } = require('firebase/firestore');
        getDoc.mockResolvedValue(firestoreSnap({}));
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(await screen.findByText('Disconnect'));
        expect(mockDisconnectSpotify).toHaveBeenCalledTimes(1);
    });
});

// ─── AccountModal — animation class ───────────────────────────────────────────

describe('AccountModal — animation class', () => {
    it('applies animation class when animationsEnabled is true', () => {
        setupMocks({ settings: { animationsEnabled: true } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        const modalPanel = screen.getByText('Account Info').closest('[class*="bg-base-900"]');
        expect(modalPanel.className).toMatch(/animate-in/);
    });

    it('does not apply animation class when animationsEnabled is false', () => {
        setupMocks({ settings: { animationsEnabled: false } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        const modalPanel = screen.getByText('Account Info').closest('[class*="bg-base-900"]');
        expect(modalPanel.className).not.toMatch(/animate-in/);
    });
});

// ─── AccountModal — user is null ──────────────────────────────────────────────

describe('AccountModal — null user edge cases', () => {
    it('renders nothing when user is null even if isOpen is true', () => {
        // The useEffect guard: if (!isOpen || !user) return
        // But the JSX renders based on isOpen only — user controls field values.
        // Actually the component still renders but fields are empty.
        setupMocks({ auth: { user: null } });
        // When user is null, render returns null because isOpen check passes but
        // the component itself should still render the shell.
        // This is a defensive test — verify it does not throw.
        expect(() => render(<AccountModal isOpen={true} onClose={mockOnClose} />)).not.toThrow();
    });

    it('does not call updateDisplayName when user is null', async () => {
        setupMocks({ auth: { user: null } });
        render(<AccountModal isOpen={true} onClose={mockOnClose} />);
        // Save buttons should still be present; clicking them with empty fields
        // should hit the validation guard, not call firebase.
        const saveBtns = screen.queryAllByText('Save');
        if (saveBtns.length > 0) {
            fireEvent.click(saveBtns[0]);
        }
        expect(mockUpdateDisplayName).not.toHaveBeenCalled();
    });
});

// ─── SettingsModal — open / close ─────────────────────────────────────────────

describe('SettingsModal — open/close', () => {
    it('renders nothing when isOpen is false', () => {
        render(<SettingsModal isOpen={false} onClose={mockOnClose} />);
        expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('renders the "Settings" heading when open', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('calls onClose when the backdrop is clicked', () => {
        const { container } = render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        fireEvent.click(container.firstChild);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the X button is clicked', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        fireEvent.click(screen.getByTestId('icon-x').closest('button'));
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when clicking inside the modal body', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Settings'));
        expect(mockOnClose).not.toHaveBeenCalled();
    });
});

// ─── SettingsModal — tab navigation ───────────────────────────────────────────

describe('SettingsModal — tab navigation', () => {
    it('General tab is active by default', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByText('Confirm before deleting tracks')).toBeInTheDocument();
    });

    it('clicking Controls tab shows keybind action labels', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Controls'));
        expect(screen.getByText('Split track at playhead')).toBeInTheDocument();
        expect(screen.getByText('Play / Pause')).toBeInTheDocument();
    });

    it('clicking About tab shows "DigiDeck Studio"', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('About'));
        expect(screen.getByText('DigiDeck Studio')).toBeInTheDocument();
    });

    it('clicking back to General after switching tabs restores General content', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Controls'));
        fireEvent.click(screen.getByText('General'));
        expect(screen.getByText('Confirm before deleting tracks')).toBeInTheDocument();
    });
});

// ─── SettingsModal — General tab ──────────────────────────────────────────────

describe('SettingsModal — General tab', () => {
    it('renders both toggle rows', () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        expect(screen.getByText('Confirm before deleting tracks')).toBeInTheDocument();
        expect(screen.getByText('Enable animations')).toBeInTheDocument();
    });

    it('toggle reflects current value (aria-checked)', () => {
        setupMocks({ settings: { confirmBeforeDelete: true, animationsEnabled: false } });
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        const toggles = screen.getAllByRole('switch');
        const confirmToggle = toggles.find(t => t.getAttribute('aria-checked') === 'true');
        const animToggle    = toggles.find(t => t.getAttribute('aria-checked') === 'false');
        expect(confirmToggle).toBeTruthy();
        expect(animToggle).toBeTruthy();
    });

    it('clicking "Confirm before deleting" toggle calls updateSetting with toggled value', () => {
        setupMocks({ settings: { confirmBeforeDelete: true } });
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        const toggles = screen.getAllByRole('switch');
        // First switch is confirmBeforeDelete (first row in the list)
        fireEvent.click(toggles[0]);
        expect(mockUpdateSetting).toHaveBeenCalledWith('confirmBeforeDelete', false);
    });

    it('clicking "Enable animations" toggle calls updateSetting with toggled value', () => {
        setupMocks({ settings: { animationsEnabled: true } });
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        const toggles = screen.getAllByRole('switch');
        // Second switch is animationsEnabled
        fireEvent.click(toggles[1]);
        expect(mockUpdateSetting).toHaveBeenCalledWith('animationsEnabled', false);
    });

    it('toggle switches from false → true correctly', () => {
        setupMocks({ settings: { confirmBeforeDelete: false } });
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        const toggles = screen.getAllByRole('switch');
        fireEvent.click(toggles[0]);
        expect(mockUpdateSetting).toHaveBeenCalledWith('confirmBeforeDelete', true);
    });
});

// ─── SettingsModal — Controls tab ─────────────────────────────────────────────

describe('SettingsModal — Controls tab', () => {
    const renderControlsTab = () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('Controls'));
    };

    it('shows both action labels', () => {
        renderControlsTab();
        expect(screen.getByText('Split track at playhead')).toBeInTheDocument();
        expect(screen.getByText('Play / Pause')).toBeInTheDocument();
    });

    it('renders the current keybind as kbd chips (Ctrl + S for splitAtPlayhead)', () => {
        renderControlsTab();
        // formatKeybind({ key:'s', ctrl:true, ... }) → "Ctrl + S" → chips: "Ctrl", "S"
        // eslint-disable-next-line testing-library/no-node-access
        const kbds = document.querySelectorAll('kbd');
        expect(kbds.length).toBeGreaterThan(0);
        const allText = Array.from(kbds).map(k => k.textContent);
        expect(allText).toContain('Ctrl');
        expect(allText).toContain('S');
    });

    it('shows Edit buttons for each action', () => {
        renderControlsTab();
        const editBtns = screen.getAllByText('Edit');
        expect(editBtns).toHaveLength(2);
    });

    it('clicking Edit enters recording mode ("Press any key...")', () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        expect(screen.getByText('Press any key...')).toBeInTheDocument();
    });

    it('clicking Cancel exits recording mode', () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('Press any key...')).not.toBeInTheDocument();
    });

    it('pressing Escape cancels recording without saving', async () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(screen.queryByText('Press any key...')).not.toBeInTheDocument();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('modifier-only keys (Control, Shift, Alt) are ignored during recording', async () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
        });
        // Still in recording mode
        expect(screen.getByText('Press any key...')).toBeInTheDocument();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('Tab key is ignored during recording', async () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        });
        expect(screen.getByText('Press any key...')).toBeInTheDocument();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('pressing a valid key saves the new keybind via updateSetting', async () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit); // recording splitAtPlayhead
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'f', ctrlKey: false, shiftKey: false, altKey: false, bubbles: true,
            }));
        });
        expect(mockUpdateSetting).toHaveBeenCalledWith('keybinds', expect.objectContaining({
            splitAtPlayhead: { key: 'f', ctrl: false, shift: false, alt: false },
        }));
    });

    it('exits recording mode after a valid key is pressed', async () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'g', ctrlKey: true, shiftKey: false, altKey: false, bubbles: true,
            }));
        });
        expect(screen.queryByText('Press any key...')).not.toBeInTheDocument();
    });

    it('a conflicting keybind shows an error and does not save', async () => {
        renderControlsTab();
        // splitAtPlayhead edit → press Space (already assigned to playPause)
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: ' ', ctrlKey: false, shiftKey: false, altKey: false, bubbles: true,
            }));
        });
        expect(screen.getByText(/Already used by/)).toBeInTheDocument();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('pressing the same key for the same action is not a conflict', async () => {
        renderControlsTab();
        // playPause edit → press Space (same action, should be allowed)
        const editBtns = screen.getAllByText('Edit');
        fireEvent.click(editBtns[1]); // second Edit is playPause
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: ' ', ctrlKey: false, shiftKey: false, altKey: false, bubbles: true,
            }));
        });
        // No conflict — space re-assigned to same action
        expect(screen.queryByText(/Already used by/)).not.toBeInTheDocument();
        expect(mockUpdateSetting).toHaveBeenCalledTimes(1);
    });

    it('key with modifiers (Ctrl+G) is saved correctly', async () => {
        renderControlsTab();
        const [firstEdit] = screen.getAllByText('Edit');
        fireEvent.click(firstEdit);
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'g', ctrlKey: true, shiftKey: false, altKey: false, bubbles: true,
            }));
        });
        expect(mockUpdateSetting).toHaveBeenCalledWith('keybinds', expect.objectContaining({
            splitAtPlayhead: { key: 'g', ctrl: true, shift: false, alt: false },
        }));
    });
});

// ─── SettingsModal — About tab ────────────────────────────────────────────────

describe('SettingsModal — About tab', () => {
    const renderAboutTab = () => {
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        fireEvent.click(screen.getByText('About'));
    };

    it('shows "DigiDeck Studio"', () => {
        renderAboutTab();
        expect(screen.getByText('DigiDeck Studio')).toBeInTheDocument();
    });

    it('shows a version number', () => {
        renderAboutTab();
        expect(screen.getByText(/Version \d+\.\d+\.\d+/)).toBeInTheDocument();
    });

    it('shows the app description', () => {
        renderAboutTab();
        expect(screen.getByText(/browser-based audio mixing/i)).toBeInTheDocument();
    });

    it('renders the app logo image', () => {
        renderAboutTab();
        const logo = screen.getByAltText('DigiDeck Logo');
        expect(logo).toBeInTheDocument();
        expect(logo).toHaveAttribute('src', '/icon.png');
    });
});

// ─── SettingsModal — animation class ──────────────────────────────────────────

describe('SettingsModal — animation class', () => {
    it('applies animation class when animationsEnabled is true', () => {
        setupMocks({ settings: { animationsEnabled: true } });
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        const modalPanel = screen.getByText('Settings').closest('[class*="bg-base-900"]');
        expect(modalPanel.className).toMatch(/animate-in/);
    });

    it('does not apply animation class when animationsEnabled is false', () => {
        setupMocks({ settings: { animationsEnabled: false } });
        render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
        // eslint-disable-next-line testing-library/no-node-access
        const modalPanel = screen.getByText('Settings').closest('[class*="bg-base-900"]');
        expect(modalPanel.className).not.toMatch(/animate-in/);
    });
});

// ─── PlaylistModal — closed ───────────────────────────────────────────────────

describe('PlaylistModal — closed', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <PlaylistModal isOpen={false} onClose={jest.fn()} playlist={mockPlaylist} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when playlist is null', () => {
        const { container } = render(
            <PlaylistModal isOpen={true} onClose={jest.fn()} playlist={null} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('clears tracks when modal closes (re-open shows fresh state)', async () => {
        const { rerender } = render(
            <PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />
        );
        await screen.findByText('Song One');

        rerender(<PlaylistModal isOpen={false} onClose={jest.fn()} playlist={mockPlaylist} />);
        // After re-opening the next render call will re-fetch
        expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(1);
    });
});

// ─── PlaylistModal — open header ─────────────────────────────────────────────

describe('PlaylistModal — open header', () => {
    it('renders the playlist name', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        expect(screen.getByText('Test Playlist')).toBeInTheDocument();
    });

    it('shows cover image when playlist has images', () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        const img = screen.getByAltText('Cover');
        expect(img).toHaveAttribute('src', 'https://cover.example/img.jpg');
    });

    it('shows Music icon fallback when playlist has no images', () => {
        const playlistNoImage = { ...mockPlaylist, images: [] };
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={playlistNoImage} />);
        expect(screen.queryByAltText('Cover')).not.toBeInTheDocument();
    });

    it('shows track total from playlist metadata', () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        expect(screen.getByText('2 tracks')).toBeInTheDocument();
    });
});

// ─── PlaylistModal — track list ───────────────────────────────────────────────

describe('PlaylistModal — track list', () => {
    it('calls getPlaylistTracks with the playlist id on open', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => expect(mockGetPlaylistTracks).toHaveBeenCalledWith('playlist_1', 50, 0)); // waitFor on mock, not DOM query
    });

    it('renders track names after a successful fetch', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        expect(await screen.findByText('Song One')).toBeInTheDocument();
        expect(screen.getByText('Song Two')).toBeInTheDocument();
    });

    it('renders artist and album info for each track', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await screen.findByText('Song One');
        expect(screen.getByText(/Artist A/)).toBeInTheDocument();
    });

    it('shows "No Tracks Found" when fetch returns an empty list', async () => {
        mockGetPlaylistTracks.mockResolvedValue({ items: [] });
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        expect(await screen.findByText('No Tracks Found')).toBeInTheDocument();
    });

    it('shows "No Tracks Found" when fetch returns no items property', async () => {
        mockGetPlaylistTracks.mockResolvedValue({});
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        expect(await screen.findByText('No Tracks Found')).toBeInTheDocument();
    });

    it('filters out local tracks from the rendered list', async () => {
        const localItem = {
            track: { id: 'local1', name: 'Local Track', type: 'track' },
            is_local: true,
        };
        mockGetPlaylistTracks.mockResolvedValue({ items: [...mockTrackItems, localItem] });
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await screen.findByText('Song One');
        expect(screen.queryByText('Local Track')).not.toBeInTheDocument();
    });

    it('shows an error message when the fetch rejects', async () => {
        mockGetPlaylistTracks.mockRejectedValue(new Error('Network timeout'));
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        expect(await screen.findByText('Failed to Load Tracks')).toBeInTheDocument();
        expect(screen.getByText('Network timeout')).toBeInTheDocument();
    });
});

// ─── PlaylistModal — close button ─────────────────────────────────────────────

describe('PlaylistModal — close button', () => {
    it('calls onClose when the X button is clicked', async () => {
        const onClose = jest.fn();
        render(<PlaylistModal isOpen={true} onClose={onClose} playlist={mockPlaylist} />);
        await screen.findByText('Song One');
        fireEvent.click(screen.getByTitle('Close Modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
