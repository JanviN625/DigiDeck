import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TrackCard from '../components/TrackCard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../audio/useAudioEngine', () => ({
    useAudioEngine: jest.fn(),
}));

jest.mock('../audio/AudioEngine', () => ({
    __esModule: true,
    default: {
        ctx: { decodeAudioData: jest.fn() },
        tracks: new Map(),
        loadTrack: jest.fn(),
        unloadTrack: jest.fn(),
        play: jest.fn(),
        pause: jest.fn(),
        seek: jest.fn(),
        setVolume: jest.fn(),
        setPitch: jest.fn(),
        setSpeed: jest.fn(),
        setEQ: jest.fn(),
        addEffect: jest.fn(),
        removeEffect: jest.fn(),
        setEffectEnabled: jest.fn(),
        setEffectParam: jest.fn(),
        applyFadeIn: jest.fn(),
        applyFadeOut: jest.fn(),
        renderOffline: jest.fn(),
        masterGain: {},
    },
    audioBufferToWAV: jest.fn(),
}));

// Plain object (not jest.fn) so resetMocks:true cannot clear it.
jest.mock('wavesurfer.js', () => {
    const ws = {
        on: () => ws,
        load: () => {},
        destroy: () => {},
        zoom: () => {},
        seekTo: () => {},
        getCurrentTime: () => 0,
        getDuration: () => 180,
    };
    return { __esModule: true, default: { create: () => ws } };
});

jest.mock('../audio/essentiaAnalyzer', () => ({
    analyzeAudioBuffer: jest.fn().mockResolvedValue({
        bpm: 120, key: 'C', scale: 'major', beatPositions: [],
    }),
}));

jest.mock('../spotify/appContext', () => ({
    useMix: jest.fn(),
}));

jest.mock('../utils/useSettings', () => ({
    useSettings: jest.fn(),
    // Keep matchesKeybind functional so keydown effects work correctly.
    matchesKeybind: (e, binding) => {
        if (!binding) return false;
        return e.key?.toLowerCase() === binding.key?.toLowerCase() &&
            !!e.ctrlKey === !!binding.ctrl &&
            !!e.shiftKey === !!binding.shift &&
            !!e.altKey === !!binding.alt;
    },
}));

jest.mock('../utils/helpers', () => ({
    getDynamicInputWidth: jest.fn(() => 120),
}));

// Stub lucide icons with data-testids so icon-only buttons can be queried.
jest.mock('lucide-react', () => {
    const icon = (testId) => (props) => <span data-testid={testId} />;
    return {
        Pencil: icon('icon-pencil'),
        ChevronDown: icon('icon-chevron-down'),
        ChevronUp: icon('icon-chevron-up'),
        Play: icon('icon-play'),
        Pause: icon('icon-pause'),
        Volume2: icon('icon-volume2'),
        VolumeX: icon('icon-volumex'),
        Eye: icon('icon-eye'),
        EyeOff: icon('icon-eyeoff'),
        Move: icon('icon-move'),
        Copy: icon('icon-copy'),
        Trash2: icon('icon-trash2'),
        RotateCcw: icon('icon-rotateccw'),
        ZoomIn: icon('icon-zoomin'),
        AlertTriangle: icon('icon-alerttriangle'),
        X: icon('icon-x'),
        Plus: icon('icon-plus'),
        Power: icon('icon-power'),
    };
});

jest.mock('@heroui/react', () => ({
    Slider: ({ value, onChange, minValue, maxValue, step, 'aria-label': ariaLabel, isDisabled }) => (
        <input
            data-testid="heroui-slider"
            type="range"
            value={value}
            min={minValue}
            max={maxValue}
            step={step}
            aria-label={ariaLabel}
            disabled={isDisabled}
            onChange={(e) => onChange && onChange(Number(e.target.value))}
        />
    ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockSeek = jest.fn();
const mockSetVolume = jest.fn();
const mockSetPitch = jest.fn();
const mockSetSpeed = jest.fn();
const mockSetEQ = jest.fn();
const mockAddEffect = jest.fn();
const mockRemoveEffect = jest.fn();
const mockSetEffectEnabled = jest.fn();
const mockSetEffectParam = jest.fn();
const mockApplyFadeIn = jest.fn();
const mockApplyFadeOut = jest.fn();
const mockHandleUpdateTrack = jest.fn();

const defaultSettings = {
    confirmBeforeDelete: false,
    keybinds: { splitAtPlayhead: { key: 's', ctrl: true, shift: false, alt: false } },
};

const setupMocks = (extraTracks = [], settingsOverrides = {}) => {
    const { useAudioEngine } = require('../audio/useAudioEngine');
    const { useMix } = require('../spotify/appContext');
    const { useSettings } = require('../utils/useSettings');

    useSettings.mockReturnValue({ settings: { ...defaultSettings, ...settingsOverrides } });

    useAudioEngine.mockReturnValue({
        play: mockPlay,
        pause: mockPause,
        seek: mockSeek,
        setVolume: mockSetVolume,
        setPitch: mockSetPitch,
        setSpeed: mockSetSpeed,
        setEQ: mockSetEQ,
        addEffect: mockAddEffect,
        removeEffect: mockRemoveEffect,
        setEffectEnabled: mockSetEffectEnabled,
        setEffectParam: mockSetEffectParam,
        applyFadeIn: mockApplyFadeIn,
        applyFadeOut: mockApplyFadeOut,
    });

    useMix.mockReturnValue({
        tracks: [{ id: 'track_1', title: 'My Track' }, ...extraTracks],
        handleUpdateTrack: mockHandleUpdateTrack,
        universalIsPlaying: false,
        masterStopSignal: 0,
    });
};

const defaultProps = {
    trackId: 'track_1',
    title: 'My Track',
    artistName: 'Test Artist',
    bpm: '120',
    trackKey: 'C maj',
    initialVolume: 80,
};

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    // fetch is only called when audioUrl is provided; mock it defensively
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('TrackCard — rendering', () => {
    it('renders the track title in the name input', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.getByDisplayValue('My Track')).toBeInTheDocument();
    });

    it('renders the artist name', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.getByText('Test Artist')).toBeInTheDocument();
    });

    it('renders the BPM value', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.getByText('120')).toBeInTheDocument();
    });

    it('renders the key value', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.getByText('C maj')).toBeInTheDocument();
    });

    it('renders album art when albumArt prop is provided', () => {
        render(
            <TrackCard {...defaultProps} audioUrl="blob:mock" albumArt="https://art.example/img.jpg" />
        );
        // The album art img appears in the expanded controls section
        const imgs = screen.getAllByRole('img');
        const artImg = imgs.find(img => img.getAttribute('src') === 'https://art.example/img.jpg');
        expect(artImg).toBeTruthy();
    });

    it('renders "No Art" placeholder when albumArt is null', () => {
        render(<TrackCard {...defaultProps} audioUrl="blob:mock" />);
        expect(screen.getByText('No Art')).toBeInTheDocument();
    });

    it('shows Expand button when not expanded', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.getByText('Expand')).toBeInTheDocument();
    });

    it('shows Collapse button when initiallyExpanded is true', () => {
        render(<TrackCard {...defaultProps} initiallyExpanded={true} />);
        expect(screen.getByText('Collapse')).toBeInTheDocument();
    });
});

// ─── Expand / Collapse ────────────────────────────────────────────────────────

describe('TrackCard — expand/collapse', () => {
    it('clicking Expand shows the Collapse button', () => {
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByText('Expand'));
        expect(screen.getByText('Collapse')).toBeInTheDocument();
    });

    it('clicking Collapse shows the Expand button', () => {
        render(<TrackCard {...defaultProps} initiallyExpanded={true} />);
        fireEvent.click(screen.getByText('Collapse'));
        expect(screen.getByText('Expand')).toBeInTheDocument();
    });

    it('clicking the Expand button toggles to Collapse', () => {
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByText('Expand'));
        expect(screen.getByText('Collapse')).toBeInTheDocument();
    });
});

// ─── Track name editing ───────────────────────────────────────────────────────

describe('TrackCard — track name editing', () => {
    it('name input is disabled when not in edit mode', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.getByDisplayValue('My Track')).toBeDisabled();
    });

    it('clicking the pencil button enables editing', () => {
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByTitle('Rename track'));
        expect(screen.getByDisplayValue('My Track')).not.toBeDisabled();
    });

    it('track name can be changed while editing', () => {
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByTitle('Rename track'));
        fireEvent.change(screen.getByDisplayValue('My Track'), { target: { value: 'New Name' } });
        expect(screen.getByDisplayValue('New Name')).toBeInTheDocument();
    });

    it('pressing Enter saves and exits edit mode', () => {
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByTitle('Rename track'));
        const input = screen.getByDisplayValue('My Track');
        fireEvent.change(input, { target: { value: 'Saved Name' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByDisplayValue('Saved Name')).toBeDisabled();
    });

    it('shows "Name already in use" when renaming to a duplicate', () => {
        setupMocks([{ id: 'track_2', title: 'Taken Name' }]);
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByTitle('Rename track'));
        fireEvent.change(screen.getByDisplayValue('My Track'), { target: { value: 'Taken Name' } });
        expect(screen.getByText('Name already in use')).toBeInTheDocument();
    });

    it('pencil button gets "Track name already in use" title when name is duplicate', () => {
        setupMocks([{ id: 'track_2', title: 'My Track' }]);
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByTitle('Rename track'));
        // After the rename field already shows 'My Track' which matches track_2
        expect(screen.getByTitle('Track name already in use')).toBeInTheDocument();
    });
});

// ─── Delete and Duplicate ─────────────────────────────────────────────────────

describe('TrackCard — delete and duplicate', () => {
    it('calls onDelete when the delete button is clicked', () => {
        const onDelete = jest.fn();
        render(<TrackCard {...defaultProps} onDelete={onDelete} />);
        fireEvent.click(screen.getByTitle('Delete track'));
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('calls onDuplicate with track state snapshot when duplicate button is clicked', () => {
        const onDuplicate = jest.fn();
        render(<TrackCard {...defaultProps} onDuplicate={onDuplicate} />);
        fireEvent.click(screen.getByTitle('Duplicate track'));
        expect(onDuplicate).toHaveBeenCalledTimes(1);
        expect(onDuplicate).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'My Track', initialVolume: 80 })
        );
    });

    it('does not throw when onDelete is not provided', () => {
        render(<TrackCard {...defaultProps} />);
        expect(() => fireEvent.click(screen.getByTitle('Delete track'))).not.toThrow();
    });

    it('does not throw when onDuplicate is not provided', () => {
        render(<TrackCard {...defaultProps} />);
        expect(() => fireEvent.click(screen.getByTitle('Duplicate track'))).not.toThrow();
    });
});

// ─── Visibility / Mute / Play (requires audioUrl) ────────────────────────────

describe('TrackCard — audio controls', () => {
    const audioProps = { ...defaultProps, audioUrl: 'blob:mock' };

    it('play button is disabled when audioUrl is null', () => {
        render(<TrackCard {...defaultProps} />);
        // With no audioUrl the controls section is not rendered at all
        expect(screen.queryByTestId('icon-play')).not.toBeInTheDocument();
    });

    it('renders play icon when not playing', () => {
        render(<TrackCard {...audioProps} />);
        expect(screen.getByTestId('icon-play')).toBeInTheDocument();
    });

    it('clicking play toggles to pause icon', () => {
        render(<TrackCard {...audioProps} />);
        const playBtn = screen.getByTestId('icon-play').closest('button');
        fireEvent.click(playBtn);
        expect(screen.getByTestId('icon-pause')).toBeInTheDocument();
    });

    it('clicking play a second time returns to play icon', () => {
        render(<TrackCard {...audioProps} />);
        const playBtn = screen.getByTestId('icon-play').closest('button');
        fireEvent.click(playBtn);
        const pauseBtn = screen.getByTestId('icon-pause').closest('button');
        fireEvent.click(pauseBtn);
        expect(screen.getByTestId('icon-play')).toBeInTheDocument();
    });

    it('renders Volume2 icon when not muted', () => {
        render(<TrackCard {...audioProps} />);
        // Volume2 appears twice: once in mute button, once next to volume slider
        expect(screen.getAllByTestId('icon-volume2').length).toBeGreaterThanOrEqual(1);
    });

    it('clicking mute toggles to VolumeX icon', () => {
        render(<TrackCard {...audioProps} />);
        // First icon-volume2 is inside the mute button (volume slider icon comes after)
        const muteBtn = screen.getAllByTestId('icon-volume2')[0].closest('button');
        fireEvent.click(muteBtn);
        expect(screen.getByTestId('icon-volumex')).toBeInTheDocument();
    });

    it('renders Eye icon when track is visible', () => {
        render(<TrackCard {...audioProps} />);
        expect(screen.getByTestId('icon-eye')).toBeInTheDocument();
    });

    it('clicking visibility button toggles to EyeOff icon', () => {
        render(<TrackCard {...audioProps} />);
        const visBtn = screen.getByTestId('icon-eye').closest('button');
        fireEvent.click(visBtn);
        expect(screen.getByTestId('icon-eyeoff')).toBeInTheDocument();
    });
});

// ─── Drag state ───────────────────────────────────────────────────────────────

describe('TrackCard — drag state', () => {
    it('applying isDragged prop adds opacity styling', () => {
        const { container } = render(<TrackCard {...defaultProps} isDragged={true} />);
        // The outer draggable div has class "opacity-50" when isDragged
        const draggableDiv = container.querySelector('[draggable]');
        expect(draggableDiv.className).toMatch(/opacity-50/);
    });

    it('without isDragged the draggable div has no forced opacity', () => {
        const { container } = render(<TrackCard {...defaultProps} isDragged={false} />);
        const draggableDiv = container.querySelector('[draggable]');
        // opacity-50 should NOT be in the class string
        expect(draggableDiv.className).not.toMatch(/opacity-50/);
    });
});

// ─── Confirm-before-delete ────────────────────────────────────────────────────

describe('TrackCard — confirm-before-delete (confirmBeforeDelete: true)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupMocks([], { confirmBeforeDelete: true });
        global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
        global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = jest.fn();
    });

    it('shows inline confirm UI instead of calling onDelete when trash is clicked', () => {
        const onDelete = jest.fn();
        render(<TrackCard {...defaultProps} onDelete={onDelete} />);
        fireEvent.click(screen.getByTitle('Delete track'));
        expect(screen.getByText('Remove track?')).toBeInTheDocument();
        expect(onDelete).not.toHaveBeenCalled();
    });

    it('calls onDelete after clicking Remove in the confirm UI', () => {
        const onDelete = jest.fn();
        render(<TrackCard {...defaultProps} onDelete={onDelete} />);
        fireEvent.click(screen.getByTitle('Delete track'));
        fireEvent.click(screen.getByText('Remove'));
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('hides the confirm UI and does not delete after clicking Cancel', () => {
        const onDelete = jest.fn();
        render(<TrackCard {...defaultProps} onDelete={onDelete} />);
        fireEvent.click(screen.getByTitle('Delete track'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.queryByText('Remove track?')).not.toBeInTheDocument();
    });

    it('restores the trash button after Cancel is clicked', () => {
        render(<TrackCard {...defaultProps} />);
        fireEvent.click(screen.getByTitle('Delete track'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.getByTitle('Delete track')).toBeInTheDocument();
    });
});

// ─── isMissing warning ────────────────────────────────────────────────────────

describe('TrackCard — isMissing warning', () => {
    it('shows the missing file warning banner when isMissing is true', () => {
        render(<TrackCard {...defaultProps} isMissing={true} />);
        expect(screen.getByText(/Re-upload the exact file to restore/)).toBeInTheDocument();
    });

    it('does not show the missing warning when isMissing is false', () => {
        render(<TrackCard {...defaultProps} isMissing={false} />);
        expect(screen.queryByText(/Re-upload the exact file to restore/)).not.toBeInTheDocument();
    });

    it('dismisses the warning when the X button inside the banner is clicked', () => {
        render(<TrackCard {...defaultProps} isMissing={true} />);
        fireEvent.click(screen.getByTitle('Dismiss'));
        expect(screen.queryByText(/Re-upload the exact file to restore/)).not.toBeInTheDocument();
    });

    it('play button is disabled when isMissing is true', () => {
        render(<TrackCard {...defaultProps} audioUrl="blob:mock" isMissing={true} />);
        const playBtn = screen.getByTestId('icon-play').closest('button');
        expect(playBtn).toBeDisabled();
    });
});

// ─── Volume slider ────────────────────────────────────────────────────────────

describe('TrackCard — volume slider', () => {
    const audioProps = { ...defaultProps, audioUrl: 'blob:mock' };

    it('renders a volume slider when audioUrl is provided', () => {
        render(<TrackCard {...audioProps} />);
        // Volume slider is a native input[type=range] (not HeroUI Slider)
        const sliders = screen.getAllByRole('slider');
        // The native volume range input exists alongside any HeroUI sliders
        expect(sliders.length).toBeGreaterThanOrEqual(1);
    });

    it('calls setVolume on the engine when the volume slider is changed', () => {
        render(<TrackCard {...audioProps} initialVolume={80} />);
        const volumeSlider = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('max') === '100' && !s.getAttribute('aria-label')
        );
        fireEvent.change(volumeSlider, { target: { value: '50' } });
        // setEngVolume is called from useEffect on volume change: 50/100 = 0.5
        expect(mockSetVolume).toHaveBeenCalledWith(0.5);
    });

    it('volume slider is disabled when track is hidden', () => {
        render(<TrackCard {...audioProps} />);
        // Click the visibility toggle to hide the track
        fireEvent.click(screen.getByTestId('icon-eye').closest('button'));
        const volumeSlider = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('max') === '100' && !s.getAttribute('aria-label')
        );
        expect(volumeSlider).toBeDisabled();
    });

    it('muting calls setVolume with 0', () => {
        render(<TrackCard {...audioProps} initialVolume={80} />);
        const muteBtn = screen.getAllByTestId('icon-volume2')[0].closest('button');
        fireEvent.click(muteBtn);
        expect(mockSetVolume).toHaveBeenCalledWith(0);
    });
});

// ─── Settings panel ───────────────────────────────────────────────────────────

// Helper: render an expanded card and open its settings panel.
// The settings button is only rendered when isExpanded — audioUrl not required.
const renderWithSettings = (extraProps = {}) => {
    render(<TrackCard {...defaultProps} initiallyExpanded={true} {...extraProps} />);
    fireEvent.click(screen.getByText('Settings'));
};

describe('TrackCard — settings panel visibility', () => {
    it('shows the Settings button when the card is expanded', () => {
        render(<TrackCard {...defaultProps} initiallyExpanded={true} />);
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('does not show the Settings button when the card is collapsed', () => {
        render(<TrackCard {...defaultProps} />);
        expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('clicking Settings reveals the settings panel content', () => {
        render(<TrackCard {...defaultProps} initiallyExpanded={true} />);
        fireEvent.click(screen.getByText('Settings'));
        expect(screen.getByText('Basic Controls')).toBeInTheDocument();
    });

    it('clicking Settings a second time hides the settings panel', () => {
        render(<TrackCard {...defaultProps} initiallyExpanded={true} />);
        fireEvent.click(screen.getByText('Settings'));
        fireEvent.click(screen.getByText('Settings'));
        expect(screen.queryByText('Basic Controls')).not.toBeInTheDocument();
    });

    it('Settings button is disabled when the track is hidden', () => {
        render(<TrackCard {...defaultProps} audioUrl="blob:mock" initiallyExpanded={true} />);
        // Hide the track
        fireEvent.click(screen.getByTestId('icon-eye').closest('button'));
        expect(screen.getByText('Settings').closest('button')).toBeDisabled();
    });
});

// ─── Pitch controls ───────────────────────────────────────────────────────────

describe('TrackCard — pitch controls', () => {
    beforeEach(() => { renderWithSettings(); });

    it('shows pitch at 0st initially', () => {
        expect(screen.getByText('0st')).toBeInTheDocument();
    });

    it('clicking + increments pitch by 1', () => {
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        expect(screen.getByText('1st')).toBeInTheDocument();
    });

    it('clicking - decrements pitch by 1', () => {
        fireEvent.click(screen.getByRole('button', { name: '-' }));
        expect(screen.getByText('-1st')).toBeInTheDocument();
    });

    it('clicking + twice increments pitch to 2', () => {
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        expect(screen.getByText('2st')).toBeInTheDocument();
    });

    it('pitch reset button is not shown when pitch is 0', () => {
        expect(screen.queryByTitle('Reset to default')).not.toBeInTheDocument();
    });

    it('pitch reset button appears when pitch is non-zero', () => {
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        expect(screen.getByTitle('Reset to default')).toBeInTheDocument();
    });

    it('clicking pitch reset returns pitch to 0', () => {
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        fireEvent.click(screen.getByTitle('Reset to default'));
        expect(screen.getByText('0st')).toBeInTheDocument();
        expect(screen.queryByTitle('Reset to default')).not.toBeInTheDocument();
    });

    it('incrementing pitch calls setEngPitch with the new value', () => {
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        expect(mockSetPitch).toHaveBeenCalledWith(1);
    });
});

// ─── Speed controls ───────────────────────────────────────────────────────────

describe('TrackCard — speed controls', () => {
    beforeEach(() => { renderWithSettings(); });

    it('shows speed at 1.00x initially', () => {
        expect(screen.getByText('1.00x')).toBeInTheDocument();
    });

    it('speed reset button is not shown when speed is 1.0', () => {
        expect(screen.queryByTitle('Reset to 1.0x')).not.toBeInTheDocument();
    });

    it('changing the speed slider shows the new value', () => {
        const speedSlider = screen.getByRole('slider', { hidden: true,
            name: (n) => n === undefined || n === '' }).valueOf;
        // Find the speed range input: min=0.25, max=2
        const speedInput = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('min') === '0.25'
        );
        fireEvent.change(speedInput, { target: { value: '1.5' } });
        expect(screen.getByText('1.50x')).toBeInTheDocument();
    });

    it('speed reset button appears when speed is not 1.0', () => {
        const speedInput = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('min') === '0.25'
        );
        fireEvent.change(speedInput, { target: { value: '1.5' } });
        expect(screen.getByTitle('Reset to 1.0x')).toBeInTheDocument();
    });

    it('clicking speed reset returns speed to 1.0', () => {
        const speedInput = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('min') === '0.25'
        );
        fireEvent.change(speedInput, { target: { value: '1.5' } });
        fireEvent.click(screen.getByTitle('Reset to 1.0x'));
        expect(screen.getByText('1.00x')).toBeInTheDocument();
    });

    it('changing speed calls setEngSpeed with the new value', () => {
        const speedInput = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('min') === '0.25'
        );
        fireEvent.change(speedInput, { target: { value: '1.5' } });
        expect(mockSetSpeed).toHaveBeenCalledWith(1.5);
    });

    it('clicking the speed value text enters inline edit mode', () => {
        fireEvent.click(screen.getByText('1.00x'));
        expect(screen.getByDisplayValue('1.00')).toBeInTheDocument();
    });

    it('pressing Escape in the speed inline input exits edit mode without saving', () => {
        fireEvent.click(screen.getByText('1.00x'));
        const input = screen.getByDisplayValue('1.00');
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByDisplayValue('1.00')).not.toBeInTheDocument();
        expect(screen.getByText('1.00x')).toBeInTheDocument();
    });
});

// ─── Quality warning ──────────────────────────────────────────────────────────

describe('TrackCard — quality (G6) warning', () => {
    beforeEach(() => { renderWithSettings(); });

    it('does not show quality warning at default pitch and speed', () => {
        expect(screen.queryByText(/Audible artefacts/)).not.toBeInTheDocument();
    });

    it('shows warning when pitch exceeds 3 semitones', () => {
        // Increment pitch 4 times (0→4)
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: '+' }));
        expect(screen.getByText(/Audible artefacts/)).toBeInTheDocument();
    });

    it('shows warning when speed exceeds 1.15', () => {
        const speedInput = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('min') === '0.25'
        );
        fireEvent.change(speedInput, { target: { value: '1.2' } });
        expect(screen.getByText(/Audible artefacts/)).toBeInTheDocument();
    });

    it('shows warning when speed is below 0.85', () => {
        const speedInput = screen.getAllByRole('slider').find(
            (s) => s.getAttribute('min') === '0.25'
        );
        fireEvent.change(speedInput, { target: { value: '0.8' } });
        expect(screen.getByText(/Audible artefacts/)).toBeInTheDocument();
    });

    it('dismissing the warning hides it permanently for that card', () => {
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: '+' }));
        fireEvent.click(screen.getByTitle('Dismiss warning'));
        expect(screen.queryByText(/Audible artefacts/)).not.toBeInTheDocument();
        // Incrementing further should not bring it back
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        expect(screen.queryByText(/Audible artefacts/)).not.toBeInTheDocument();
    });
});

// ─── EQ controls ─────────────────────────────────────────────────────────────

describe('TrackCard — EQ controls', () => {
    beforeEach(() => { renderWithSettings(); });

    it('renders EQ sliders for Lo, Mid, and Hi bands', () => {
        expect(screen.getByRole('slider', { name: 'EQ Lo' })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'EQ Mid' })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'EQ Hi' })).toBeInTheDocument();
    });

    it('shows 0dB value for all bands by default', () => {
        // Values rendered as "+0dB" or "0dB" — regex matches both
        const zeroBands = screen.getAllByText(/^[+]?0dB$/);
        expect(zeroBands.length).toBe(3);
    });

    it('EQ reset button is not shown when all bands are at 0', () => {
        expect(screen.queryByTitle('Reset EQ')).not.toBeInTheDocument();
    });

    it('moving the Lo EQ slider calls setEQ with the updated low value', () => {
        fireEvent.change(screen.getByRole('slider', { name: 'EQ Lo' }), { target: { value: '6' } });
        expect(mockSetEQ).toHaveBeenCalledWith(expect.objectContaining({ low: 6 }));
    });

    it('moving the Mid EQ slider calls setEQ with the updated mid value', () => {
        fireEvent.change(screen.getByRole('slider', { name: 'EQ Mid' }), { target: { value: '-3' } });
        expect(mockSetEQ).toHaveBeenCalledWith(expect.objectContaining({ mid: -3 }));
    });

    it('moving the Hi EQ slider calls setEQ with the updated high value', () => {
        fireEvent.change(screen.getByRole('slider', { name: 'EQ Hi' }), { target: { value: '3' } });
        expect(mockSetEQ).toHaveBeenCalledWith(expect.objectContaining({ high: 3 }));
    });

    it('EQ reset button appears when a band is non-zero', () => {
        fireEvent.change(screen.getByRole('slider', { name: 'EQ Lo' }), { target: { value: '6' } });
        expect(screen.getByTitle('Reset EQ')).toBeInTheDocument();
    });

    it('clicking EQ reset calls setEQ with all bands at 0', () => {
        fireEvent.change(screen.getByRole('slider', { name: 'EQ Lo' }), { target: { value: '6' } });
        fireEvent.click(screen.getByTitle('Reset EQ'));
        expect(mockSetEQ).toHaveBeenLastCalledWith({ low: 0, mid: 0, high: 0 });
    });

    it('clicking Kill Lo band button disables the Lo band', () => {
        fireEvent.click(screen.getByTitle('Kill Lo band'));
        // EQ should be called with low=-40 (kill)
        expect(mockSetEQ).toHaveBeenCalledWith(expect.objectContaining({ low: -40 }));
    });

    it('kill button label changes to "On" after kill is applied', () => {
        fireEvent.click(screen.getByTitle('Kill Lo band'));
        expect(screen.getByTitle('Restore Lo band')).toBeInTheDocument();
    });

    it('clicking the kill button again restores the band', () => {
        fireEvent.click(screen.getByTitle('Kill Lo band'));
        fireEvent.click(screen.getByTitle('Restore Lo band'));
        // Should restore to 0dB (kill released, slider value is still 0)
        expect(mockSetEQ).toHaveBeenLastCalledWith(expect.objectContaining({ low: 0 }));
    });

    it('EQ reset button appears when a band is killed', () => {
        fireEvent.click(screen.getByTitle('Kill Lo band'));
        expect(screen.getByTitle('Reset EQ')).toBeInTheDocument();
    });

    it('EQ reset clears all kills', () => {
        fireEvent.click(screen.getByTitle('Kill Lo band'));
        fireEvent.click(screen.getByTitle('Reset EQ'));
        // All bands should be restored — low is back at 0, not -40
        expect(mockSetEQ).toHaveBeenLastCalledWith({ low: 0, mid: 0, high: 0 });
        expect(screen.queryByTitle('Restore Lo band')).not.toBeInTheDocument();
    });
});

// ─── Audio effects ────────────────────────────────────────────────────────────

describe('TrackCard — audio effects', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupMocks();
        global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
        global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = jest.fn();
        renderWithSettings();
    });

    it('shows "No effects added." when no effects are present', () => {
        expect(screen.getByText('No effects added.')).toBeInTheDocument();
    });

    it('clicking "Add Effect" opens the effect type menu', () => {
        fireEvent.click(screen.getByText('Add Effect'));
        expect(screen.getByText('Volume')).toBeInTheDocument();
        expect(screen.getByText('Pass Filter')).toBeInTheDocument();
        expect(screen.getByText('Stereo Pan')).toBeInTheDocument();
        expect(screen.getByText('Reverb')).toBeInTheDocument();
        expect(screen.getByText('Delay')).toBeInTheDocument();
        expect(screen.getByText('Compressor')).toBeInTheDocument();
    });

    it('selecting an effect type from the menu calls addEffect', () => {
        mockAddEffect.mockReturnValue(42);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        expect(mockAddEffect).toHaveBeenCalledWith('reverb');
    });

    it('a successfully added effect is rendered in the effects list', () => {
        mockAddEffect.mockReturnValue(42);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        expect(screen.queryByText('No effects added.')).not.toBeInTheDocument();
        // CSS text-transform:uppercase does not affect DOM text content in JSDOM —
        // the actual text node is the raw label value from EFFECT_CONFIGS.
        expect(screen.getByText('Reverb')).toBeInTheDocument();
    });

    it('does not add an effect when addEffect returns null (engine not ready)', () => {
        mockAddEffect.mockReturnValue(null);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        expect(screen.getByText('No effects added.')).toBeInTheDocument();
    });

    it('clicking the X on an effect card calls removeEffect', () => {
        mockAddEffect.mockReturnValue(42);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        fireEvent.click(screen.getByTitle('Remove effect'));
        expect(mockRemoveEffect).toHaveBeenCalledWith(42);
    });

    it('removed effect disappears from the list', () => {
        mockAddEffect.mockReturnValue(42);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        fireEvent.click(screen.getByTitle('Remove effect'));
        expect(screen.getByText('No effects added.')).toBeInTheDocument();
    });

    it('adding multiple effects shows all of them', () => {
        mockAddEffect.mockReturnValueOnce(1).mockReturnValueOnce(2);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Delay'));
        // Text nodes are the raw label values; CSS uppercase only affects rendering
        expect(screen.getByText('Reverb')).toBeInTheDocument();
        expect(screen.getByText('Delay')).toBeInTheDocument();
    });

    it('effect param slider calls setEffectParam when changed', () => {
        mockAddEffect.mockReturnValue(99);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Reverb'));
        // Reverb has one param: Mix (aria-label="Reverb Mix")
        const mixSlider = screen.getByRole('slider', { name: 'Reverb Mix' });
        fireEvent.change(mixSlider, { target: { value: '0.8' } });
        expect(mockSetEffectParam).toHaveBeenCalledWith(99, 'mix', 0.8);
    });

    it('Pass Filter type selector buttons are rendered', () => {
        mockAddEffect.mockReturnValue(5);
        fireEvent.click(screen.getByText('Add Effect'));
        fireEvent.click(screen.getByText('Pass Filter'));
        expect(screen.getByText('High-pass')).toBeInTheDocument();
        expect(screen.getByText('Low-pass')).toBeInTheDocument();
    });
});
