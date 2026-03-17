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
    Slider: ({ value, onChange, minValue, maxValue, step }) => (
        <input
            data-testid="heroui-slider"
            type="range"
            value={value}
            min={minValue}
            max={maxValue}
            step={step}
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

const setupMocks = (extraTracks = []) => {
    const { useAudioEngine } = require('../audio/useAudioEngine');
    const { useMix } = require('../spotify/appContext');

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
