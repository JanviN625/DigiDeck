# Plan 03 — AI Suggestions (Claude Haiku Chatbot)

## Component & Style Rules
- **Components:** HeroUI first → Lucide (icons only) → plain Tailwind
- **Colors:** `base` scale from `tailwind.config.js` only (`base-50` … `base-900`)
- **Retains** existing `AIPanel.js` structural styles — same `bg-base-900`,
  `border-l border-base-700`, collapse toggle, and header treatment

---

## 1. What Changes

The static suggestion cards are replaced with a mini chatbot powered by
**Claude Haiku** (`claude-haiku-4-5`). Instead of auto-fetching from a catalog
API, the user talks to Claude directly. Claude receives the current mix's
extracted audio features as system context and recommends songs by name/artist,
with reasoning (BPM compatibility, key, energy, genre fit).

| Before | After |
|---|---|
| Suggestion cards auto-fetched on mix change | Chat interface, user-driven |
| `getRecommendations()` → deprecated Spotify endpoint | Claude Haiku API via Firebase Function proxy |
| Random mock match % | AI reasoning in natural language |
| Spotify track IDs required as seeds | Works for any mix (uploads or Spotify previews) |
| No copyright awareness | Claude flags licensing concerns naturally |

---

## 2. Claude Context Injection

Every message to Claude includes a system prompt built from current mix state.
Essentia.js analysis results (Plan 02) must be complete before a meaningful
system prompt can be built — tracks without analysis show as `"(analysing...)"`.

### System prompt structure

```
You are a DJ assistant for DigiDeck, a music mashup studio.

Current mix:
  Track 1: "Blinding Lights" — The Weeknd
    BPM: 171 | Key: F minor | Energy: 0.82 | Source: Spotify preview
  Track 2: [Uploaded file: "my_loop.mp3"]
    BPM: 86 | Key: A minor | Energy: 0.45 | Source: upload (unknown title)

Rules:
- Recommend tracks by song title and artist only — do not fabricate audio URLs
- If the mix already has tracks, prioritise compatibility (BPM proximity,
  Camelot key adjacency, similar energy level)
- If the mix is empty, accept open-ended requests from the user
- Note when a recommended track is commercially licensed and not freely available
- Keep responses concise — 3 to 5 suggestions per reply unless asked for more
- Do not suggest adding copyrighted full audio programmatically
```

### Two modes

| Mix state | Behaviour |
|---|---|
| Tracks present | Claude uses BPM/key/energy data to steer recommendations |
| Empty mix | Open-ended — user can ask for any genre, mood, or style |

---

## 3. Resizable Panel

### Width state
```js
const MIN_WIDTH = 288;  // matches current w-72
const MAX_WIDTH = 560;  // hard cap — prevents bleeding into track workspace
const [panelWidth, setPanelWidth] = useState(MIN_WIDTH);
```

`MAX_WIDTH` is enforced so the panel never obscures the main `TrackCard`
workspace, regardless of how far the user drags.

### Resize handle
A 4px drag target sits flush against the left edge of the panel:

```jsx
<div
  className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize
             hover:bg-base-500 active:bg-base-400 transition-colors z-10"
  onMouseDown={handleResizeStart}
/>
```

### Drag logic (mousedown on handle)
```js
const handleResizeStart = (e) => {
  e.preventDefault();
  const startX    = e.clientX;
  const startWidth = panelWidth;

  const onMove = (e) => {
    const delta = startX - e.clientX;          // drag left = grow panel
    setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};
```

Panel `aside` uses inline style instead of a fixed Tailwind width class:
```jsx
<aside style={{ width: isCollapsed ? 64 : panelWidth }}
       className="bg-base-900 border-l border-base-700 flex flex-col
                  shrink-0 transition-[width] duration-300 relative overflow-hidden">
```

---

## 4. Chat UI Spec

### Layout (expanded state)
```
┌─────────────────────────────────────┐
│ ‹  ✦  AI Suggestions                │  ← existing header (unchanged)
├─────────────────────────────────────┤
│                                     │
│  [AI bubble] Based on your mix,     │  ← message list (flex-1, overflow-y-auto)
│  I'd suggest…                       │
│                                     │
│              [User bubble] give me  │
│              something darker ›     │
│                                     │
│  [AI bubble] Try "Midnight City"…   │
│                                     │
├─────────────────────────────────────┤
│ [ Ask about your mix…       ] [▶]   │  ← input row (pinned bottom, shrink-0)
└─────────────────────────────────────┘
```

### Message bubbles

**AI messages** — left-aligned:
```jsx
<div className="flex gap-2 items-start">
  <Sparkles size={14} className="text-base-500 mt-1 shrink-0" />
  <div className="bg-base-800 border border-base-700 rounded-lg rounded-tl-none
                  px-3 py-2 text-xs text-base-100 leading-relaxed
                  max-w-full overflow-y-auto max-h-48">
    {message.content}
  </div>
</div>
```

`max-h-48` (192px) + `overflow-y-auto` caps individual AI responses — long
replies scroll within the bubble rather than pushing the input off-screen.

**User messages** — right-aligned:
```jsx
<div className="flex justify-end">
  <div className="bg-base-700 rounded-lg rounded-tr-none
                  px-3 py-2 text-xs text-base-50 max-w-[85%]">
    {message.content}
  </div>
</div>
```

### Input row
```jsx
<div className="border-t border-base-700 p-2 flex gap-2 shrink-0">
  <input
    className="flex-1 bg-base-800 border border-base-700 rounded-lg px-3 py-2
               text-xs text-base-50 placeholder-base-500
               focus:outline-none focus:border-base-400"
    placeholder="Ask about your mix…"
    value={input}
    onChange={(e) => setInput(e.target.value)}
    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
    maxLength={300}
  />
  <button
    onClick={handleSend}
    disabled={!input.trim() || loading}
    className="p-2 bg-base-500 hover:bg-base-400 disabled:bg-base-800
               disabled:text-base-600 text-base-50 rounded-lg transition-colors shrink-0"
  >
    <Send size={14} />
  </button>
</div>
```

`maxLength={300}` on the input field prevents users sending excessively long
prompts. Not a hard limit on AI response length — `max-h-48` on the bubble
handles that visually.

### Loading state
While awaiting Claude response, show a typing indicator in the message list:
```jsx
<div className="flex gap-2 items-center">
  <Sparkles size={14} className="text-base-500 shrink-0" />
  <div className="bg-base-800 border border-base-700 rounded-lg px-3 py-2">
    <span className="flex gap-1">
      {[0,1,2].map(i => (
        <span key={i} className="w-1 h-1 rounded-full bg-base-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  </div>
</div>
```

### Welcome message
On mount (or when panel first opens), pre-populate with one AI message:
- Mix has tracks: `"I can see your mix has [N] track(s). Ask me for compatible suggestions, or tell me the vibe you're going for."`
- Empty mix: `"No tracks yet — tell me what you're working on and I'll suggest some starting points."`

---

## 5. API Integration

### Recommended: Firebase Function proxy

Calling the Anthropic API directly from the browser exposes the API key in
client-side code. Use a Firebase Cloud Function as a thin proxy:

```
src/firebase/functions/aiChat.js  (Firebase Function)
  → receives { messages, systemPrompt } from client
  → calls Anthropic API server-side with ANTHROPIC_API_KEY env var
  → streams or returns response to client
```

Client call:
```js
const aiChat = httpsCallable(functions, 'aiChat');
const result = await aiChat({ messages: chatHistory, systemPrompt });
```

### Simple alternative (dev/prototype only)
Direct browser call using `@anthropic-ai/sdk`. Requires `REACT_APP_ANTHROPIC_API_KEY`
in `.env`. **Do not commit the `.env` file.** Not suitable for a deployed app.

### New package
```
npm install @anthropic-ai/sdk
```

### Claude model
`claude-haiku-4-5` — fast, low cost, sufficient for conversational music
recommendations. Use `max_tokens: 400` to keep responses concise.

### Conversation history
Maintain `messages` array in component state — append each user/assistant turn.
Pass the full array on every call for context continuity:
```js
const [messages, setMessages] = useState([]);
// Each item: { role: 'user' | 'assistant', content: string }
```

Cap history at 20 messages (oldest dropped first) to avoid token bloat:
```js
const trimmed = messages.slice(-20);
```

---

## 6. Files Affected

| Action | File | Notes |
|---|---|---|
| **Modify** | `src/components/AIPanel.js` | Replace suggestion cards with chat UI; add resize handle + width state; build dynamic system prompt from mix context; integrate Claude Haiku via Firebase Function |
| **Add** | `functions/aiChat.js` | Firebase Cloud Function — Anthropic API proxy (keeps API key server-side) |
| **Modify** | `package.json` | Add `@anthropic-ai/sdk` |

**Unchanged:** `helpers.js` scoring functions not needed. All other files unchanged.

**Dependency on Plan 02:** System prompt quality improves significantly once
Essentia.js analysis (Plan 02) is wired up — BPM, key, and energy values
will be real rather than `"(analysing...)"` placeholders.
