// Requirements: [FR-003] [FR-004] [FR-009] [FR-015] [FR-028] [NFR-003] [NFR-004] [NFR-009]

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../components/Header';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../firebase/firebase', () => ({
    useFirebaseAuth: jest.fn(),
}));

jest.mock('../firebase/FirebaseService', () => ({
    __esModule: true,
    default: {
        saveProject: jest.fn(),
        getUserProjects: jest.fn(),
        loadProject: jest.fn(),
        deleteProject: jest.fn(),
    },
}));

jest.mock('../spotify/appContext', () => ({
    useMix: jest.fn(),
}));

jest.mock('../utils/useSettings', () => ({
    useSettings: jest.fn(() => ({
        settings: {
            animationsEnabled: true,
            keybinds: {
                playPause: { key: ' ', ctrl: false, shift: false, alt: false },
                splitAtPlayhead: { key: 's', ctrl: true, shift: false, alt: false },
            },
        },
    })),
    matchesKeybind: jest.fn(() => false),
}));

jest.mock('../components/ProfileModal', () => ({
    AccountModal: ({ isOpen }) => isOpen ? <div data-testid="account-modal" /> : null,
    SettingsModal: ({ isOpen }) => isOpen ? <div data-testid="settings-modal" /> : null,
}));

jest.mock('../audio/AudioEngine', () => ({
    __esModule: true,
    default: {
        renderOffline: jest.fn(),
        ctx: {},
        masterGain: { gain: {} },
        createBufferSource: jest.fn(),
    },
    audioBufferToWAV: jest.fn(),
}));

jest.mock('../utils/helpers', () => ({
    getDynamicInputWidth: jest.fn(() => 120),
}));

// Stub HeroUI — Dropdown renders all its children directly so items are always in the DOM.
jest.mock('@heroui/react', () => ({
    Avatar: ({ name, getInitials, as: Tag = 'div', ...rest }) => (
        <Tag data-testid="avatar" {...rest}>{getInitials ? getInitials(name) : name}</Tag>
    ),
    Dropdown: ({ children }) => <div>{children}</div>,
    DropdownTrigger: ({ children }) => <div>{children}</div>,
    DropdownMenu: ({ children }) => <div>{children}</div>,
    DropdownItem: ({ children, onPress, textValue }) => (
        <button onClick={onPress} data-textvalue={textValue}>{children}</button>
    ),
    DropdownSection: ({ children }) => <div>{children}</div>,
    Spinner: () => <span data-testid="spinner" />,
    Slider: ({ value, onChange, minValue, maxValue, step, 'aria-label': ariaLabel }) => (
        <input
            data-testid="heroui-slider"
            type="range"
            value={value ?? 0}
            min={minValue}
            max={maxValue}
            step={step}
            aria-label={ariaLabel}
            onChange={(e) => onChange && onChange(Number(e.target.value))}
        />
    ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSignOut = jest.fn();
const mockSetUniversalIsPlaying = jest.fn();
const mockTriggerMasterStop = jest.fn();
const mockHandleOverwriteTracks = jest.fn();
const mockHandleUndo = jest.fn();
const mockHandleRedo = jest.fn();
const mockHandleClearAllTracks = jest.fn();
const mockSetMasterBpm = jest.fn();

const setupMocks = (overrides = {}) => {
    const { useFirebaseAuth } = require('../firebase/firebase');
    const { useMix } = require('../spotify/appContext');
    const { useSettings } = require('../utils/useSettings');

    useSettings.mockReturnValue({
        settings: {
            animationsEnabled: true,
            keybinds: {
                playPause: { key: ' ', ctrl: false, shift: false, alt: false },
                splitAtPlayhead: { key: 's', ctrl: true, shift: false, alt: false },
            },
        },
    });

    useFirebaseAuth.mockReturnValue({
        user: { uid: 'test_uid', displayName: 'Test User', email: 'test@test.com', photoURL: null },
        signOut: mockSignOut,
        ...((overrides.auth) || {}),
    });

    useMix.mockReturnValue({
        tracks: [],
        universalIsPlaying: false,
        setUniversalIsPlaying: mockSetUniversalIsPlaying,
        triggerMasterStop: mockTriggerMasterStop,
        handleOverwriteTracks: mockHandleOverwriteTracks,
        handleUndo: mockHandleUndo,
        handleRedo: mockHandleRedo,
        handleClearAllTracks: mockHandleClearAllTracks,
        masterBpm: 128,
        setMasterBpm: mockSetMasterBpm,
        globalZoom: 0,
        setGlobalZoom: jest.fn(),
        ...((overrides.mix) || {}),
    });
};

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
});

// ─── Branding ─────────────────────────────────────────────────────────────────

describe('Header — branding', () => {
    it('renders DigiDeck logo text', () => {
        render(<Header />);
        expect(screen.getByText('DigiDeck')).toBeInTheDocument();
    });

    it('renders Studio sub-text', () => {
        render(<Header />);
        expect(screen.getByText('Studio')).toBeInTheDocument();
    });
});

// ─── Project name ─────────────────────────────────────────────────────────────

describe('Header — project name', () => { // [FR-009]
    it('shows default project name "Untitled project"', () => {
        render(<Header />);
        expect(screen.getByDisplayValue('Untitled project')).toBeInTheDocument();
    });

    it('project name input is disabled before editing is enabled', () => {
        render(<Header />);
        expect(screen.getByDisplayValue('Untitled project')).toBeDisabled();
    });

    it('pencil button enables project name editing', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Rename project'));
        expect(screen.getByDisplayValue('Untitled project')).not.toBeDisabled();
    });

    it('project name can be changed while editing', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Rename project'));
        fireEvent.change(screen.getByDisplayValue('Untitled project'), {
            target: { value: 'My Mix' },
        });
        expect(screen.getByDisplayValue('My Mix')).toBeInTheDocument();
    });

    it('pressing Enter while editing finishes and disables the input', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Rename project'));
        const input = screen.getByDisplayValue('Untitled project');
        fireEvent.change(input, { target: { value: 'Summer Set' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByDisplayValue('Summer Set')).toBeDisabled();
    });
});

// ─── Transport controls ───────────────────────────────────────────────────────

describe('Header — transport controls', () => { // [FR-003] [FR-004]
    it('does not render transport controls when no tracks are loaded', () => {
        render(<Header />);
        expect(screen.queryByText('Idle')).not.toBeInTheDocument();
        expect(screen.queryByText('Live')).not.toBeInTheDocument();
    });

    it('renders transport controls when at least one track is loaded', () => {
        setupMocks({ mix: { tracks: [{ id: 1 }] } });
        render(<Header />);
        expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('shows "Live" status text when universalIsPlaying is true', () => {
        setupMocks({ mix: { tracks: [{ id: 1 }], universalIsPlaying: true } });
        render(<Header />);
        expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('clicking play/pause toggles universalIsPlaying', () => {
        setupMocks({ mix: { tracks: [{ id: 1 }] } });
        render(<Header />);
        // The play/pause button is the first button in the transport area
        const transportButtons = screen
            .getAllByRole('button')
            // eslint-disable-next-line testing-library/no-node-access
            .filter(btn => btn.closest('[class*="bg-base-900/60"]'));
        fireEvent.click(transportButtons[0]);
        expect(mockSetUniversalIsPlaying).toHaveBeenCalledTimes(1);
    });
});

// ─── User profile / dropdown ──────────────────────────────────────────────────

describe('Header — user profile', () => { // [FR-015] [NFR-004]
    it('renders the avatar when user has no photoURL', () => {
        render(<Header />);
        expect(screen.getByTestId('avatar')).toBeInTheDocument();
    });

    it('renders user photo instead of avatar when photoURL is provided', () => {
        setupMocks({
            auth: {
                user: { displayName: 'Test User', email: 'test@test.com', photoURL: 'https://photo.example' },
            },
        });
        render(<Header />);
        const img = screen.getByAltText('Test User');
        expect(img).toHaveAttribute('src', 'https://photo.example');
    });

    it('shows display name in profile dropdown section', () => {
        render(<Header />);
        expect(screen.getByText('Test User')).toBeInTheDocument();
    });

    it('calls signOut when the Logout item is clicked', () => {
        render(<Header />);
        fireEvent.click(screen.getByText('Logout'));
        expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('opens AccountModal when "Account info" is clicked', () => {
        render(<Header />);
        fireEvent.click(screen.getByText('Account info'));
        expect(screen.getByTestId('account-modal')).toBeInTheDocument();
    });

    it('opens SettingsModal when "Settings" is clicked', () => {
        render(<Header />);
        fireEvent.click(screen.getByText('Settings'));
        expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });
});

// ─── Export / Mix Preview ─────────────────────────────────────────────────────

describe('Header — Export and Mix Preview', () => { // [NFR-009]
    it('renders an Export button', () => {
        render(<Header />);
        expect(screen.getByText('Export')).toBeInTheDocument();
    });

    it('clicking Export calls AudioEngineService.renderOffline', async () => {
        const AudioEngine = require('../audio/AudioEngine').default;
        AudioEngine.renderOffline.mockResolvedValue(null);
        render(<Header />);
        fireEvent.click(screen.getByText('Export'));
        await waitFor(() => expect(AudioEngine.renderOffline).toHaveBeenCalled());
    });

    it('Export button shows "Exporting…" while render is in progress', async () => {
        const AudioEngine = require('../audio/AudioEngine').default;
        // Never resolves — keeps the component in the exporting state
        AudioEngine.renderOffline.mockReturnValue(new Promise(() => {}));
        render(<Header />);
        fireEvent.click(screen.getByText('Export'));
        expect(await screen.findByText('Exporting…')).toBeInTheDocument();
    });
});

// ─── Save project (RF4) ──────────────────────────────────────────────────────

describe('Header — Save project', () => { // [FR-028]
    it('clicking Save calls FirebaseService.saveProject with uid, project name, and tracks', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.saveProject.mockResolvedValue('untitled');

        setupMocks({ mix: { tracks: [{ id: 1, title: 'Track A' }] } });
        render(<Header />);

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(FirebaseService.saveProject).toHaveBeenCalledWith(
            'test_uid',
            expect.any(String),
            expect.any(Array),
        ));
    });

    it('shows "Saved!" feedback when saveProject resolves', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.saveProject.mockResolvedValue('untitled');

        render(<Header />);
        fireEvent.click(screen.getByText('Save'));

        expect(await screen.findByText('Saved!')).toBeInTheDocument();
    });

    it('shows "Failed" feedback when saveProject rejects', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.saveProject.mockRejectedValue(new Error('Firestore unavailable'));

        render(<Header />);
        fireEvent.click(screen.getByText('Save'));

        expect(await screen.findByText('Failed')).toBeInTheDocument();
    });

    it('does not call saveProject when there is no authenticated user', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        setupMocks({ auth: { user: null } });
        render(<Header />);

        fireEvent.click(screen.getByText('Save'));

        // Allow any pending promises to settle
        await new Promise(r => setTimeout(r, 0));
        expect(FirebaseService.saveProject).not.toHaveBeenCalled();
    });
});

// ─── Load project (RF4) ──────────────────────────────────────────────────────

describe('Header — Load project', () => { // [FR-028]
    it('clicking Load opens the Load Project modal', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([]);

        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        expect(await screen.findByText('Load Project')).toBeInTheDocument();
    });

    it('calls getUserProjects with the user uid when Load is clicked', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([]);

        setupMocks({ auth: { user: { uid: 'user_123', displayName: 'Test User', email: 'test@test.com', photoURL: null }, signOut: mockSignOut } });
        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        await waitFor(() => expect(FirebaseService.getUserProjects).toHaveBeenCalledWith('user_123'));
    });

    it('displays project names returned by getUserProjects', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([
            { id: 'proj-1', name: 'Summer Mix', tracks: [{ id: 1 }] },
            { id: 'proj-2', name: 'Winter Vibes', tracks: [] },
        ]);

        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        expect(await screen.findByText('Summer Mix')).toBeInTheDocument();
        expect(await screen.findByText('Winter Vibes')).toBeInTheDocument();
    });

    it('shows "No saved projects yet." when the list is empty', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([]);

        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        expect(await screen.findByText('No saved projects yet.')).toBeInTheDocument();
    });

    it('clicking a project row calls loadProject and closes the modal', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([
            { id: 'proj-1', name: 'Summer Mix', tracks: [{ id: 1 }] },
        ]);
        FirebaseService.loadProject.mockResolvedValue({ name: 'Summer Mix', tracks: [{ id: 1 }] });

        setupMocks({ auth: { user: { uid: 'user_123', displayName: 'Test User', email: 'test@test.com', photoURL: null }, signOut: mockSignOut } });
        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        await screen.findByText('Summer Mix');
        fireEvent.click(screen.getByRole('button', { name: /summer mix/i }));

        await waitFor(() => expect(FirebaseService.loadProject).toHaveBeenCalledWith('user_123', 'proj-1'));
        // Modal should close after successful load
        await waitFor(() => expect(screen.queryByText('Load Project')).not.toBeInTheDocument());
    });

    it('clicking the delete button calls deleteProject and removes the project from the list', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([
            { id: 'proj-1', name: 'Summer Mix', tracks: [] },
        ]);
        FirebaseService.deleteProject.mockResolvedValue(undefined);

        setupMocks({ auth: { user: { uid: 'user_123', displayName: 'Test User', email: 'test@test.com', photoURL: null }, signOut: mockSignOut } });
        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        await screen.findByText('Summer Mix');
        fireEvent.click(screen.getByTitle('Delete project'));

        await waitFor(() => expect(FirebaseService.deleteProject).toHaveBeenCalledWith('user_123', 'proj-1'));
        await waitFor(() => expect(screen.queryByText('Summer Mix')).not.toBeInTheDocument());
    });

    it('shows an error message when getUserProjects rejects', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockRejectedValue(new Error('Firestore unavailable'));

        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        expect(await screen.findByText('Failed to load projects.')).toBeInTheDocument();
    });
});

// ─── Keybinds — undo / redo ───────────────────────────────────────────────────

describe('Header — keybinds: undo / redo', () => { // [NFR-003]
    const realMatchesKeybind = jest.requireActual('../utils/useSettings').matchesKeybind;

    beforeEach(() => {
        const { matchesKeybind, useSettings } = require('../utils/useSettings');
        // Use the real implementation so Ctrl+Z / Ctrl+Y are correctly detected
        matchesKeybind.mockImplementation(realMatchesKeybind);
        // Provide keybinds including undo and redo
        useSettings.mockReturnValue({
            settings: {
                animationsEnabled: true,
                keybinds: {
                    playPause:       { key: ' ', ctrl: false, shift: false, alt: false },
                    splitAtPlayhead: { key: 'x', ctrl: false, shift: false, alt: false },
                    saveProject:     { key: 's', ctrl: true,  shift: false, alt: false },
                    undo:            { key: 'z', ctrl: true,  shift: false, alt: false },
                    redo:            { key: 'y', ctrl: true,  shift: false, alt: false },
                },
            },
        });
    });

    it('Ctrl+Z calls handleUndo', () => {
        render(<Header />);
        fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false, altKey: false });
        expect(mockHandleUndo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y calls handleRedo', () => {
        render(<Header />);
        fireEvent.keyDown(window, { key: 'y', ctrlKey: true, shiftKey: false, altKey: false });
        expect(mockHandleRedo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z does not call handleRedo', () => {
        render(<Header />);
        fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false, altKey: false });
        expect(mockHandleRedo).not.toHaveBeenCalled();
    });

    it('Z without Ctrl does not call handleUndo', () => {
        render(<Header />);
        fireEvent.keyDown(window, { key: 'z', ctrlKey: false, shiftKey: false, altKey: false });
        expect(mockHandleUndo).not.toHaveBeenCalled();
    });

    it('Y without Ctrl does not call handleRedo', () => {
        render(<Header />);
        fireEvent.keyDown(window, { key: 'y', ctrlKey: false, shiftKey: false, altKey: false });
        expect(mockHandleRedo).not.toHaveBeenCalled();
    });
});

// ─── Reset workspace ──────────────────────────────────────────────────────────

describe('Header — reset workspace', () => { // [FR-003]
    it('"Reset workspace?" text is not shown by default', () => {
        render(<Header />);
        expect(screen.queryByText('Reset workspace?')).not.toBeInTheDocument();
    });

    it('clicking Reset button shows confirmation UI ("Reset workspace?")', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Remove all tracks and start fresh'));
        expect(screen.getByText('Reset workspace?')).toBeInTheDocument();
    });

    it('clicking the Reset confirm button calls handleClearAllTracks', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Remove all tracks and start fresh'));
        // The confirm button has text "Reset" inside the confirmation UI
        const buttons = screen.getAllByRole('button', { name: 'Reset' });
        // The confirmation Reset button is inside the "Reset workspace?" inline dialog
        // eslint-disable-next-line testing-library/no-node-access
        const confirmBtn = buttons.find(b => b.closest('[class*="animate-in"]'));
        fireEvent.click(confirmBtn);
        expect(mockHandleClearAllTracks).toHaveBeenCalledTimes(1);
    });

    it('clicking Cancel hides the confirm UI', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Remove all tracks and start fresh'));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('Reset workspace?')).not.toBeInTheDocument();
    });

    it('after confirming reset, "Reset workspace?" text is gone', () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('Remove all tracks and start fresh'));
        const buttons = screen.getAllByRole('button', { name: 'Reset' });
        // eslint-disable-next-line testing-library/no-node-access
        const confirmBtn = buttons.find(b => b.closest('[class*="animate-in"]'));
        fireEvent.click(confirmBtn);
        expect(screen.queryByText('Reset workspace?')).not.toBeInTheDocument();
    });
});

// ─── Transport: stop button ───────────────────────────────────────────────────

describe('Header — transport: stop button', () => { // [FR-003]
    it('clicking the stop button calls triggerMasterStop', () => {
        setupMocks({ mix: { tracks: [{ id: 1 }] } });
        render(<Header />);
        const transportButtons = screen
            .getAllByRole('button')
            // eslint-disable-next-line testing-library/no-node-access
            .filter(btn => btn.closest('[class*="bg-base-900/60"]'));
        // Second button in the transport area is the Stop button
        fireEvent.click(transportButtons[1]);
        expect(mockTriggerMasterStop).toHaveBeenCalledTimes(1);
    });
});

// ─── Master BPM input ─────────────────────────────────────────────────────────

describe('Header — master BPM input', () => { // [FR-003]
    it('changing the Master BPM input calls setMasterBpm', () => {
        setupMocks({ mix: { tracks: [{ id: 1 }] } });
        render(<Header />);
        const bpmInput = screen.getByTitle('Master BPM');
        fireEvent.change(bpmInput, { target: { value: '140' } });
        expect(mockSetMasterBpm).toHaveBeenCalledWith(140);
    });
});

// ─── Load project error handling ──────────────────────────────────────────────

describe('Header — load project error handling', () => { // [FR-028]
    it('shows "Failed to load project." when loadProject throws', async () => {
        const FirebaseService = require('../firebase/FirebaseService').default;
        FirebaseService.getUserProjects.mockResolvedValue([
            { id: 'proj-1', name: 'Summer Mix', tracks: [] },
        ]);
        FirebaseService.loadProject.mockRejectedValue(new Error('Network error'));

        setupMocks({ auth: { user: { uid: 'user_123', displayName: 'Test User', email: 'test@test.com', photoURL: null }, signOut: mockSignOut } });
        render(<Header />);
        fireEvent.click(screen.getByText('Load'));

        await screen.findByText('Summer Mix');
        fireEvent.click(screen.getByRole('button', { name: /summer mix/i }));

        expect(await screen.findByText('Failed to load project.')).toBeInTheDocument();
    });
});

// ─── Export WAV download ──────────────────────────────────────────────────────

describe('Header — export WAV download', () => { // [NFR-009]
    beforeEach(() => {
        global.URL.createObjectURL = jest.fn(() => 'blob:mock-wav');
        global.URL.revokeObjectURL = jest.fn();
    });

    it('calls audioBufferToWAV after renderOffline resolves', async () => {
        const AudioEngine = require('../audio/AudioEngine').default;
        const { audioBufferToWAV } = require('../audio/AudioEngine');
        const fakeBuffer = { length: 44100, sampleRate: 44100, numberOfChannels: 2 };
        AudioEngine.renderOffline.mockResolvedValue(fakeBuffer);
        audioBufferToWAV.mockReturnValue(new ArrayBuffer(8));

        render(<Header />);
        fireEvent.click(screen.getByText('Export'));

        await waitFor(() => expect(audioBufferToWAV).toHaveBeenCalledWith(fakeBuffer));
    });

    it('calls URL.createObjectURL with the WAV blob', async () => {
        const AudioEngine = require('../audio/AudioEngine').default;
        const { audioBufferToWAV } = require('../audio/AudioEngine');
        const fakeBuffer = { length: 44100, sampleRate: 44100, numberOfChannels: 2 };
        AudioEngine.renderOffline.mockResolvedValue(fakeBuffer);
        audioBufferToWAV.mockReturnValue(new ArrayBuffer(8));

        render(<Header />);
        fireEvent.click(screen.getByText('Export'));

        await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
        const arg = global.URL.createObjectURL.mock.calls[0][0];
        expect(arg).toBeInstanceOf(Blob);
    });

    it('calls URL.revokeObjectURL after the download anchor clicks', async () => {
        const AudioEngine = require('../audio/AudioEngine').default;
        const { audioBufferToWAV } = require('../audio/AudioEngine');
        const fakeBuffer = { length: 44100, sampleRate: 44100, numberOfChannels: 2 };
        AudioEngine.renderOffline.mockResolvedValue(fakeBuffer);
        audioBufferToWAV.mockReturnValue(new ArrayBuffer(8));

        // Stub document.createElement so we can capture anchor click without navigation
        const realCreate = document.createElement.bind(document);
        const mockAnchorClick = jest.fn();
        jest.spyOn(document, 'createElement').mockImplementation((tag) => {
            if (tag === 'a') {
                const a = realCreate('a');
                a.click = mockAnchorClick;
                return a;
            }
            return realCreate(tag);
        });

        render(<Header />);
        fireEvent.click(screen.getByText('Export'));

        await waitFor(() => expect(global.URL.revokeObjectURL).toHaveBeenCalled());
        document.createElement.mockRestore();
    });
});
