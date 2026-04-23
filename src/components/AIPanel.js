import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronRight, Sparkles, Send, History, Plus, Trash2, X, Bot, AlertTriangle } from 'lucide-react';
import { Avatar, ScrollShadow } from '@heroui/react';
import { useMix } from '../spotify/appContext';
import { useFirebaseAuth } from '../firebase/firebase';
import { buildEffectsCapabilities } from '../utils/trackConfig';
import { useSettings, formatKeybind } from '../utils/useSettings';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';

// --- Camelot Wheel ------------------------------------------------------------

const CAMELOT = {
    'C major': '8B',  'A minor': '8A',
    'G major': '9B',  'E minor': '9A',
    'D major': '10B', 'B minor': '10A',
    'A major': '11B', 'F# minor': '11A',
    'E major': '12B', 'Db minor': '12A',
    'B major': '1B',  'Ab minor': '1A',
    'F# major': '2B', 'Eb minor': '2A',
    'Db major': '3B', 'Bb minor': '3A',
    'Ab major': '4B', 'F minor': '4A',
    'Eb major': '5B', 'C minor': '5A',
    'Bb major': '6B', 'G minor': '6A',
    'F major': '7B',  'D minor': '7A',
};

const getCamelotPosition = (key) => (key ? CAMELOT[key] ?? null : null);

// --- System Prompt Builder ----------------------------------------------------

const APP_CAPABILITIES = `
DigiDeck  - browser-based music mashup and mixing studio. Controls and exact constraints (per segment unless noted):

TRACK SOURCES:
- Local file uploads: full-length audio files uploaded by the user via the Library panel.
- You cannot add tracks to the mix directly  - always direct the user to upload their own audio files via the Library panel.
- When recommending tracks, give specific song and artist names. The user must source and upload the files themselves.

IMPORTANT READ-ONLY values (cannot be changed by the user):
- BPM: measured from the audio  - DISPLAY ONLY, not editable. To match tempos, use Speed.
- Key: detected from the audio  - DISPLAY ONLY.

Speed (tempo multiplier)  - continuous slider:
  Range: 0.25x to 2.00x, any value to 2 decimal places (e.g. 0.91x is valid).
  To match a target BPM: divide target BPM by current BPM, then clamp to 0.25-2.00.

Pitch  - discrete semitone steps (±1 per click):
  Range: any integer, but quality degrades beyond ±3 semitones (SoundTouch artifact limit).
  Recommend staying within ±3 st. Always express as whole numbers.

EQ (three bands, each independent):
  Low shelf (200 Hz): –12 to +12 dB, step 0.5 dB
  Mid peaking (1 kHz): –12 to +12 dB, step 0.5 dB
  High shelf (8 kHz): –12 to +12 dB, step 0.5 dB
  Kill switch: sets the band to -40 dB (effectively silent). Advise using kill for full cuts.

Fade In / Fade Out: any positive number of seconds (free entry). Applied at segment boundaries.

Master Volume (per track): 0-100 (percentage slider). Default 80.

Effects chain  - per segment, stackable, each independently enable/disable-able:
${buildEffectsCapabilities()}

Segments: each track can be cut at the playhead (Ctrl+S) into multiple regions.
  Each segment has independent pitch, speed, EQ, fades, and effects chain.
  Segments are shown as coloured regions on the waveform.

Context limits you should know:
  - Only the last 20 messages of this chat are visible to you per request.
  - There is a maximum of 5 chats. Advise the user to start a new chat if this one grows long.
  - Keep responses under ~200 words unless a detailed technical breakdown is explicitly needed.`.trim();

function buildSegmentLines(segs) {
    if (!segs || segs.length === 0) return '';
    return segs.map((seg, i) => {
        const rangeLabel = segs.length > 1
            ? ` (${(seg.startPct * 100).toFixed(0)}%–${(seg.endPct * 100).toFixed(0)}%)`
            : '';
        const pitch  = `${seg.pitch >= 0 ? '+' : ''}${seg.pitch} st`;
        const speed  = `${seg.speed}x`;
        const fadeIn  = seg.fadeIn  > 0 ? `${seg.fadeIn}s`  : 'off';
        const fadeOut = seg.fadeOut > 0 ? `${seg.fadeOut}s` : 'off';
        const eq = `Low ${seg.eqLow >= 0 ? '+' : ''}${seg.eqLow}dB | Mid ${seg.eqMid >= 0 ? '+' : ''}${seg.eqMid}dB | High ${seg.eqHigh >= 0 ? '+' : ''}${seg.eqHigh}dB`;

        const activeEffects = (seg.effects ?? []).filter(e => e.enabled);
        const disabledEffects = (seg.effects ?? []).filter(e => !e.enabled);
        const fxStr = activeEffects.length > 0
            ? activeEffects.map(e => {
                const p = Object.entries(e.params)
                    .map(([k, v]) => `${k}=${typeof v === 'number' ? parseFloat(v.toFixed(3)) : v}`)
                    .join(', ');
                return `${e.type}(${p})`;
            }).join(', ')
            : 'none';
        const disabledStr = disabledEffects.length > 0
            ? ` | disabled: ${disabledEffects.map(e => e.type).join(', ')}`
            : '';

        return `    Segment ${i + 1}${rangeLabel}: pitch ${pitch} | speed ${speed} | fadeIn ${fadeIn} | fadeOut ${fadeOut}
      EQ: ${eq}
      Effects: ${fxStr}${disabledStr}`;
    }).join('\n');
}

function buildSystemPrompt(tracks, settings) {
    const filledTracks = tracks.filter(t => t.audioUrl || t.spotifyId);
    const expLevel = settings?.experienceLevel || 'intermediate';

    const kb = settings?.keybinds || {};
    const keybindsText = `
Configured Keyboard Shortcuts:
- Play/Pause: ${formatKeybind(kb.playPause)}
- Split track at playhead: ${formatKeybind(kb.splitAtPlayhead)}
- Delete segment: ${formatKeybind(kb.deleteSegment)}
- Copy segment: ${formatKeybind(kb.copySegment)}
- Paste segment: ${formatKeybind(kb.pasteSegment)}
- Undo: ${formatKeybind(kb.undo)}
- Redo: ${formatKeybind(kb.redo)}
- Save Project: ${formatKeybind(kb.saveProject)}
- Load Project: ${formatKeybind(kb.loadProject)}
- Export Project: ${formatKeybind(kb.exportProject)}`.trim();

    const EXPERIENCE_RULES = {
        beginner: `
[Experience Level: Absolute Beginner]
- Vocabulary: Avoid all jargon. Explain "BPM" as "speed/tempo", "EQ" as "frequency/tone adjustments", and "Pitch" as "musical key adjustment".
- Navigation: Provide explicit, step-by-step instructions for every action. Example: "To change the speed, use the 'Speed' slider on the track card, or type a number in the Master BPM box at the top of your screen." or "To split a track, click on the track waveform to place the playhead, then press your configured split shortcut."
- Guidance: Be highly prescriptive. Offer exactly one or two simple suggestions at a time. Guide them to basic features like the Volume slider or Fade In/Out inputs before introducing effects.
- Tone: Encouraging, patient, and highly educational.`,
        
        novice: `
[Experience Level: Novice]
- Vocabulary: Can use basic terms like BPM and EQ, but should briefly clarify them if used in a complex context.
- Navigation: Point out where tools are generally located. Example: "You can add a filter by clicking the 'Add Effect' dropdown on the track card and selecting 'Pass Filter'."
- Guidance: Suggest simple combinations of actions (e.g., clicking 'Sync' on a track to match the Master BPM, and adjusting the 'Speed' slider). Introduce them gently to slightly more advanced concepts like harmonic mixing.
- Tone: Helpful, guiding, and structured.`,
        
        intermediate: `
[Experience Level: Intermediate]
- Vocabulary: Use standard industry terminology freely (Camelot wheel, High/Low pass filters, Decibels).
- Navigation: Only explain UI navigation when suggesting a feature they likely haven't used yet (e.g., "You can 'Extract' a segment to move it to a new track while preserving its effects"). Do not explain how to change Speed or Volume unless asked.
- Guidance: Focus on creative suggestions—compatible tracks, transition ideas, and using the Low/Mid/High EQ ranges (in dB) effectively.
- Tone: Collaborative, concise, and professional.`,
        
        proficient: `
[Experience Level: Proficient]
- Vocabulary: Technical and specific. Can discuss harmonic relationships (semitone pitch adjustments) and specific Pass Filter parameters.
- Navigation: Use shorthand and reference keyboard shortcuts heavily. Example: "Use your configured save shortcut" or "Apply a Low Pass Filter via the Add Effect menu." Do not explain where menus are unless deeply hidden.
- Guidance: Provide specific, nuanced mixing advice. Assume they can execute the advice perfectly. Focus on workflow efficiency and creative ideas.
- Tone: Direct, efficient, and peer-to-peer.`,
        
        advanced: `
[Experience Level: Advanced]
- Vocabulary: Unrestricted technical terminology regarding mixing, frequency ranges, and track structuring.
- Navigation: ZERO UI explanations. Never tell them where a button is or how to use a basic feature unless they explicitly ask "Where is X in this app?".
- Guidance: Strictly answer the prompt with minimal fluff. If they ask for track compatibility, provide just the data (BPM, Key matches). Provide high-level structural advice.
- Tone: Ultra-concise, analytical, and purely functional.`
    };

    const levelRules = EXPERIENCE_RULES[expLevel] || EXPERIENCE_RULES.intermediate;

    let trackState = `The mix is currently empty. Help the user choose starting tracks based on genre or mood preferences.`;
    if (filledTracks.length > 0) {
        trackState = `Current mix - BPM and key values are measured from the actual audio; EQ, pitch, speed, fades, and effects are the user's current settings:\n` + filledTracks.map((t, i) => {
            const bpm     = t.bpm     != null ? t.bpm : '(analysing…)';
            const key     = t.trackKey || '(analysing…)';
            const camelot = getCamelotPosition(t.trackKey);
            const segLines = buildSegmentLines(t.initialSegments);
            const source = t.isLocal ? 'uploaded file' : 'Spotify preview';
            const energy = t.energy != null ? ` | Energy: ${t.energy}` : '';
            return `  Track ${i + 1}: "${t.title}"${t.artistName ? `  - ${t.artistName}` : ''} [${source}]\n    BPM: ${bpm} | Key: ${key}${camelot ? ` (Camelot: ${camelot})` : ''}${energy}\n${segLines || '    Segment 1: all settings at default (pitch 0, speed 1x, no EQ, no effects)'}`;
        }).join('\n\n');
    }

    return `You are a DJ assistant and mixing engineer for DigiDeck, a browser-based music mashup studio.

${APP_CAPABILITIES}

${keybindsText}

${trackState}

GLOBAL INSTRUCTIONS:
- You know the full state of each track and every available control - never ask the user what effects or controls are available.
- Give specific, actionable advice using exact control names and values that exist within the stated ranges and presets.
- Regardless of the user's experience level, always allow and encourage general requests. If the user asks for song recommendations, provide an unrestricted list of ideas (do not limit song options), but ensure all constraints are logically met. This includes user constraints (genre, language, mood) and critical technical constraints (BPM closeness, key harmony relative to existing workspace tracks or the Master BPM).
- CRITICALLY IMPORTANT: Never invent app features. If a user asks how to do something unsupported (e.g., "How do I move my segments freely along the timeline?"), explicitly state that the feature is not currently available, and offer a real alternative (e.g., "You cannot move segments freely, but you can swap their order using the left/right arrows within the segment").
- Keyboard Shortcuts: Do not reference shortcuts by hardcoded keys (e.g., do not say "Press Ctrl+S"). Always reference the shortcut by checking the user's configured keyboard shortcuts provided in this context.
- BPM is read-only (Key is also read-only). For speed: any value between 0.25 and 2.00 is valid; calculate target BPM / current BPM and clamp to that range.
- The bias disclosure shown in the UI applies to your training data on specific tracks - it does not mean you should refuse to recommend. Recommend confidently with appropriate caveats.

${levelRules}`;
}

// --- Helpers -----------------------------------------------------------------

const welcomeText = (count) => count > 0
    ? `I can see your mix has **${count} track${count > 1 ? 's' : ''}**.\n\nAsk me for compatible suggestions, or tell me the vibe you're going for.`
    : `**No tracks yet** - tell me what you're working on and I'll suggest some starting points.`;

const makeNewChat = (filledCount, experienceLevel) => {
    const isFirstTime = !experienceLevel;
    return {
        id: Date.now(),
        title: 'New Chat',
        messages: isFirstTime
            ? [{ role: 'assistant', content: '**To help me tailor my suggestions**, what is your experience level with DJ mixing and audio applications?', isOnboarding: true }]
            : [{ role: 'assistant', content: welcomeText(filledCount), isWelcome: true }],
        createdAt: Date.now(),
    };
};



// --- Constants ----------------------------------------------------------------

const MIN_WIDTH    = 288;
const MAX_WIDTH    = 560;
const MAX_CHATS    = 5;
const CONTEXT_LIMIT = 20; // messages at which the API starts dropping early history

// --- MarkdownMessage ----------------------------------------------------------

function MarkdownMessage({ content, isUser }) {
    const lines = (content ?? '').split('\n');
    const out = [];
    let listItems = [];
    let listType = null;

    const textColor = isUser ? 'text-base-100' : 'text-base-200';
    const mutedColor = isUser ? 'text-base-200' : 'text-base-300';
    const boldColor = isUser ? 'text-white' : 'text-base-100';

    const flush = () => {
        if (!listItems.length) return;
        const Tag = listType === 'ol' ? 'ol' : 'ul';
        const cls = listType === 'ol'
            ? `list-decimal list-inside space-y-0.5 my-1 pl-1 ${mutedColor}`
            : `list-disc list-inside space-y-0.5 my-1 pl-1 ${mutedColor}`;
        out.push(<Tag key={'list-' + out.length} className={cls}>{listItems}</Tag>);
        listItems = []; listType = null;
    };

    const inline = (text, k) => {
        const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
        return <span key={k}>{parts.map((p, i) => {
            if (p.startsWith('**') && p.endsWith('**'))
                return <strong key={i} className={`font-semibold ${boldColor}`}>{p.slice(2, -2)}</strong>;
            if (p.startsWith('*') && p.endsWith('*'))
                return <em key={i} className={`italic ${mutedColor}`}>{p.slice(1, -1)}</em>;
            if (p.startsWith('`') && p.endsWith('`'))
                return <code key={i} className={`bg-base-700 rounded px-1 text-xs font-mono ${textColor}`}>{p.slice(1, -1)}</code>;
            return p;
        })}</span>;
    };

    lines.forEach((line, i) => {
        const ul = line.match(/^[-*]\s+(.*)/);
        const ol = line.match(/^\d+\.\s+(.*)/);
        const h2 = line.match(/^##\s+(.*)/);
        const h3 = line.match(/^###\s+(.*)/);

        if (ul) {
            if (listType === 'ol') flush();
            listType = 'ul';
            listItems.push(<li key={i} className={mutedColor}>{inline(ul[1], i)}</li>);
        } else if (ol) {
            if (listType === 'ul') flush();
            listType = 'ol';
            listItems.push(<li key={i} className={mutedColor}>{inline(ol[1], i)}</li>);
        } else {
            flush();
            if (h2) {
                out.push(<p key={i} className={`font-bold ${boldColor} mt-2 mb-0.5 text-sm`}>{inline(h2[1], i)}</p>);
            } else if (h3) {
                out.push(<p key={i} className={`font-semibold ${textColor} mt-1.5 mb-0.5 text-sm`}>{inline(h3[1], i)}</p>);
            } else if (line.trim() === '') {
                out.push(<div key={i} className="h-1.5" />);
            } else {
                out.push(<p key={i} className={textColor}>{inline(line, i)}</p>);
            }
        }
    });
    flush();
    return <div className="space-y-0.5 text-sm leading-relaxed">{out}</div>;
}

// --- AIPanel -----------------------------------------------------------------

export default function AIPanel({ isCollapsed, setIsCollapsed }) {
    const { tracks, getLiveTracks, chats, setChats, activeChatId, setActiveChatId } = useMix();
    const { user } = useFirebaseAuth();
    const { settings, updateSetting } = useSettings();
    const displayName = user?.displayName || user?.email || 'User';
    const avatarSrc   = user?.photoURL || null;
    const [panelWidth, setPanelWidth]   = useState(MIN_WIDTH);
    const [input, setInput]             = useState('');
    const [loading, setLoading]         = useState(false);
    const [showModal, setShowModal]     = useState(false);
    const [dismissedDisclosures, setDismissedDisclosures] = useState(() => new Set());
    const bottomRef = useRef(null);
    const inputRef  = useRef(null);

    const filledCount = tracks.filter(t => t.audioUrl || t.spotifyId).length;



    // On mount: ensure there's always at least one chat and a valid active id
    useEffect(() => {
        setChats(prev => {
            if (prev.length === 0) {
                const first = makeNewChat(filledCount, settings.experienceLevel);
                setActiveChatId(first.id);
                return [first];
            }
            setActiveChatId(id => {
                if (id != null && prev.find(c => c.id === id)) return id;
                return prev[prev.length - 1].id;
            });
            return prev;
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Derived --------------------------------------------------------------

    const activeChat = chats.find(c => c.id === activeChatId) ?? null;
    const messages   = useMemo(() => activeChat?.messages ?? [], [activeChat]);

    // Welcome message is always derived from live filledCount at render time;
    // messages[0] (the initial assistant bubble) content is overridden below in JSX.

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // --- Chat management ------------------------------------------------------

    const createNewChat = () => {
        if (chats.length >= MAX_CHATS) return;
        const newChat = makeNewChat(filledCount, settings.experienceLevel);
        setChats(prev => [...prev, newChat]);
        setActiveChatId(newChat.id);
        setShowModal(false);
    };

    const switchToChat = (chatId) => {
        setActiveChatId(chatId);
        setShowModal(false);
    };

    const deleteChat = (chatId, e) => {
        e.stopPropagation();
        setChats(prev => {
            const updated = prev.filter(c => c.id !== chatId);
            if (chatId === activeChatId) {
                const fallback = updated[updated.length - 1] ?? null;
                setActiveChatId(fallback?.id ?? null);
            }
            return updated;
        });
    };

    const allChatsAtLimit = chats.length >= MAX_CHATS && chats.every(c => c.messages.length >= CONTEXT_LIMIT);
    const canCreateChat   = chats.length < MAX_CHATS;

    // --- Send message ---------------------------------------------------------

    const handleExperienceSelect = async (level) => {
        updateSetting('experienceLevel', level);
        if (user?.uid) {
            try { await updateDoc(doc(db, 'users', user.uid), { experienceLevel: level }); }
            catch (err) { console.error('Error saving experience level:', err); }
        }

        const labels = {
            beginner: "Absolute Beginner",
            novice: "Novice",
            intermediate: "Intermediate",
            proficient: "Proficient",
            advanced: "Advanced"
        };
        const userMsg = { role: 'user', content: labels[level] };
        const ackMsg = { role: 'assistant', content: '**Your experience has been taken into consideration** and responses are now tailored with that in mind!\n\n*To change this, please update within profile settings.*' };
        const welcomeMsg = { role: 'assistant', content: welcomeText(filledCount), isWelcome: true };

        setChats(prev => prev.map(c => {
            if (c.id !== activeChatId) return c;
            // remove the onboarding flag so it doesn't render buttons anymore
            const strippedMessages = c.messages.map(m => m.isOnboarding ? { ...m, isOnboarding: false } : m);
            return {
                ...c,
                messages: [...strippedMessages, userMsg, ackMsg, welcomeMsg],
                title: 'New Chat'
            };
        }));
    };

    const handleSendWithText = async (text) => {
        if (!text || loading || !activeChatId) return;
        const userMsg = { role: 'user', content: text };
        const currentMessages = activeChat?.messages ?? [];
        const updated = [...currentMessages, userMsg];

        // Update messages + auto-title on first user message
        setChats(prev => prev.map(c => {
            if (c.id !== activeChatId) return c;
            const isFirstUserMsg = !c.messages.some(m => m.role === 'user');
            return {
                ...c,
                messages: updated,
                title: isFirstUserMsg
                    ? userMsg.content.slice(0, 30) + (userMsg.content.length > 30 ? '…' : '')
                    : c.title,
            };
        }));
        setInput('');
        setLoading(true);

        try {
            // Strip any leading assistant messages  - Anthropic requires user-first
            const firstUserIdx = updated.findIndex(m => m.role === 'user');
            const apiMessages = firstUserIdx >= 0 ? updated.slice(firstUserIdx) : updated;

            const apiBase = process.env.REACT_APP_API_URL || '';
            const res = await fetch(`${apiBase}/api/aiChat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: apiMessages.slice(-20),
                    systemPrompt: buildSystemPrompt(getLiveTracks(), settings),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            let replyText = data.content;

            // Block actionable JSON-like objects to enforce safety
            const actionRegex = /\{[\s\S]*"?(speed|pitch|eqLow|action|tool_use|update|command)"?\s*:/i;
            if (actionRegex.test(replyText) || /\{[^{}]*\}/.test(replyText)) {
                replyText = "Blocked actionable command from AI. The system has prevented structural command execution.";
            }

            const finalMessages = [...updated, { role: 'assistant', content: replyText, capturedAt: Date.now() }];
            setChats(prev => prev.map(c =>
                c.id === activeChatId ? { ...c, messages: finalMessages } : c
            ));
        } catch (err) {
            console.error('AI chat error:', err);
            const errMessages = [...updated, { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` }];
            setChats(prev => prev.map(c =>
                c.id === activeChatId ? { ...c, messages: errMessages } : c
            ));
        } finally {
            setLoading(false);
        }
    };

    const handleSend = () => handleSendWithText(input.trim());

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };



    // --- Resize handle --------------------------------------------------------

    const handleResizeStart = (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = panelWidth;
        const onMove = (ev) => setPanelWidth(
            Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)))
        );
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    // --- Collapsed view -------------------------------------------------------

    if (isCollapsed) {
        return (
            <aside className="w-16 bg-base-900 border-l border-base-700 flex flex-col shrink-0">
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button
                        onClick={() => setIsCollapsed(false)}
                        title="Expand AI Panel"
                        className="p-1.5 rounded hover:bg-base-800 transition-colors"
                    >
                        <Sparkles className="text-base-700 hover:text-base-200 transition-colors" size={24} />
                    </button>
                </div>
            </aside>
        );
    }

    // --- Render ---------------------------------------------------------------

    return (
        <>
            {/* -- Chat history modal -- */}
            {showModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                    onClick={() => setShowModal(false)}
                >
                    <div
                        className="bg-base-900 border border-base-700 rounded-2xl w-96 max-h-[70vh] flex flex-col shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-base-700 shrink-0">
                            <h3 className="text-sm font-bold text-base-200">Chat History</h3>
                            <button
                                onClick={() => setShowModal(false)}
                                className="text-base-500 hover:text-base-200 p-1 rounded hover:bg-base-800 transition-colors"
                                title="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* All-at-limit warning */}
                        {allChatsAtLimit && (
                            <div className="px-5 py-3 bg-danger-950/40 border-b border-danger-900/40 shrink-0">
                                <p className="text-xs text-danger-400">
                                    All {MAX_CHATS} chats have reached the context limit. Delete a chat to start fresh suggestions.
                                </p>
                            </div>
                        )}

                        {/* Chat list */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                            {chats.length === 0 ? (
                                <p className="text-sm text-base-500 text-center py-8">No chats yet.</p>
                            ) : chats.map(chat => (
                                <div
                                    key={chat.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => switchToChat(chat.id)}
                                    onKeyDown={(e) => e.key === 'Enter' && switchToChat(chat.id)}
                                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-colors cursor-pointer ${
                                        chat.id === activeChatId
                                            ? 'bg-base-850 ring-1 ring-base-500'
                                            : 'bg-base-800 hover:bg-base-700'
                                    }`}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-base-200 truncate">{chat.title}</p>
                                        <p className="text-xs text-base-500 mt-0.5">
                                            {chat.messages.length} message{chat.messages.length !== 1 ? 's' : ''}
                                            {chat.messages.length >= CONTEXT_LIMIT && (
                                                <span className="text-caution-400 ml-1">- Context full</span>
                                            )}
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => deleteChat(chat.id, e)}
                                        title="Delete chat"
                                        className="ml-3 p-1.5 rounded-lg text-base-500 hover:text-danger-400 hover:bg-base-600 transition-colors shrink-0"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* New chat footer */}
                        <div className="px-5 py-4 border-t border-base-700 shrink-0">
                            <button
                                onClick={createNewChat}
                                disabled={!canCreateChat}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-base-500 hover:bg-base-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-medium text-base-50 transition-colors"
                            >
                                <Plus size={15} />
                                New Chat
                                {!canCreateChat && <span className="text-base-500 font-normal">({MAX_CHATS}/{MAX_CHATS})</span>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* -- Main panel -- */}
            <aside
                style={{ width: panelWidth }}
                className="bg-base-900 border-l border-base-700 flex flex-col shrink-0 relative overflow-hidden"
            >
                {/* Resize handle */}
                <div
                    onMouseDown={handleResizeStart}
                    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-base-600 transition-colors z-10"
                    title="Drag to resize"
                />

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-base-700 shrink-0">
                    <button
                        onClick={() => setIsCollapsed(true)}
                        className="text-base-700 hover:text-base-200 p-1.5 rounded hover:bg-base-800 transition-colors shrink-0"
                        title="Collapse Panel"
                    >
                        <ChevronRight size={16} />
                    </button>
                    <h2 className="text-sm font-bold text-base-200 px-1 truncate flex items-center gap-2">
                        <Sparkles size={16} className="text-base-500" />
                        AI Suggestions
                    </h2>
                    <button
                        onClick={() => setShowModal(true)}
                        className="text-base-500 hover:text-base-200 p-1.5 rounded hover:bg-base-800 transition-colors shrink-0"
                        title="Chat History"
                    >
                        <History size={16} />
                    </button>
                </div>

                {/* No active chat (all chats deleted) */}
                {!activeChat ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                        <Sparkles size={28} className="text-base-700" />
                        <p className="text-sm text-base-500">No active chat.</p>
                        <button
                            onClick={createNewChat}
                            disabled={!canCreateChat}
                            className="flex items-center gap-2 px-4 py-2 bg-base-500 hover:bg-base-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm text-base-50 transition-colors"
                        >
                            <Plus size={14} />
                            New Chat
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Message list */}
                        <ScrollShadow className="flex-1 px-3 py-3 space-y-4 custom-scrollbar overflow-y-auto">
                            {/* Dismissable bias disclosure -- once per chat */}
                            {!dismissedDisclosures.has(activeChatId) && (
                                <div className="flex items-end gap-2">
                                    <Avatar
                                        size="sm"
                                        icon={<Bot size={14} />}
                                        classNames={{
                                            base: 'bg-base-700 shrink-0',
                                            icon: 'text-base-300',
                                        }}
                                    />
                                    <div className="bg-base-800 border border-base-700 rounded-2xl rounded-bl-none px-3.5 py-2.5 text-sm text-base-200 max-w-[85%] shadow-sm">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <div className="flex items-center gap-1.5">
                                                <AlertTriangle size={10} className="text-danger-400 shrink-0 mt-0.5" />
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-danger-400">Heads up</span>
                                            </div>
                                            <button
                                                onClick={() => setDismissedDisclosures(prev => new Set([...prev, activeChatId]))}
                                                className="text-base-600 hover:text-base-400 transition-colors shrink-0 -mt-0.5 -mr-0.5"
                                                title="Dismiss"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                        <MarkdownMessage content={`**Track suggestions are based on training data** and may be inaccurate.\n\nBPM and key values shown are measured directly from your audio - not guessed.`} />
                                    </div>
                                </div>
                            )}

                            {messages.map((msg, i) => {
                                const content = msg.isWelcome
                                    ? welcomeText(filledCount)
                                    : msg.content;
                                return msg.role === 'assistant' ? (
                                    <div key={i} className="flex items-end gap-2">
                                        <Avatar
                                            size="sm"
                                            icon={<Bot size={14} />}
                                            classNames={{
                                                base: 'bg-base-700 shrink-0',
                                                icon: 'text-base-300',
                                            }}
                                        />
                                        <div className="bg-base-800 border border-base-700 rounded-2xl rounded-bl-none px-3.5 py-2.5 text-sm text-base-200 max-w-[85%] shadow-sm">
                                            <MarkdownMessage content={content} />
                                            {msg.isOnboarding && (
                                                <div className="mt-3 flex flex-col gap-2">
                                                    <button onClick={() => handleExperienceSelect('beginner')} className="text-left px-3 py-2 bg-base-700 hover:bg-base-600 rounded-xl text-xs text-base-200 transition-colors">Absolute Beginner</button>
                                                    <button onClick={() => handleExperienceSelect('novice')} className="text-left px-3 py-2 bg-base-700 hover:bg-base-600 rounded-xl text-xs text-base-200 transition-colors">Novice</button>
                                                    <button onClick={() => handleExperienceSelect('intermediate')} className="text-left px-3 py-2 bg-base-700 hover:bg-base-600 rounded-xl text-xs text-base-200 transition-colors">Intermediate</button>
                                                    <button onClick={() => handleExperienceSelect('proficient')} className="text-left px-3 py-2 bg-base-700 hover:bg-base-600 rounded-xl text-xs text-base-200 transition-colors">Proficient</button>
                                                    <button onClick={() => handleExperienceSelect('advanced')} className="text-left px-3 py-2 bg-base-700 hover:bg-base-600 rounded-xl text-xs text-base-200 transition-colors">Advanced</button>
                                                </div>
                                            )}
                                            {msg.capturedAt && (
                                                <p className="text-[10px] text-base-400 mt-1.5">
                                                    Context at {new Date(msg.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div key={i} className="flex items-end justify-end gap-2">
                                        <div className="bg-base-600 border border-base-500 rounded-2xl rounded-br-none px-3.5 py-2.5 max-w-[85%] shadow-sm">
                                            <MarkdownMessage content={msg.content} isUser />
                                        </div>
                                        {avatarSrc ? (
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border-2 border-base-500">
                                                <img src={avatarSrc} alt={displayName} className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <Avatar
                                                size="sm"
                                                name={displayName}
                                                getInitials={(name) => {
                                                    const isEmail = name.includes('@');
                                                    if (isEmail) {
                                                        const u = name.split('@')[0];
                                                        return u.length === 1 ? u[0].toUpperCase() : (u[0] + u[u.length - 1]).toUpperCase();
                                                    }
                                                    const parts = name.trim().split(/\s+/);
                                                    if (parts.length === 1) return parts[0].length === 1 ? parts[0].toUpperCase() : (parts[0][0] + parts[0][parts[0].length - 1]).toUpperCase();
                                                    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                                                }}
                                                showFallback
                                                classNames={{
                                                    base: 'bg-base-600 shrink-0',
                                                    name: 'text-base-50 font-bold text-xs',
                                                }}
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {loading && (
                                <div className="flex items-end gap-2">
                                    <Avatar
                                        size="sm"
                                        icon={<Bot size={14} />}
                                        classNames={{
                                            base: 'bg-base-700 shrink-0',
                                            icon: 'text-base-300',
                                        }}
                                    />
                                    <div className="bg-base-800 border border-base-700 rounded-2xl rounded-bl-none px-3.5 py-2.5 flex gap-1 items-center shadow-sm">
                                        <span className="w-1.5 h-1.5 bg-base-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 bg-base-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 bg-base-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            )}

                            <div ref={bottomRef} />
                        </ScrollShadow>



                        <div className="shrink-0 px-3 pb-4 pt-2">
                            <div className="flex items-center gap-2 bg-base-800 border border-base-700 rounded-xl px-3 py-2 shadow-lg focus-within:border-base-600 focus-within:ring-1 focus-within:ring-base-600 transition-shadow">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask about current mix..."
                                    className="flex-1 bg-transparent text-sm text-base-100 placeholder-base-200 outline-none"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!input.trim() || loading}
                                    title="Send"
                                    className="p-1 rounded-lg text-base-100 hover:text-white hover:bg-base-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                >
                                    <Send size={15} />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </aside>
        </>
    );
}
