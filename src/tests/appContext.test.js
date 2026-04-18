// Requirements: [FR-003] [FR-004] [FR-005] [FR-007] [FR-008] [FR-019] [FR-020]

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { AppProviders, useMix, useSpotifyConnect } from '../spotify/appContext';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Factories are kept minimal (no closures over outer variables) to avoid
// Jest-hoist temporal-dead-zone issues. Implementations are set in beforeEach.

jest.mock('../firebase/firebaseConfig', () => ({ auth: {}, db: {} }));

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
    doc: jest.fn(() => 'mock_ref'),
    onSnapshot: jest.fn(),
}));

jest.mock('../spotify/spotifyApi', () => ({
    default: {
        getUserPlaylists: jest.fn(),
        getPlaylist: jest.fn(),
        getPlaylistTracks: jest.fn(),
        searchSpotify: jest.fn(),
    },
    initiateLogin: jest.fn(),
    disconnectSpotify: jest.fn(),
    isLoggedIn: jest.fn(),
}));

// ─── Shared callback capture ──────────────────────────────────────────────────

let capturedAuthCallback = null;
let capturedSnapshotCallback = null;

// Applied in the global beforeEach so the implementation is always fresh
// and not affected by jest.clearAllMocks() ordering.
const setupMocks = () => {
    capturedAuthCallback = null;
    capturedSnapshotCallback = null;

    const { onAuthStateChanged } = require('firebase/auth');
    onAuthStateChanged.mockImplementation((auth, cb) => {
        capturedAuthCallback = cb;
        return jest.fn(); // unsubscribe
    });

    const { onSnapshot } = require('firebase/firestore');
    onSnapshot.mockImplementation((ref, cb) => {
        capturedSnapshotCallback = cb;
        return jest.fn(); // unsubscribe
    });

    const { initiateLogin, disconnectSpotify, isLoggedIn } = require('../spotify/spotifyApi');
    initiateLogin.mockResolvedValue(undefined);
    disconnectSpotify.mockResolvedValue(undefined);
    isLoggedIn.mockReturnValue(false);
};

// ─── Test wrappers ────────────────────────────────────────────────────────────

const mixWrapper = ({ children }) => <AppProviders>{children}</AppProviders>;
const renderMix = () => renderHook(() => useMix(), { wrapper: mixWrapper });

// ─── Initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('starts with two default tracks', () => {
        const { result } = renderMix();
        expect(result.current.tracks).toHaveLength(2);
    });

    it('default tracks are named Track 1 and Track 2', () => {
        const { result } = renderMix();
        const titles = result.current.tracks.map(t => t.title);
        expect(titles).toEqual(['Track 1', 'Track 2']);
    });

    it('starts with universalIsPlaying false', () => {
        const { result } = renderMix();
        expect(result.current.universalIsPlaying).toBe(false);
    });

    it('starts with trackLimitError null', () => {
        const { result } = renderMix();
        expect(result.current.trackLimitError).toBeNull();
    });

    it('starts with masterStopSignal 0', () => {
        const { result } = renderMix();
        expect(result.current.masterStopSignal).toBe(0);
    });
});

// ─── handleAddTrack — empty slot filling ─────────────────────────────────────

describe('handleAddTrack — real track fills first empty slot', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('fills the first empty slot when a real track is added', () => {
        const { result } = renderMix();
        act(() => {
            result.current.handleAddTrack({
                title: 'Imported Song',
                audioUrl: 'http://audio.mp3',
                spotifyId: 'sp_1',
            });
        });
        expect(result.current.tracks[0].title).toBe('Imported Song');
        expect(result.current.tracks[0].audioUrl).toBe('http://audio.mp3');
    });

    it('fills slot 0 first, then slot 1', () => {
        const { result } = renderMix();
        act(() => {
            result.current.handleAddTrack({ title: 'Song A', audioUrl: 'http://a.mp3', spotifyId: 's1' });
        });
        act(() => {
            result.current.handleAddTrack({ title: 'Song B', audioUrl: 'http://b.mp3', spotifyId: 's2' });
        });
        expect(result.current.tracks[0].title).toBe('Song A');
        expect(result.current.tracks[1].title).toBe('Song B');
    });

    it('appends a new track once all default empty slots are filled', () => {
        const { result } = renderMix();
        act(() => {
            result.current.handleAddTrack({ title: 'A', audioUrl: 'u1', spotifyId: 's1' });
            result.current.handleAddTrack({ title: 'B', audioUrl: 'u2', spotifyId: 's2' });
        });
        act(() => {
            result.current.handleAddTrack({ title: 'C', audioUrl: 'u3', spotifyId: 's3' });
        });
        expect(result.current.tracks).toHaveLength(3);
        expect(result.current.tracks[2].title).toBe('C');
    });

    it('preserves a custom slot title when the incoming track has no title', () => {
        const { result } = renderMix();
        act(() => {
            result.current.handleUpdateTrack(result.current.tracks[0].id, { title: 'My Custom Name' });
        });
        act(() => {
            result.current.handleAddTrack({ audioUrl: 'http://audio.mp3', spotifyId: 's1' });
        });
        expect(result.current.tracks[0].title).toBe('My Custom Name');
    });
});

// ─── handleAddTrack — empty button click ─────────────────────────────────────

describe('handleAddTrack — empty button click (no trackData)', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('appends a new auto-named track', () => {
        const { result } = renderMix();
        act(() => { result.current.handleAddTrack(); });
        expect(result.current.tracks).toHaveLength(3);
    });

    it('names the new track Track 3 when Track 1 and Track 2 exist', () => {
        const { result } = renderMix();
        act(() => { result.current.handleAddTrack(); });
        expect(result.current.tracks[2].title).toBe('Track 3');
    });
});

// ─── handleAddTrack — track limit ────────────────────────────────────────────

describe('handleAddTrack — track limit (max 5)', () => { // [FR-020]
    beforeEach(() => {
        setupMocks();
        jest.useFakeTimers();
        localStorage.clear();
    });
    afterEach(() => jest.useRealTimers());

    it('does not add a 6th track when already at 5', () => {
        const { result } = renderMix();
        act(() => {
            for (let i = 3; i <= 5; i++) result.current.handleAddTrack();
        });
        expect(result.current.tracks).toHaveLength(5);
        act(() => { result.current.handleAddTrack(); });
        expect(result.current.tracks).toHaveLength(5);
    });

    it('sets trackLimitError after attempting to exceed limit', () => {
        const { result } = renderMix();
        act(() => { for (let i = 3; i <= 5; i++) result.current.handleAddTrack(); });
        act(() => { result.current.handleAddTrack(); });
        // runOnlyPendingTimers fires the setTimeout(0) that sets the error,
        // without also firing the 3500ms auto-clear timer.
        act(() => { jest.runOnlyPendingTimers(); });
        expect(result.current.trackLimitError).toBeTruthy();
    });

    it('auto-clears the trackLimitError after 3500ms', () => {
        const { result } = renderMix();
        act(() => { for (let i = 3; i <= 5; i++) result.current.handleAddTrack(); });
        act(() => {
            result.current.handleAddTrack();
            jest.advanceTimersByTime(10);
        });
        act(() => { jest.advanceTimersByTime(4000); });
        expect(result.current.trackLimitError).toBeNull();
    });
});

// ─── handleDuplicateTrack ─────────────────────────────────────────────────────

describe('handleDuplicateTrack', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('inserts the duplicate immediately after the source track', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDuplicateTrack(trackId, { title: 'Track 1' }); });
        // The duplicate (now at index 1) should follow the original (index 0)
        expect(result.current.tracks[1].title).toMatch(/Track 1/);
    });

    it('increases the track count by 1', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDuplicateTrack(trackId, { title: 'Track 1' }); });
        expect(result.current.tracks).toHaveLength(3);
    });

    it('appends a uniqueness suffix to avoid name collisions', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDuplicateTrack(trackId, { title: 'Track 1' }); });
        const titles = result.current.tracks.map(t => t.title);
        expect(titles.filter(t => t === 'Track 1')).toHaveLength(1);
        expect(titles.some(t => t.startsWith('Track 1 ('))).toBe(true);
    });

    it('does not allow duplicating an existing track if at the 5-track count limit', () => {
        jest.useFakeTimers();
        const { result } = renderMix();
        act(() => { for (let i = 3; i <= 5; i++) result.current.handleAddTrack(); });
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDuplicateTrack(trackId, { title: 'Track 1' }); });
        // Duplicates are now blocked if track boundary limit of 5 is hit
        expect(result.current.tracks).toHaveLength(5);
        
        act(() => { jest.runOnlyPendingTimers(); });
        expect(result.current.trackLimitError).toBeTruthy();
        jest.useRealTimers();
    });

    it('assigns a new unique id to the duplicate', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDuplicateTrack(trackId, { title: 'Track 1' }); });
        const ids = result.current.tracks.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// ─── handleDeleteTrack ────────────────────────────────────────────────────────

describe('handleDeleteTrack', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('removes the track with the given id', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDeleteTrack(trackId); });
        expect(result.current.tracks.find(t => t.id === trackId)).toBeUndefined();
    });

    it('decrements the track count by 1', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDeleteTrack(trackId); });
        expect(result.current.tracks).toHaveLength(1);
    });

    it('does nothing when the id does not match any track', () => {
        const { result } = renderMix();
        act(() => { result.current.handleDeleteTrack(99999); });
        expect(result.current.tracks).toHaveLength(2);
    });

    it('allows all tracks to be deleted', () => {
        const { result } = renderMix();
        act(() => {
            const ids = result.current.tracks.map(t => t.id);
            ids.forEach(id => result.current.handleDeleteTrack(id));
        });
        expect(result.current.tracks).toHaveLength(0);
    });
});

// ─── handleMoveTrack ──────────────────────────────────────────────────────────

describe('handleMoveTrack', () => { // [FR-019]
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('moves a track from index 0 to index 1', () => {
        const { result } = renderMix();
        const originalFirst = result.current.tracks[0].title;
        act(() => { result.current.handleMoveTrack(0, 1); });
        expect(result.current.tracks[1].title).toBe(originalFirst);
    });

    it('moves a track from index 1 to index 0', () => {
        const { result } = renderMix();
        const originalSecond = result.current.tracks[1].title;
        act(() => { result.current.handleMoveTrack(1, 0); });
        expect(result.current.tracks[0].title).toBe(originalSecond);
    });

    it('preserves track count after a move', () => {
        const { result } = renderMix();
        act(() => { result.current.handleMoveTrack(0, 1); });
        expect(result.current.tracks).toHaveLength(2);
    });

    it('is a no-op when fromIndex equals toIndex', () => {
        const { result } = renderMix();
        const before = result.current.tracks.map(t => t.title);
        act(() => { result.current.handleMoveTrack(0, 0); });
        expect(result.current.tracks.map(t => t.title)).toEqual(before);
    });

    it('is a no-op for negative fromIndex', () => {
        const { result } = renderMix();
        const before = result.current.tracks.map(t => t.title);
        act(() => { result.current.handleMoveTrack(-1, 0); });
        expect(result.current.tracks.map(t => t.title)).toEqual(before);
    });
});

// ─── handleUpdateTrack ────────────────────────────────────────────────────────

describe('handleUpdateTrack', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('merges the provided updates onto the target track', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => {
            result.current.handleUpdateTrack(trackId, { bpm: '120', trackKey: 'C major' });
        });
        const updated = result.current.tracks.find(t => t.id === trackId);
        expect(updated.bpm).toBe('120');
        expect(updated.trackKey).toBe('C major');
    });

    it('does not affect other tracks', () => {
        const { result } = renderMix();
        const [track1, track2] = result.current.tracks;
        act(() => { result.current.handleUpdateTrack(track1.id, { bpm: '90' }); });
        const t2After = result.current.tracks.find(t => t.id === track2.id);
        expect(t2After.bpm).toBeUndefined();
    });
});

// ─── universalIsPlaying + triggerMasterStop ───────────────────────────────────

describe('universalIsPlaying', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('can be set to true', () => {
        const { result } = renderMix();
        act(() => { result.current.setUniversalIsPlaying(true); });
        expect(result.current.universalIsPlaying).toBe(true);
    });

    it('can be toggled with a functional update', () => {
        const { result } = renderMix();
        act(() => { result.current.setUniversalIsPlaying(v => !v); });
        expect(result.current.universalIsPlaying).toBe(true);
    });
});

describe('triggerMasterStop', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('sets universalIsPlaying to false', () => {
        const { result } = renderMix();
        act(() => { result.current.setUniversalIsPlaying(true); });
        act(() => { result.current.triggerMasterStop(); });
        expect(result.current.universalIsPlaying).toBe(false);
    });

    it('increments masterStopSignal on each call', () => {
        const { result } = renderMix();
        const before = result.current.masterStopSignal;
        act(() => { result.current.triggerMasterStop(); });
        act(() => { result.current.triggerMasterStop(); });
        expect(result.current.masterStopSignal).toBe(before + 2);
    });
});

// ─── Workspace initialization ─────────────────────────────────────────────────

describe('workspace initialization', () => { // [FR-007]
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('starts with default tracks on login (no localStorage restore)', async () => {
        const { result } = renderMix();

        await act(async () => { capturedAuthCallback({ uid: 'user_abc' }); });

        expect(result.current.tracks.map(t => t.title)).toEqual(['Track 1', 'Track 2']);
    });

    it('does not restore workspace from localStorage even if data exists', async () => {
        localStorage.setItem('digideck_workspace_user_abc', JSON.stringify([
            { id: 10, title: 'Old Track A' },
        ]));

        const { result } = renderMix();

        await act(async () => { capturedAuthCallback({ uid: 'user_abc' }); });

        // Workspace should still be default tracks, not restored from localStorage
        expect(result.current.tracks.map(t => t.title)).toEqual(['Track 1', 'Track 2']);
    });

    it('resets to default tracks on sign-out', async () => {
        const { result } = renderMix();

        await act(async () => { capturedAuthCallback({ uid: 'user_abc' }); });
        await act(async () => { result.current.handleAddTrack({ title: 'My Track', audioUrl: 'url' }); });
        await act(async () => { capturedAuthCallback(null); });

        expect(result.current.tracks.map(t => t.title)).toEqual(['Track 1', 'Track 2']);
    });
});

// ─── handleOverwriteWorkspace ─────────────────────────────────────────────────

describe('handleOverwriteWorkspace', () => { // [FR-028]
    beforeEach(() => setupMocks());

    it('replaces tracks with the provided array', () => {
        const { result } = renderMix();
        const newTracks = [{ id: 99, title: 'Loaded Track', initiallyExpanded: false }];

        act(() => { result.current.handleOverwriteWorkspace({ tracks: newTracks, masterBpm: 140, globalZoom: 20 }); });

        expect(result.current.tracks).toEqual(newTracks);
    });

    it('updates masterBpm when provided', () => {
        const { result } = renderMix();

        act(() => { result.current.handleOverwriteWorkspace({ tracks: [], masterBpm: 120, globalZoom: 0 }); });

        expect(result.current.masterBpm).toBe(120);
    });

    it('updates globalZoom when provided', () => {
        const { result } = renderMix();

        act(() => { result.current.handleOverwriteWorkspace({ tracks: [], masterBpm: 128, globalZoom: 50 }); });

        expect(result.current.globalZoom).toBe(50);
    });

    it('adds the overwritten tracks to undo history', () => {
        const { result } = renderMix();
        const newTracks = [{ id: 77, title: 'Loaded' }];

        act(() => { result.current.handleOverwriteWorkspace({ tracks: newTracks }); });

        expect(result.current.canUndo).toBe(true);
    });
});

// ─── handleUpdateTrackDuration ───────────────────────────────────────────────

describe('handleUpdateTrackDuration', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('sets the duration on the target track', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleUpdateTrackDuration(trackId, 180); });
        expect(result.current.tracks.find(t => t.id === trackId).duration).toBe(180);
    });

    it('does not modify other tracks', () => {
        const { result } = renderMix();
        const [t1, t2] = result.current.tracks;
        act(() => { result.current.handleUpdateTrackDuration(t1.id, 90); });
        expect(result.current.tracks.find(t => t.id === t2.id).duration).toBeUndefined();
    });
});

// ─── handleClearAllTracks ─────────────────────────────────────────────────────

describe('handleClearAllTracks', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('resets back to exactly 2 default tracks', () => {
        const { result } = renderMix();
        act(() => { result.current.handleAddTrack(); });
        expect(result.current.tracks).toHaveLength(3);
        act(() => { result.current.handleClearAllTracks(); });
        expect(result.current.tracks).toHaveLength(2);
    });

    it('resets track titles to Track 1 and Track 2', () => {
        const { result } = renderMix();
        act(() => {
            result.current.handleAddTrack({ title: 'Custom', audioUrl: 'blob:x', spotifyId: 's1' });
        });
        act(() => { result.current.handleClearAllTracks(); });
        const titles = result.current.tracks.map(t => t.title);
        expect(titles).toEqual(['Track 1', 'Track 2']);
    });
});

// ─── handleOverwriteTracks ────────────────────────────────────────────────────

describe('handleOverwriteTracks', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('replaces the track list with the provided array', () => {
        const { result } = renderMix();
        const replacement = [
            { id: 999, title: 'Imported A', audioUrl: null, spotifyId: null },
            { id: 998, title: 'Imported B', audioUrl: null, spotifyId: null },
            { id: 997, title: 'Imported C', audioUrl: null, spotifyId: null },
        ];
        act(() => { result.current.handleOverwriteTracks(replacement); });
        expect(result.current.tracks.map(t => t.title)).toEqual(['Imported A', 'Imported B', 'Imported C']);
    });
});

// ─── handleAddTrack — insertAfterId ──────────────────────────────────────────

describe('handleAddTrack — insertAfterId', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('inserts a track immediately after the specified track id', () => {
        const { result } = renderMix();
        const firstId = result.current.tracks[0].id;
        act(() => {
            result.current.handleAddTrack({ title: 'Inserted', insertAfterId: firstId });
        });
        expect(result.current.tracks[1].title).toBe('Inserted');
    });
});

// ─── handleUndo / handleRedo ─────────────────────────────────────────────────

describe('handleUndo and handleRedo', () => {
    beforeEach(() => {
        setupMocks();
        localStorage.clear();
    });

    it('undo reverts the most recent track deletion', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        // handleDeleteTrack commits history
        act(() => { result.current.handleDeleteTrack(trackId); });
        expect(result.current.tracks).toHaveLength(1);
        act(() => { result.current.handleUndo(); });
        expect(result.current.tracks).toHaveLength(2);
    });

    it('redo reapplies a previously undone deletion', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDeleteTrack(trackId); });
        act(() => { result.current.handleUndo(); });
        act(() => { result.current.handleRedo(); });
        expect(result.current.tracks).toHaveLength(1);
    });

    it('undo is a no-op when already at the beginning of history', () => {
        const { result } = renderMix();
        // No history-committing changes made — undo should not change anything
        act(() => { result.current.handleUndo(); });
        expect(result.current.tracks).toHaveLength(2);
    });

    it('redo is a no-op when already at the end of history', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDeleteTrack(trackId); });
        // No undo done — redo should be a no-op
        act(() => { result.current.handleRedo(); });
        expect(result.current.tracks).toHaveLength(1);
    });

    it('canUndo is false at initial state', () => {
        const { result } = renderMix();
        expect(result.current.canUndo).toBe(false);
    });

    it('canUndo is true after a history-committing track mutation', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDeleteTrack(trackId); });
        expect(result.current.canUndo).toBe(true);
    });

    it('canRedo is true after an undo', () => {
        const { result } = renderMix();
        const trackId = result.current.tracks[0].id;
        act(() => { result.current.handleDeleteTrack(trackId); });
        act(() => { result.current.handleUndo(); });
        expect(result.current.canRedo).toBe(true);
    });
});

// ─── Firestore snapshot — doc does not exist ─────────────────────────────────

describe('useSpotifyConnect — Firestore snapshot when doc does not exist', () => {
    beforeEach(() => {
        setupMocks();
    });

    it('sets isSpotifyConnected false when Firestore doc does not exist', async () => {
        const { result } = renderHook(() => useSpotifyConnect());

        await act(async () => { capturedAuthCallback({ uid: 'user_no_doc' }); });

        await act(async () => {
            capturedSnapshotCallback({ exists: () => false, data: () => ({}) });
        });

        expect(result.current.isSpotifyConnected).toBe(false);
    });

    it('sets spotifyProfile null when Firestore doc does not exist', async () => {
        const { result } = renderHook(() => useSpotifyConnect());

        await act(async () => { capturedAuthCallback({ uid: 'user_no_doc2' }); });

        await act(async () => {
            capturedSnapshotCallback({ exists: () => false, data: () => ({}) });
        });

        expect(result.current.spotifyProfile).toBeNull();
    });
});

// ─── useSpotifyConnect ────────────────────────────────────────────────────────

describe('useSpotifyConnect', () => {
    beforeEach(() => {
        setupMocks();
    });

    it('starts with isSpotifyConnected false', () => {
        const { result } = renderHook(() => useSpotifyConnect());
        expect(result.current.isSpotifyConnected).toBe(false);
    });

    it('starts with isConnecting false', () => {
        const { result } = renderHook(() => useSpotifyConnect());
        expect(result.current.isConnecting).toBe(false);
    });

    it('sets isSpotifyConnected true when Firestore doc has spotify data and isLoggedIn is true', async () => {
        const { isLoggedIn } = require('../spotify/spotifyApi');
        isLoggedIn.mockReturnValue(true);

        const { result } = renderHook(() => useSpotifyConnect());

        await act(async () => { capturedAuthCallback({ uid: 'user_xyz' }); });

        await act(async () => {
            capturedSnapshotCallback({
                exists: () => true,
                data: () => ({ spotify: { spotifyUserId: 'sp_user' } }),
            });
        });

        expect(result.current.isSpotifyConnected).toBe(true);
    });

    it('sets isSpotifyConnected false when user signs out', async () => {
        const { result } = renderHook(() => useSpotifyConnect());

        await act(async () => { capturedAuthCallback({ uid: 'user_xyz' }); });
        await act(async () => { capturedAuthCallback(null); });

        expect(result.current.isSpotifyConnected).toBe(false);
    });

    it('calls initiateLogin when connectSpotify is invoked', async () => {
        const { initiateLogin } = require('../spotify/spotifyApi');
        const { result } = renderHook(() => useSpotifyConnect());

        await act(async () => { await result.current.connectSpotify(); });

        expect(initiateLogin).toHaveBeenCalledTimes(1);
    });

    it('resets spotify state when disconnectSpotify is invoked', async () => {
        const { isLoggedIn } = require('../spotify/spotifyApi');
        isLoggedIn.mockReturnValue(true);

        const { result } = renderHook(() => useSpotifyConnect());

        await act(async () => { capturedAuthCallback({ uid: 'user_xyz' }); });
        await act(async () => {
            capturedSnapshotCallback({
                exists: () => true,
                data: () => ({ spotify: { spotifyUserId: 'sp' } }),
            });
        });
        await act(async () => { await result.current.disconnectSpotify(); });

        expect(result.current.isSpotifyConnected).toBe(false);
        expect(result.current.spotifyProfile).toBeNull();
    });
});
