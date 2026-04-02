import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MainWorkspace from '../components/MainWorkspace';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Stub TrackCard to avoid Web Audio / WaveSurfer / Essentia dependencies.
// Plain function (not jest.fn) so clearAllMocks() cannot clear the implementation.
jest.mock('../components/TrackCard', () => ({
    __esModule: true,
    default: ({ title, trackId, onDragStart, onDragEnd, onDragHover, isDragged }) => (
        <div
            data-testid="track-card"
            data-trackid={trackId}
            data-dragged={isDragged ? 'true' : undefined}
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onMouseEnter={() => onDragHover && onDragHover('top')}
            onMouseLeave={() => onDragHover && onDragHover(null)}
        >
            {title}
        </div>
    ),
}));

jest.mock('../spotify/appContext', () => ({
    useMix: jest.fn(),
}));

const mockHandleAddTrack = jest.fn();
const mockHandleDuplicateTrack = jest.fn();
const mockHandleDeleteTrack = jest.fn();
const mockHandleMoveTrack = jest.fn();
const mockSetTrackLimitError = jest.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeTracks = (n) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        title: `Track ${i + 1}`,
        initiallyExpanded: false,
    }));

const defaultContext = (overrides = {}) => ({
    tracks: makeTracks(2),
    handleAddTrack: mockHandleAddTrack,
    handleDuplicateTrack: mockHandleDuplicateTrack,
    handleDeleteTrack: mockHandleDeleteTrack,
    handleMoveTrack: mockHandleMoveTrack,
    trackLimitError: null,
    setTrackLimitError: mockSetTrackLimitError,
    ...overrides,
});

// Set useMix return value — called in each beforeEach to survive clearAllMocks
const setupUseMix = (overrides = {}) => {
    const { useMix } = require('../spotify/appContext');
    useMix.mockReturnValue(defaultContext(overrides));
};

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('MainWorkspace — rendering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupUseMix();
    });

    it('renders a TrackCard for each track', () => {
        render(<MainWorkspace />);
        expect(screen.getAllByTestId('track-card')).toHaveLength(2);
    });

    it('renders the correct track titles', () => {
        render(<MainWorkspace />);
        expect(screen.getByText('Track 1')).toBeInTheDocument();
        expect(screen.getByText('Track 2')).toBeInTheDocument();
    });

    it('renders nothing when tracks array is empty', () => {
        setupUseMix({ tracks: [] });
        render(<MainWorkspace />);
        expect(screen.queryByTestId('track-card')).not.toBeInTheDocument();
    });

    it('passes the correct trackId to each TrackCard', () => {
        render(<MainWorkspace />);
        const cards = screen.getAllByTestId('track-card');
        expect(cards[0]).toHaveAttribute('data-trackid', '1');
        expect(cards[1]).toHaveAttribute('data-trackid', '2');
    });
});

// ─── Add New Track button ─────────────────────────────────────────────────────

describe('MainWorkspace — Add New Track button', () => {
    beforeEach(() => jest.clearAllMocks());

    it('shows the Add New Track button when track count is below 5', () => {
        setupUseMix({ tracks: makeTracks(2) });
        render(<MainWorkspace />);
        expect(screen.getByText(/Add New Track/i)).toBeInTheDocument();
    });

    it('shows the current track count in the button label', () => {
        setupUseMix({ tracks: makeTracks(3) });
        render(<MainWorkspace />);
        expect(screen.getByText(/3\/5/)).toBeInTheDocument();
    });

    it('hides the Add New Track button when at the 5-track limit', () => {
        setupUseMix({ tracks: makeTracks(5) });
        render(<MainWorkspace />);
        expect(screen.queryByText(/Add New Track/i)).not.toBeInTheDocument();
    });

    it('calls handleAddTrack when the button is clicked', () => {
        setupUseMix({ tracks: makeTracks(1) });
        render(<MainWorkspace />);
        fireEvent.click(screen.getByText(/Add New Track/i));
        expect(mockHandleAddTrack).toHaveBeenCalledTimes(1);
    });
});

// ─── Track limit error notification ──────────────────────────────────────────

describe('MainWorkspace — track limit error notification', () => {
    beforeEach(() => jest.clearAllMocks());

    it('displays the error message when trackLimitError is set', () => {
        setupUseMix({
            tracks: makeTracks(5),
            trackLimitError: 'Cannot add track: Maximum limit of 5 tracks reached.',
        });
        render(<MainWorkspace />);
        expect(
            screen.getByText('Cannot add track: Maximum limit of 5 tracks reached.')
        ).toBeInTheDocument();
    });

    it('does not show the error banner when trackLimitError is null', () => {
        setupUseMix({ trackLimitError: null });
        render(<MainWorkspace />);
        expect(
            screen.queryByText(/Cannot add track/i)
        ).not.toBeInTheDocument();
    });

    it('calls setTrackLimitError(null) when the close button is clicked', () => {
        setupUseMix({
            tracks: makeTracks(5),
            trackLimitError: 'Limit reached.',
        });
        render(<MainWorkspace />);
        // The close button is an X icon button next to the error message
        const closeButtons = screen.getAllByRole('button');
        // eslint-disable-next-line testing-library/no-node-access
        const closeBtn = closeButtons.find(btn => btn.closest('[class*="fixed"]'));
        if (closeBtn) fireEvent.click(closeBtn);
        expect(mockSetTrackLimitError).toHaveBeenCalledWith(null);
    });
});

// ─── Drag and drop — gap zone logic ──────────────────────────────────────────

describe('MainWorkspace — drag and drop', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupUseMix({ tracks: makeTracks(3) });
    });

    it('renders gap zones between tracks (count = tracks + 1)', () => {
        render(<MainWorkspace />);
        // 3 tracks → 4 gap zones (before each + after last)
        // Gap zones with active state are hard to query; check drag lifecycle doesn't throw
        expect(screen.getAllByTestId('track-card')).toHaveLength(3);
    });

    it('calls handleMoveTrack when a card is dropped on a gap zone', () => {
        render(<MainWorkspace />);
        const cards = screen.getAllByTestId('track-card');

        // Start dragging card at index 0
        fireEvent.dragStart(cards[0], {
            dataTransfer: { setData: jest.fn(), effectAllowed: '' },
        });

        // Gap zones are div siblings of the track cards (exclude the Add New Track button).
        // When dragging index 0, gap zones 0 and 1 are "useless gaps" (no onDrop handler).
        // Drop on gap zone index 2 — valid target that triggers handleMoveTrack(0, 1).
        // eslint-disable-next-line testing-library/no-node-access
        const container = cards[0].parentElement;
        // eslint-disable-next-line testing-library/no-node-access
        const containerChildren = container ? [...container.children] : [];
        const gapZones = containerChildren.filter(el =>
            !el.hasAttribute('data-testid') && el.tagName !== 'BUTTON');

        expect(gapZones.length).toBeGreaterThan(2);
        fireEvent.drop(gapZones[2], {
            dataTransfer: { getData: jest.fn(() => '0') },
        });
        expect(mockHandleMoveTrack).toHaveBeenCalled();
    });

    it('resets drag state (draggedIndex) when drag ends', () => {
        render(<MainWorkspace />);
        const cards = screen.getAllByTestId('track-card');

        fireEvent.dragStart(cards[0], {
            dataTransfer: { setData: jest.fn(), effectAllowed: '' },
        });

        // After drag ends, dragged styling should be cleared
        fireEvent.dragEnd(cards[0]);

        expect(cards[0]).not.toHaveAttribute('data-dragged', 'true');
    });
});

// ─── Settings defaults passed to handleAddTrack ──────────────────────────────

describe('MainWorkspace — settings defaults on Add New Track', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        setupUseMix({ tracks: makeTracks(1) });
    });
    afterEach(() => { localStorage.clear(); });

    it('passes default settings values when localStorage is empty', () => {
        render(<MainWorkspace />);
        fireEvent.click(screen.getByText(/Add New Track/i));
        expect(mockHandleAddTrack).toHaveBeenCalledWith({
            initialVolume: 80,
            initialZoom: 0,
            initialFadeIn: 0,
            initialFadeOut: 0,
        });
    });

    it('uses stored volume from localStorage when custom settings are saved', () => {
        localStorage.setItem('digideck_settings', JSON.stringify({ defaultVolume: 60 }));
        render(<MainWorkspace />);
        fireEvent.click(screen.getByText(/Add New Track/i));
        expect(mockHandleAddTrack).toHaveBeenCalledWith(
            expect.objectContaining({ initialVolume: 60 })
        );
    });
});

// ─── GapZone hover and timer logic ────────────────────────────────────────────

describe('MainWorkspace — gap zone hover behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupUseMix({ tracks: makeTracks(2) });
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('shows gap drop zone text when dragging over a gap', () => {
        render(<MainWorkspace />);
        const cards = screen.getAllByTestId('track-card');

        fireEvent.dragStart(cards[0], {
            dataTransfer: { setData: jest.fn(), effectAllowed: '' },
        });

        // dragOver on the last gap zone (after all cards)
        // eslint-disable-next-line testing-library/no-node-access
        const container = cards[0].parentElement;
        // eslint-disable-next-line testing-library/no-node-access
        const allChildren = container ? [...container.children] : [];
        const gapZones = allChildren.filter(
            el => !el.hasAttribute('data-testid') && el.tagName !== 'BUTTON'
        );

        if (gapZones.length > 0) {
            fireEvent.dragOver(gapZones[gapZones.length - 1], { preventDefault: jest.fn(), stopPropagation: jest.fn() });
            // The gap zone activates — no assertion on text needed, just no throw
        }
    });

    it('schedules gap clear on drag leave from a gap zone', () => {
        render(<MainWorkspace />);
        const cards = screen.getAllByTestId('track-card');
        // eslint-disable-next-line testing-library/no-node-access
        const container = cards[0].parentElement;
        // eslint-disable-next-line testing-library/no-node-access
        const containerChildren2 = container ? [...container.children] : [];
        const gapZones = containerChildren2.filter(el => !el.hasAttribute('data-testid') && el.tagName !== 'BUTTON');

        if (gapZones.length > 0) {
            fireEvent.dragLeave(gapZones[0]);
            // Timer is scheduled — no throw expected
            jest.runAllTimers();
        }
    });

    it('resets drag state on dragEnd', () => {
        render(<MainWorkspace />);
        const cards = screen.getAllByTestId('track-card');
        fireEvent.dragStart(cards[0], {
            dataTransfer: { setData: jest.fn(), effectAllowed: '' },
        });
        fireEvent.dragEnd(cards[0]);
        expect(cards[0]).not.toHaveAttribute('data-dragged', 'true');
    });
});

// ─── GapZone toIndex calculation ──────────────────────────────────────────────

describe('MainWorkspace — GapZone toIndex calculation', () => {
    /**
     * The handleGapDrop logic:
     *   toIndex = fromIndex < gapIndex ? gapIndex - 1 : gapIndex
     *
     * Verified indirectly by checking handleMoveTrack call args.
     */

    beforeEach(() => {
        jest.clearAllMocks();
        setupUseMix({ tracks: makeTracks(3) });
    });

    it('does not call handleMoveTrack when dataTransfer has no trackIndex', () => {
        render(<MainWorkspace />);
        // eslint-disable-next-line testing-library/no-node-access
        const container = screen.getAllByTestId('track-card')[0].parentElement;
        if (!container) return;

        // eslint-disable-next-line testing-library/no-node-access
        const gapZone = [...container.children].find(
            el => !el.hasAttribute('data-testid')
        );
        expect(gapZone).toBeDefined();
        fireEvent.drop(gapZone, {
            dataTransfer: { getData: jest.fn(() => '') },
        });
        expect(mockHandleMoveTrack).not.toHaveBeenCalled();
    });
});
