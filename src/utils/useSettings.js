import { useState, useCallback } from 'react';

export const DEFAULT_SETTINGS = {
  confirmBeforeDelete: true,
  animationsEnabled: true,
  defaultVolume: 80,
  defaultZoom: 0,
  defaultFadeIn: 0,
  defaultFadeOut: 0,
  keybinds: {
    splitAtPlayhead: { key: 'x', ctrl: false, shift: false, alt: false },
    saveProject:     { key: 's', ctrl: true, shift: false, alt: false },
    playPause:       { key: ' ', ctrl: false, shift: false, alt: false },
  },
};

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem('digideck_settings');
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
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
