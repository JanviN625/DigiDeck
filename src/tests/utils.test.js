import { renderHook, act } from '@testing-library/react';
import { DEFAULT_SETTINGS, matchesKeybind, formatKeybind, useSettings } from '../utils/useSettings';
import {
    getDynamicInputWidth,
    getNextAvailableTrackName,
    getUniqueTrackName,
    readId3Tags,
    spotifyConfirmMatch,
} from '../utils/helpers';
import { useAudioEngine } from '../audio/useAudioEngine';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('music-metadata-browser', () => ({ parseBlob: jest.fn() }), { virtual: true });

jest.mock('../audio/AudioEngine', () => ({
    __esModule: true,
    default: {
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
        unloadTrack: jest.fn(),
    },
}));

// ─── Global setup ─────────────────────────────────────────────────────────────

let AudioEngine;

beforeEach(() => {
    jest.clearAllMocks();
    AudioEngine = require('../audio/AudioEngine').default;
    // resetMocks:true clears implementations — restore the one that returns a value
    AudioEngine.addEffect.mockReturnValue('effect_1');
});

// ─── DEFAULT_SETTINGS ─────────────────────────────────────────────────────────

describe('DEFAULT_SETTINGS shape', () => {
    it('exports a DEFAULT_SETTINGS object', () => {
        expect(DEFAULT_SETTINGS).toBeDefined();
        expect(typeof DEFAULT_SETTINGS).toBe('object');
    });

    it('confirmBeforeDelete defaults to true', () => {
        expect(DEFAULT_SETTINGS.confirmBeforeDelete).toBe(true);
    });

    it('animationsEnabled defaults to true', () => {
        expect(DEFAULT_SETTINGS.animationsEnabled).toBe(true);
    });

    it('defaultVolume defaults to 80', () => {
        expect(DEFAULT_SETTINGS.defaultVolume).toBe(80);
    });

    it('defaultZoom defaults to 0', () => {
        expect(DEFAULT_SETTINGS.defaultZoom).toBe(0);
    });

    it('defaultFadeIn defaults to 0', () => {
        expect(DEFAULT_SETTINGS.defaultFadeIn).toBe(0);
    });

    it('defaultFadeOut defaults to 0', () => {
        expect(DEFAULT_SETTINGS.defaultFadeOut).toBe(0);
    });

    it('splitAtPlayhead keybind defaults to Ctrl+S', () => {
        const kb = DEFAULT_SETTINGS.keybinds.splitAtPlayhead;
        expect(kb.key).toBe('s');
        expect(kb.ctrl).toBe(true);
        expect(kb.shift).toBe(false);
        expect(kb.alt).toBe(false);
    });

    it('playPause keybind defaults to Space', () => {
        const kb = DEFAULT_SETTINGS.keybinds.playPause;
        expect(kb.key).toBe(' ');
        expect(kb.ctrl).toBe(false);
        expect(kb.shift).toBe(false);
        expect(kb.alt).toBe(false);
    });
});

// ─── matchesKeybind ───────────────────────────────────────────────────────────

const makeEvent = (key, ctrl = false, shift = false, alt = false) => ({
    key, ctrlKey: ctrl, shiftKey: shift, altKey: alt,
});

describe('matchesKeybind', () => {
    it('returns false when binding is null', () => {
        expect(matchesKeybind(makeEvent('s'), null)).toBe(false);
    });

    it('returns false when binding is undefined', () => {
        expect(matchesKeybind(makeEvent('s'), undefined)).toBe(false);
    });

    it('matches Ctrl+S keybind', () => {
        const binding = { key: 's', ctrl: true, shift: false, alt: false };
        expect(matchesKeybind(makeEvent('s', true), binding)).toBe(true);
    });

    it('does not match when key differs', () => {
        const binding = { key: 's', ctrl: true, shift: false, alt: false };
        expect(matchesKeybind(makeEvent('a', true), binding)).toBe(false);
    });

    it('does not match when modifier differs', () => {
        const binding = { key: 's', ctrl: true, shift: false, alt: false };
        expect(matchesKeybind(makeEvent('s', false), binding)).toBe(false);
    });

    it('is case-insensitive for the key value', () => {
        const binding = { key: 's', ctrl: false, shift: false, alt: false };
        expect(matchesKeybind(makeEvent('S'), binding)).toBe(true);
    });

    it('matches Space keybind', () => {
        const binding = { key: ' ', ctrl: false, shift: false, alt: false };
        expect(matchesKeybind(makeEvent(' '), binding)).toBe(true);
    });

    it('does not match Space when Ctrl is held but binding requires no Ctrl', () => {
        const binding = { key: ' ', ctrl: false, shift: false, alt: false };
        expect(matchesKeybind(makeEvent(' ', true), binding)).toBe(false);
    });

    it('matches Ctrl+Alt+Shift+Z with all modifiers', () => {
        const binding = { key: 'z', ctrl: true, shift: true, alt: true };
        expect(matchesKeybind(makeEvent('z', true, true, true), binding)).toBe(true);
    });

    it('does not match when Alt is required but not held', () => {
        const binding = { key: 'z', ctrl: false, shift: false, alt: true };
        expect(matchesKeybind(makeEvent('z'), binding)).toBe(false);
    });
});

// ─── formatKeybind ────────────────────────────────────────────────────────────

describe('formatKeybind', () => {
    it('returns empty string for null', () => {
        expect(formatKeybind(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(formatKeybind(undefined)).toBe('');
    });

    it('formats Ctrl+S correctly', () => {
        expect(formatKeybind({ key: 's', ctrl: true, shift: false, alt: false })).toBe('Ctrl + S');
    });

    it('formats Space as "Space" not a literal space character', () => {
        expect(formatKeybind({ key: ' ', ctrl: false, shift: false, alt: false })).toBe('Space');
    });

    it('formats a plain letter key without modifiers', () => {
        expect(formatKeybind({ key: 'a', ctrl: false, shift: false, alt: false })).toBe('A');
    });

    it('formats Ctrl+Alt+Shift+Z with all modifiers in Ctrl > Alt > Shift > Key order', () => {
        const result = formatKeybind({ key: 'z', ctrl: true, shift: true, alt: true });
        expect(result).toBe('Ctrl + Alt + Shift + Z');
    });

    it('formats Alt+X with only Alt modifier', () => {
        expect(formatKeybind({ key: 'x', ctrl: false, shift: false, alt: true })).toBe('Alt + X');
    });

    it('uppercases the key letter', () => {
        expect(formatKeybind({ key: 'p', ctrl: false, shift: false, alt: false })).toBe('P');
    });
});

// ─── useSettings hook ─────────────────────────────────────────────────────────

describe('useSettings — initial state', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('returns DEFAULT_SETTINGS when localStorage is empty', () => {
        const { result } = renderHook(() => useSettings());
        expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('merges stored settings with defaults on init', () => {
        localStorage.setItem('digideck_settings', JSON.stringify({ defaultVolume: 55 }));
        const { result } = renderHook(() => useSettings());
        expect(result.current.settings.defaultVolume).toBe(55);
        expect(result.current.settings.animationsEnabled).toBe(true); // default preserved
    });

    it('falls back to defaults when localStorage contains invalid JSON', () => {
        localStorage.setItem('digideck_settings', 'not-valid-json!!');
        const { result } = renderHook(() => useSettings());
        expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('exposes DEFAULT_SETTINGS on the returned object', () => {
        const { result } = renderHook(() => useSettings());
        expect(result.current.DEFAULT_SETTINGS).toEqual(DEFAULT_SETTINGS);
    });
});

describe('useSettings — updateSetting', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('updates a single setting in state', () => {
        const { result } = renderHook(() => useSettings());
        act(() => { result.current.updateSetting('defaultVolume', 42); });
        expect(result.current.settings.defaultVolume).toBe(42);
    });

    it('persists the updated setting to localStorage', () => {
        const { result } = renderHook(() => useSettings());
        act(() => { result.current.updateSetting('defaultVolume', 42); });
        const stored = JSON.parse(localStorage.getItem('digideck_settings'));
        expect(stored.defaultVolume).toBe(42);
    });

    it('preserves all other settings when one is updated', () => {
        const { result } = renderHook(() => useSettings());
        act(() => { result.current.updateSetting('defaultZoom', 30); });
        expect(result.current.settings.animationsEnabled).toBe(true);
        expect(result.current.settings.defaultVolume).toBe(80);
    });

    it('can update a nested keybind setting', () => {
        const { result } = renderHook(() => useSettings());
        const newKeybinds = {
            ...DEFAULT_SETTINGS.keybinds,
            playPause: { key: 'p', ctrl: false, shift: false, alt: false },
        };
        act(() => { result.current.updateSetting('keybinds', newKeybinds); });
        expect(result.current.settings.keybinds.playPause.key).toBe('p');
    });

    it('updates a boolean setting', () => {
        const { result } = renderHook(() => useSettings());
        act(() => { result.current.updateSetting('confirmBeforeDelete', false); });
        expect(result.current.settings.confirmBeforeDelete).toBe(false);
    });
});

describe('useSettings — resetSettings', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('resets settings back to DEFAULT_SETTINGS', () => {
        const { result } = renderHook(() => useSettings());
        act(() => { result.current.updateSetting('defaultVolume', 99); });
        act(() => { result.current.resetSettings(); });
        expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('removes the digideck_settings key from localStorage on reset', () => {
        const { result } = renderHook(() => useSettings());
        act(() => { result.current.updateSetting('defaultVolume', 99); });
        act(() => { result.current.resetSettings(); });
        expect(localStorage.getItem('digideck_settings')).toBeNull();
    });
});

// ─── getDynamicInputWidth ─────────────────────────────────────────────────────

describe('getDynamicInputWidth', () => {
    it('returns minCharCount when text is shorter', () => {
        expect(getDynamicInputWidth('Hi', 14)).toBe('14ch');
    });

    it('returns text length when text exceeds minCharCount', () => {
        expect(getDynamicInputWidth('A very long project name here!', 14)).toBe('30ch');
    });

    it('returns minCharCount for an empty string', () => {
        expect(getDynamicInputWidth('', 14)).toBe('14ch');
    });

    it('returns exact length when text length equals minCharCount', () => {
        expect(getDynamicInputWidth('12345678901234', 14)).toBe('14ch');
    });

    it('handles a single character', () => {
        expect(getDynamicInputWidth('X', 1)).toBe('1ch');
    });
});

// ─── getNextAvailableTrackName ────────────────────────────────────────────────

describe('getNextAvailableTrackName', () => {
    it('returns Track 1 when the track list is empty', () => {
        expect(getNextAvailableTrackName([])).toBe('Track 1');
    });

    it('returns Track 2 when only Track 1 exists', () => {
        expect(getNextAvailableTrackName([{ title: 'Track 1' }])).toBe('Track 2');
    });

    it('fills the first gap — returns Track 2 when Track 1 and Track 3 exist', () => {
        const tracks = [{ title: 'Track 1' }, { title: 'Track 3' }];
        expect(getNextAvailableTrackName(tracks)).toBe('Track 2');
    });

    it('skips all existing sequential numbers and returns the next one', () => {
        const tracks = [
            { title: 'Track 1' },
            { title: 'Track 2' },
            { title: 'Track 3' },
        ];
        expect(getNextAvailableTrackName(tracks)).toBe('Track 4');
    });

    it('ignores non-default track names when finding the next number', () => {
        const tracks = [{ title: 'My Custom Track' }, { title: 'Track 1' }];
        expect(getNextAvailableTrackName(tracks)).toBe('Track 2');
    });
});

// ─── getUniqueTrackName ───────────────────────────────────────────────────────

describe('getUniqueTrackName', () => {
    it('returns the title unchanged when there is no collision', () => {
        expect(getUniqueTrackName('My Track', ['Track 1', 'Track 2'])).toBe('My Track');
    });

    it('appends (1) on the first collision', () => {
        expect(getUniqueTrackName('Track 1', ['Track 1', 'Track 2'])).toBe('Track 1 (1)');
    });

    it('increments the suffix until a unique name is found', () => {
        const existing = ['Track 1', 'Track 1 (1)', 'Track 1 (2)'];
        expect(getUniqueTrackName('Track 1', existing)).toBe('Track 1 (3)');
    });

    it('handles an empty existing titles list', () => {
        expect(getUniqueTrackName('My Song', [])).toBe('My Song');
    });

    it('returns title unchanged when existing list contains different names', () => {
        expect(getUniqueTrackName('Alpha', ['Beta', 'Gamma'])).toBe('Alpha');
    });
});

// ─── readId3Tags ──────────────────────────────────────────────────────────────

describe('readId3Tags', () => {
    it('returns title and artist when metadata contains both', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockResolvedValueOnce({
            common: { title: 'My Song', artist: 'My Artist', picture: [] },
        });

        const result = await readId3Tags(new Blob(['audio'], { type: 'audio/mp3' }));

        expect(result.title).toBe('My Song');
        expect(result.artist).toBe('My Artist');
        expect(result.albumArtBlob).toBeNull();
    });

    it('returns an albumArtBlob when an embedded picture is present', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        const fakeData = new Uint8Array([0xff, 0xd8, 0xff]);
        parseBlob.mockResolvedValueOnce({
            common: {
                title: 'Art Track',
                artist: null,
                picture: [{ data: fakeData, format: 'image/jpeg' }],
            },
        });

        const result = await readId3Tags(new Blob(['audio']));

        expect(result.albumArtBlob).toBeInstanceOf(Blob);
        expect(result.albumArtBlob.type).toBe('image/jpeg');
    });

    it('returns all nulls when parseBlob throws', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockRejectedValueOnce(new Error('corrupt file'));

        const result = await readId3Tags(new Blob(['audio']));

        expect(result).toEqual({ title: null, artist: null, albumArtBlob: null });
    });

    it('returns null title and artist when metadata fields are absent', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockResolvedValueOnce({
            common: { picture: [] },
        });

        const result = await readId3Tags(new Blob(['audio']));

        expect(result.title).toBeNull();
        expect(result.artist).toBeNull();
    });

    it('returns null albumArtBlob when picture array is empty', async () => {
        const { parseBlob } = await import('music-metadata-browser');
        parseBlob.mockResolvedValueOnce({
            common: { title: 'No Art', artist: 'Artist', picture: [] },
        });

        const result = await readId3Tags(new Blob(['audio']));

        expect(result.albumArtBlob).toBeNull();
    });
});

// ─── spotifyConfirmMatch ──────────────────────────────────────────────────────

const makeSpotifyTrack = (name) => ({
    name,
    artists: [{ name: 'Artist' }],
    album: { images: [{ url: 'http://img.example' }] },
});

describe('spotifyConfirmMatch', () => {
    it('returns null when spotifyResults is empty', () => {
        expect(spotifyConfirmMatch('My Song', [])).toBeNull();
    });

    it('returns null when spotifyResults is null', () => {
        expect(spotifyConfirmMatch('My Song', null)).toBeNull();
    });

    it('returns null when id3Title is an empty string', () => {
        expect(spotifyConfirmMatch('', [makeSpotifyTrack('My Song')])).toBeNull();
    });

    it('returns null when id3Title is falsy', () => {
        expect(spotifyConfirmMatch(null, [makeSpotifyTrack('My Song')])).toBeNull();
    });

    it('matches when the Spotify title contains the id3 title (substring)', () => {
        const track = makeSpotifyTrack('My Song (Remastered 2024)');
        expect(spotifyConfirmMatch('My Song', [track])).toBe(track);
    });

    it('matches when the id3 title contains the Spotify title (substring)', () => {
        const track = makeSpotifyTrack('Song');
        expect(spotifyConfirmMatch('My Song Extended Cut', [track])).toBe(track);
    });

    it('matches identical titles exactly', () => {
        const track = makeSpotifyTrack('Bohemian Rhapsody');
        expect(spotifyConfirmMatch('Bohemian Rhapsody', [track])).toBe(track);
    });

    it('returns null when titles are completely dissimilar', () => {
        const track = makeSpotifyTrack('Completely Different Track Here');
        expect(spotifyConfirmMatch('xyz', [track])).toBeNull();
    });

    it('only checks the first result — ignores subsequent matches', () => {
        const wrong = makeSpotifyTrack('Wrong Song');
        const right = makeSpotifyTrack('Right Song');
        // Only the first result is evaluated; 'Right Song' is not checked
        expect(spotifyConfirmMatch('Right Song', [wrong, right])).toBeNull();
    });

    it('normalises punctuation and casing before comparing', () => {
        const track = makeSpotifyTrack("Don't Stop Me Now");
        expect(spotifyConfirmMatch('dont stop me now', [track])).toBe(track);
    });

    it('matches via trigram similarity when titles differ in formatting (>= 0.5)', () => {
        // 'starmanremaster2012' vs 'starman' — 'starman' is contained in the normalised form
        const track = makeSpotifyTrack('Starman (Remaster 2012)');
        expect(spotifyConfirmMatch('Starman', [track])).toBe(track);
    });
});

// ─── useAudioEngine — delegation ──────────────────────────────────────────────

const TRACK_ID = 'track_abc';

describe('useAudioEngine — delegation', () => {
    it('play delegates to AudioEngine.play with trackId', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.play();
        expect(AudioEngine.play).toHaveBeenCalledWith(TRACK_ID);
    });

    it('pause delegates to AudioEngine.pause with trackId', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.pause();
        expect(AudioEngine.pause).toHaveBeenCalledWith(TRACK_ID);
    });

    it('seek delegates to AudioEngine.seek with trackId and time', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.seek(42.5);
        expect(AudioEngine.seek).toHaveBeenCalledWith(TRACK_ID, 42.5);
    });

    it('setVolume delegates to AudioEngine.setVolume with trackId and value', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setVolume(0.75);
        expect(AudioEngine.setVolume).toHaveBeenCalledWith(TRACK_ID, 0.75);
    });

    it('setPitch delegates to AudioEngine.setPitch with trackId and semitones', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setPitch(-3);
        expect(AudioEngine.setPitch).toHaveBeenCalledWith(TRACK_ID, -3);
    });

    it('setSpeed delegates to AudioEngine.setSpeed with trackId and multiplier', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setSpeed(1.5);
        expect(AudioEngine.setSpeed).toHaveBeenCalledWith(TRACK_ID, 1.5);
    });

    it('setEQ delegates to AudioEngine.setEQ with trackId and eq object', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        const eq = { low: -3, mid: 0, high: 2 };
        result.current.setEQ(eq);
        expect(AudioEngine.setEQ).toHaveBeenCalledWith(TRACK_ID, eq);
    });

    it('addEffect delegates to AudioEngine.addEffect and returns the effect id', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        const id = result.current.addEffect('reverb');
        expect(AudioEngine.addEffect).toHaveBeenCalledWith(TRACK_ID, 'reverb');
        expect(id).toBe('effect_1');
    });

    it('removeEffect delegates to AudioEngine.removeEffect with trackId and effectId', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.removeEffect('effect_1');
        expect(AudioEngine.removeEffect).toHaveBeenCalledWith(TRACK_ID, 'effect_1');
    });

    it('setEffectEnabled delegates to AudioEngine.setEffectEnabled', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setEffectEnabled('effect_1', false);
        expect(AudioEngine.setEffectEnabled).toHaveBeenCalledWith(TRACK_ID, 'effect_1', false);
    });

    it('setEffectParam delegates to AudioEngine.setEffectParam', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.setEffectParam('effect_1', 'mix', 0.7);
        expect(AudioEngine.setEffectParam).toHaveBeenCalledWith(TRACK_ID, 'effect_1', 'mix', 0.7);
    });

    it('applyFadeIn delegates to AudioEngine.applyFadeIn with trackId and seconds', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.applyFadeIn(2);
        expect(AudioEngine.applyFadeIn).toHaveBeenCalledWith(TRACK_ID, 2);
    });

    it('applyFadeOut delegates to AudioEngine.applyFadeOut with trackId and seconds', () => {
        const { result } = renderHook(() => useAudioEngine(TRACK_ID));
        result.current.applyFadeOut(3);
        expect(AudioEngine.applyFadeOut).toHaveBeenCalledWith(TRACK_ID, 3);
    });
});

// ─── useAudioEngine — cleanup ─────────────────────────────────────────────────

describe('useAudioEngine — cleanup', () => {
    it('calls AudioEngine.unloadTrack with trackId on unmount', () => {
        const { unmount } = renderHook(() => useAudioEngine(TRACK_ID));
        unmount();
        expect(AudioEngine.unloadTrack).toHaveBeenCalledWith(TRACK_ID);
    });

    it('does not call unloadTrack before unmount', () => {
        renderHook(() => useAudioEngine(TRACK_ID));
        expect(AudioEngine.unloadTrack).not.toHaveBeenCalled();
    });

    it('calls unloadTrack with new trackId when trackId changes', () => {
        const { rerender, unmount } = renderHook(({ id }) => useAudioEngine(id), {
            initialProps: { id: 'track_a' },
        });
        // When trackId changes the old cleanup fires, then re-mounts with new id
        rerender({ id: 'track_b' });
        expect(AudioEngine.unloadTrack).toHaveBeenCalledWith('track_a');
        unmount();
        expect(AudioEngine.unloadTrack).toHaveBeenCalledWith('track_b');
    });
});
