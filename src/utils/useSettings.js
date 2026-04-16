import { useState, useCallback } from 'react';

export const DEFAULT_SETTINGS = {
  animationsEnabled: true,
  defaultVolume: 80,
  defaultZoom: 0,
  defaultFadeIn: 0,
  defaultFadeOut: 0,
  keybinds: {
    splitAtPlayhead: { key: 'x', ctrl: false, shift: false, alt: false },
    saveProject:     { key: 's', ctrl: true,  shift: false, alt: false },
    loadProject:     { key: 'o', ctrl: true,  shift: false, alt: false },
    exportProject:   { key: 'e', ctrl: true,  shift: false, alt: false },
    playPause:       { key: ' ', ctrl: false, shift: false, alt: false },
    undo:            { key: 'z', ctrl: true,  shift: false, alt: false },
    redo:            { key: 'y', ctrl: true,  shift: false, alt: false },
    copySegment:     { key: 'c', ctrl: true,  shift: false, alt: false },
    pasteSegment:    { key: 'v', ctrl: true,  shift: false, alt: false },
    deleteSegment:   { key: 'Delete', ctrl: false, shift: false, alt: false },
    magnetToggle:    { key: 'm',      ctrl: false, shift: false, alt: false },
  },
};

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem('digideck_settings');
      if (!stored) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        keybinds: { ...DEFAULT_SETTINGS.keybinds, ...(parsed.keybinds ?? {}) },
      };
    } catch { return DEFAULT_SETTINGS; }
  });

  const updateSetting = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem('digideck_settings', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    try { localStorage.removeItem('digideck_settings'); } catch {}
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, updateSetting, resetSettings, DEFAULT_SETTINGS };
}

export function matchesKeybind(e, binding) {
  if (!binding) return false;
  return (
    e.key.toLowerCase() === binding.key.toLowerCase() &&
    !!e.ctrlKey === !!binding.ctrl &&
    !!e.shiftKey === !!binding.shift &&
    !!e.altKey === !!binding.alt
  );
}

export function formatKeybind(binding) {
  if (!binding) return '';
  const parts = [];
  if (binding.ctrl)  parts.push('Ctrl');
  if (binding.alt)   parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key === ' ' ? 'Space' : binding.key.toUpperCase());
  return parts.join(' + ');
}
