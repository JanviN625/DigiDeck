import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlaylistModal from '../components/PlaylistModal';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../spotify/appContext', () => ({
    useSpotify: jest.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    const { useSpotify } = require('../spotify/appContext');
    useSpotify.mockReturnValue({ getPlaylistTracks: mockGetPlaylistTracks });
    mockGetPlaylistTracks.mockResolvedValue({ items: mockTrackItems });
});

// ─── Closed state ─────────────────────────────────────────────────────────────

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
        await waitFor(() => screen.getByText('Song One'));

        rerender(<PlaylistModal isOpen={false} onClose={jest.fn()} playlist={mockPlaylist} />);
        // After re-opening the next render call will re-fetch
        expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(1);
    });
});

// ─── Open state — header ──────────────────────────────────────────────────────

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

// ─── Open state — track list ──────────────────────────────────────────────────

describe('PlaylistModal — track list', () => {
    it('calls getPlaylistTracks with the playlist id on open', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => expect(mockGetPlaylistTracks).toHaveBeenCalledWith('playlist_1', 50, 0));
    });

    it('renders track names after a successful fetch', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => expect(screen.getByText('Song One')).toBeInTheDocument());
        expect(screen.getByText('Song Two')).toBeInTheDocument();
    });

    it('renders artist and album info for each track', async () => {
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => screen.getByText('Song One'));
        expect(screen.getByText(/Artist A/)).toBeInTheDocument();
    });

    it('shows "No Tracks Found" when fetch returns an empty list', async () => {
        mockGetPlaylistTracks.mockResolvedValue({ items: [] });
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => expect(screen.getByText('No Tracks Found')).toBeInTheDocument());
    });

    it('shows "No Tracks Found" when fetch returns no items property', async () => {
        mockGetPlaylistTracks.mockResolvedValue({});
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => expect(screen.getByText('No Tracks Found')).toBeInTheDocument());
    });

    it('filters out local tracks from the rendered list', async () => {
        const localItem = {
            track: { id: 'local1', name: 'Local Track', type: 'track' },
            is_local: true,
        };
        mockGetPlaylistTracks.mockResolvedValue({ items: [...mockTrackItems, localItem] });
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => screen.getByText('Song One'));
        expect(screen.queryByText('Local Track')).not.toBeInTheDocument();
    });

    it('shows an error message when the fetch rejects', async () => {
        mockGetPlaylistTracks.mockRejectedValue(new Error('Network timeout'));
        render(<PlaylistModal isOpen={true} onClose={jest.fn()} playlist={mockPlaylist} />);
        await waitFor(() => expect(screen.getByText('Failed to Load Tracks')).toBeInTheDocument());
        expect(screen.getByText('Network timeout')).toBeInTheDocument();
    });
});

// ─── Close button ─────────────────────────────────────────────────────────────

describe('PlaylistModal — close button', () => {
    it('calls onClose when the X button is clicked', async () => {
        const onClose = jest.fn();
        render(<PlaylistModal isOpen={true} onClose={onClose} playlist={mockPlaylist} />);
        await waitFor(() => screen.getByText('Song One'));
        fireEvent.click(screen.getByTitle('Close Modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
