import React, { useState, useEffect, useRef } from 'react';
import { X, User, Camera, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { useFirebaseAuth, friendlyError } from '../firebase/firebase';
import { useSettings, formatKeybind } from '../utils/useSettings';
import { useSpotifyConnect } from '../spotify/appContext';

// ─── AccountModal ─────────────────────────────────────────────────────────────

export function AccountModal({ isOpen, onClose }) {
  const { user, updateDisplayName, updateProfilePhoto, removeProfilePhoto, updateUserEmail } = useFirebaseAuth();
  const { isSpotifyConnected, connectSpotify, disconnectSpotify } = useSpotifyConnect();
  const { settings } = useSettings();
  const animClass = settings.animationsEnabled ? 'animate-in fade-in zoom-in-95 duration-200' : '';

  const isGoogleUser = user?.providerData?.[0]?.providerId === 'google.com';

  // Photo
  const photoInputRef = useRef(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');

  // Display name
  const [displayName, setDisplayName] = useState('');
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameSuccess, setDisplayNameSuccess] = useState(false);
  const [displayNameError, setDisplayNameError] = useState('');

  // Email
  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState('');

  // Account details
  const [accountDetails, setAccountDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    setDisplayName(user.displayName || '');
    setNewEmail(user.email || '');
    setEmailSuccess(false); setEmailError('');
    setDisplayNameSuccess(false); setDisplayNameError('');
    setPhotoError('');

    setDetailsLoading(true);
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      setAccountDetails(snap.exists() ? snap.data() : null);
    }).catch(() => setAccountDetails(null)).finally(() => setDetailsLoading(false));
  }, [isOpen, user]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError('');
    try {
      await updateProfilePhoto(file);
    } catch (err) {
      setPhotoError(friendlyError(err));
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoUploading(true);
    setPhotoError('');
    try {
      await removeProfilePhoto();
    } catch (err) {
      setPhotoError(friendlyError(err));
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSaveDisplayName = async () => {
    if (!displayName.trim()) { setDisplayNameError('Name cannot be empty.'); return; }
    setDisplayNameSaving(true);
    setDisplayNameError('');
    try {
      await updateDisplayName(displayName.trim());
      setDisplayNameSuccess(true);
      setTimeout(() => setDisplayNameSuccess(false), 2500);
    } catch (err) {
      setDisplayNameError(friendlyError(err));
    } finally {
      setDisplayNameSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!newEmail.trim()) { setEmailError('Email cannot be empty.'); return; }
    setEmailSaving(true);
    setEmailError('');
    try {
      await updateUserEmail(newEmail.trim());
      setEmailSuccess(true);
      setTimeout(() => setEmailSuccess(false), 2500);
    } catch (err) {
      setEmailError(friendlyError(err));
    } finally {
      setEmailSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-base-900 border border-base-700 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col overflow-hidden h-[85vh] ${animClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-800 shrink-0">
          <h2 className="text-base font-semibold text-base-50">Account Info</h2>
          <button onClick={onClose} className="text-base-500 hover:text-base-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-6">

          {/* Profile Photo */}
          <div className="flex flex-col items-center gap-3 border-b border-base-800 pb-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-base-700 border-2 border-base-600 flex items-center justify-center">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <User size={32} className="text-base-400" />
                )}
                {photoUploading && (
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                    <Loader size={20} className="text-white animate-spin" />
                  </div>
                )}
              </div>
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
                className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-base-600 hover:bg-base-500 border border-base-500 flex items-center justify-center transition-colors disabled:opacity-50"
                title="Upload photo"
              >
                <Camera size={13} className="text-base-200" />
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>
            {user?.photoURL && (
              <button
                onClick={handleRemovePhoto}
                disabled={photoUploading}
                className="text-xs text-base-500 hover:text-base-300 transition-colors disabled:opacity-50"
              >
                Remove photo
              </button>
            )}
            {photoError && <p className="text-xs text-red-400">{photoError}</p>}
          </div>

          {/* Display Name */}
          <div className="border-b border-base-800 pb-6">
            <label className="block text-xs font-medium text-base-400 mb-2">Display Name</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="flex-1 bg-base-800 border border-base-700 rounded-lg px-3 py-2 text-sm text-base-100 outline-none focus:border-base-500 transition-colors"
              />
              <button
                onClick={handleSaveDisplayName}
                disabled={displayNameSaving}
                className="px-4 py-2 text-sm font-medium bg-base-700 hover:bg-base-600 text-base-100 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {displayNameSaving ? <Loader size={13} className="animate-spin" /> : null}
                Save
              </button>
            </div>
            {displayNameSuccess && (
              <p className="flex items-center gap-1.5 mt-2 text-xs text-green-400">
                <CheckCircle size={13} /> Name updated.
              </p>
            )}
            {displayNameError && (
              <p className="flex items-center gap-1.5 mt-2 text-xs text-red-400">
                <AlertCircle size={13} /> {displayNameError}
              </p>
            )}
          </div>

          {/* Email */}
          <div className="border-b border-base-800 pb-6">
            <label className="block text-xs font-medium text-base-400 mb-2">Email</label>
            {isGoogleUser ? (
              <div className="flex items-center gap-3">
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="flex-1 bg-base-800 border border-base-700 rounded-lg px-3 py-2 text-sm text-base-400 outline-none opacity-60 cursor-not-allowed"
                />
                <span className="text-xs text-base-500 bg-base-800 border border-base-700 px-2 py-1 rounded-md whitespace-nowrap">Managed by Google</span>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    autoComplete="email"
                    className="flex-1 bg-base-800 border border-base-700 rounded-lg px-3 py-2 text-sm text-base-50 outline-none focus:border-base-500 transition-colors"
                  />
                  <button
                    onClick={handleSaveEmail}
                    disabled={emailSaving}
                    className="px-4 py-2 text-sm font-medium bg-base-700 hover:bg-base-600 text-base-100 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {emailSaving ? <Loader size={13} className="animate-spin" /> : null}
                    Save
                  </button>
                </div>
                {emailSuccess && (
                  <p className="flex items-center gap-1.5 mt-2 text-xs text-green-400">
                    <CheckCircle size={13} /> Email updated.
                  </p>
                )}
                {emailError && (
                  <p className="flex items-center gap-1.5 mt-2 text-xs text-red-400">
                    <AlertCircle size={13} /> {emailError}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Account Details */}
          <div className="pb-2">
            <label className="block text-xs font-medium text-base-400 mb-3">Account Details</label>
            {detailsLoading ? (
              <Loader size={16} className="animate-spin text-base-500" />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-base-400">Sign-in method</span>
                  <span className="text-base-200">{isGoogleUser ? 'Google' : 'Email / Password'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-base-400">Account created</span>
                  <span className="text-base-200">
                    {(accountDetails?.createdAt?.toDate?.() ?? (user?.metadata?.creationTime ? new Date(user.metadata.creationTime) : null))
                      ?.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-base-400">Spotify</span>
                  <div className="flex items-center gap-2">
                    <span className={isSpotifyConnected ? 'text-green-400' : 'text-base-500'}>
                      {isSpotifyConnected ? 'Connected' : 'Not connected'}
                    </span>
                    <button
                      onClick={isSpotifyConnected ? disconnectSpotify : connectSpotify}
                      className="text-xs px-2 py-0.5 rounded bg-base-800 border border-base-700 text-base-300 hover:text-base-100 hover:bg-base-700 transition-colors"
                    >
                      {isSpotifyConnected ? 'Disconnect' : 'Connect'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SettingsModal ────────────────────────────────────────────────────────────

const ACTIONS = [
  { key: 'splitAtPlayhead', label: 'Split track at playhead' },
  { key: 'playPause',       label: 'Play / Pause' },
];

export function SettingsModal({ isOpen, onClose }) {
  const { settings, updateSetting } = useSettings();
  const animClass = settings.animationsEnabled ? 'animate-in fade-in zoom-in-95 duration-200' : '';
  const [activeTab, setActiveTab] = useState('general');
  const [recordingAction, setRecordingAction] = useState(null);
  const [keybindConflictError, setKeybindConflictError] = useState('');

  // Keybind recording keydown handler
  useEffect(() => {
    if (recordingAction === null) return;
    const handleKeydown = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { setRecordingAction(null); return; }
      // Reject modifier-only presses
      if (['Control', 'Shift', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;

      const newBinding = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
      // Check conflicts
      const conflict = ACTIONS.find(a => {
        if (a.key === recordingAction) return false;
        const b = settings.keybinds[a.key];
        return b &&
          b.key.toLowerCase() === newBinding.key.toLowerCase() &&
          !!b.ctrl === !!newBinding.ctrl &&
          !!b.shift === !!newBinding.shift &&
          !!b.alt === !!newBinding.alt;
      });
      if (conflict) {
        setKeybindConflictError(`Already used by "${conflict.label}"`);
        setTimeout(() => setKeybindConflictError(''), 2500);
        return;
      }
      updateSetting('keybinds', { ...settings.keybinds, [recordingAction]: newBinding });
      setRecordingAction(null);
      setKeybindConflictError('');
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [recordingAction, settings.keybinds, updateSetting]);

  if (!isOpen) return null;

  const TABS = [
    { id: 'general',  label: 'General' },
    { id: 'controls', label: 'Controls' },
    { id: 'about',    label: 'About' },
  ];

  const Toggle = ({ value, onChange }) => (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${value ? 'bg-base-450' : 'bg-base-700'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-base-900 border border-base-700 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col overflow-hidden h-[85vh] ${animClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-800 shrink-0">
          <h2 className="text-base font-semibold text-base-50">Settings</h2>
          <button onClick={onClose} className="text-base-500 hover:text-base-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-base-800 shrink-0 px-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-base-50 border-base-450'
                  : 'text-base-500 border-transparent hover:text-base-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">

          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="flex flex-col gap-1">
              {[
                { label: 'Confirm before deleting tracks', key: 'confirmBeforeDelete' },
                { label: 'Enable animations', key: 'animationsEnabled' },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center justify-between py-3 border-b border-base-800">
                  <span className="text-sm text-base-200">{label}</span>
                  <Toggle value={settings[key]} onChange={(v) => updateSetting(key, v)} />
                </div>
              ))}
            </div>
          )}

          {/* Controls Tab */}
          {activeTab === 'controls' && (
            <div className="flex flex-col">
              {ACTIONS.map(action => {
                const binding = settings.keybinds?.[action.key];
                const isRecording = recordingAction === action.key;
                return (
                  <div key={action.key} className="flex items-center justify-between py-2.5 border-b border-base-800">
                    <span className="text-sm text-base-300">{action.label}</span>
                    {isRecording ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-base-400 italic animate-pulse">Press any key...</span>
                        <button
                          onClick={() => { setRecordingAction(null); setKeybindConflictError(''); }}
                          className="text-xs text-base-500 hover:text-base-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {binding && (
                          <div className="flex items-center gap-1">
                            {formatKeybind(binding).split(' + ').map((part, i) => (
                              <kbd key={i} className="text-xs bg-base-800 border border-base-700 text-base-300 px-1.5 py-0.5 rounded font-mono">
                                {part}
                              </kbd>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => { setRecordingAction(action.key); setKeybindConflictError(''); }}
                          className="text-xs text-base-500 hover:text-base-200 transition-colors px-2 py-0.5 rounded hover:bg-base-800"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {keybindConflictError && (
                <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle size={12} /> {keybindConflictError}
                </p>
              )}
            </div>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <img src="/icon.png" alt="DigiDeck Logo" className="w-10 h-10 object-contain drop-shadow-md" />
              <div>
                <p className="text-base font-bold text-base-50">DigiDeck Studio</p>
                <p className="text-xs text-base-500 mt-0.5">Version 0.1.0</p>
              </div>
              <p className="text-sm text-base-400 max-w-xs">
                A browser-based audio mixing studio for DJs and music producers.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
