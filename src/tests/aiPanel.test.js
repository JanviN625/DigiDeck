import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AIPanel from '../components/AIPanel';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../firebase/firebase', () => ({
    useFirebaseAuth: jest.fn(),
}));

jest.mock('../spotify/appContext', () => ({
    useMix: jest.fn(),
}));

jest.mock('@heroui/react', () => ({
    Avatar: ({ name, icon, classNames, getInitials, showFallback, ...rest }) => (
        <div data-testid="avatar" {...rest}>{name ?? 'icon'}</div>
    ),
    ScrollShadow: ({ children, className, ...rest }) => (
        <div className={className} {...rest}>{children}</div>
    ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const setupMocks = (overrides = {}) => {
    const { useFirebaseAuth } = require('../firebase/firebase');
    const { useMix } = require('../spotify/appContext');
    useFirebaseAuth.mockReturnValue({
        user: { displayName: 'Test User', email: 'test@test.com', photoURL: null },
        ...(overrides.auth ?? {}),
    });
    useMix.mockReturnValue({
        tracks: [],
        ...(overrides.mix ?? {}),
    });
};

const mockFetch = (content = 'AI response', ok = true) => {
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok,
            json: () => Promise.resolve(ok ? { content } : { error: content }),
        })
    );
};

const preloadChat = (messages, id = 1) => {
    const chats = [{ id, title: 'Test Chat', messages, createdAt: Date.now() }];
    localStorage.setItem('digideck-ai-chats', JSON.stringify(chats));
    localStorage.setItem('digideck-active-chat-id', String(id));
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    delete process.env.REACT_APP_ANTHROPIC_API_KEY;
    setupMocks();
    mockFetch();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('AIPanel — rendering', () => {
    it('renders "AI Suggestions" header', () => {
        render(<AIPanel />);
        expect(screen.getByText('AI Suggestions')).toBeInTheDocument();
    });

    it('renders the chat input', async () => {
        render(<AIPanel />);
        await waitFor(() =>
            expect(screen.getByPlaceholderText('Ask for track suggestions…')).toBeInTheDocument()
        );
    });

    it('collapses panel when collapse button clicked', () => {
        render(<AIPanel />);
        fireEvent.click(screen.getByTitle('Collapse Panel'));
        expect(screen.queryByPlaceholderText('Ask for track suggestions…')).not.toBeInTheDocument();
        expect(screen.getByTitle('Expand AI Panel')).toBeInTheDocument();
    });

    it('expands panel after collapsing', () => {
        render(<AIPanel />);
        fireEvent.click(screen.getByTitle('Collapse Panel'));
        fireEvent.click(screen.getByTitle('Expand AI Panel'));
        expect(screen.getByPlaceholderText('Ask for track suggestions…')).toBeInTheDocument();
    });
});

// ─── Welcome messages ─────────────────────────────────────────────────────────

describe('AIPanel — welcome messages', () => {
    it('shows empty mix welcome when no tracks', async () => {
        render(<AIPanel />);
        await waitFor(() =>
            expect(screen.getByText(/No tracks yet/i)).toBeInTheDocument()
        );
    });

    it('shows track count for 1 track', async () => {
        setupMocks({ mix: { tracks: [{ audioUrl: 'a.mp3', title: 'T' }] } });
        render(<AIPanel />);
        await waitFor(() =>
            expect(screen.getByText(/has 1 track/i)).toBeInTheDocument()
        );
    });

    it('shows plural for multiple tracks', async () => {
        setupMocks({ mix: { tracks: [{ audioUrl: 'a.mp3' }, { audioUrl: 'b.mp3' }] } });
        render(<AIPanel />);
        await waitFor(() =>
            expect(screen.getByText(/has 2 tracks/i)).toBeInTheDocument()
        );
    });
});

// ─── Input behaviour ──────────────────────────────────────────────────────────

describe('AIPanel — input behaviour', () => {
    it('send button is disabled when input is empty', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        expect(screen.getByTitle('Send')).toBeDisabled();
    });

    it('send button enables when input has content', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: 'Hi' },
        });
        expect(screen.getByTitle('Send')).not.toBeDisabled();
    });

    it('Enter key submits the message', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        const input = screen.getByPlaceholderText('Ask for track suggestions…');
        fireEvent.change(input, { target: { value: 'Hello' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('Shift+Enter does not submit', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        const input = screen.getByPlaceholderText('Ask for track suggestions…');
        fireEvent.change(input, { target: { value: 'Hello' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('input clears after sending', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        const input = screen.getByPlaceholderText('Ask for track suggestions…');
        fireEvent.change(input, { target: { value: 'Hello' } });
        fireEvent.click(screen.getByTitle('Send'));
        expect(input.value).toBe('');
    });
});

// ─── Message flow ─────────────────────────────────────────────────────────────

describe('AIPanel — message flow', () => {
    it('user message appears in chat after sending', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: 'What tracks work together?' },
        });
        fireEvent.click(screen.getByTitle('Send'));
        expect(screen.getByText('What tracks work together?')).toBeInTheDocument();
    });

    it('AI response stored after fetch resolves', async () => {
        mockFetch('Here are my suggestions!');
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: 'Suggest tracks' },
        });
        fireEvent.click(screen.getByTitle('Send'));
        await waitFor(() => {
            const chats = JSON.parse(localStorage.getItem('digideck-ai-chats') || '[]');
            const msgs = chats[0]?.messages ?? [];
            expect(
                msgs.some(m => m.role === 'assistant' && m.content === 'Here are my suggestions!')
            ).toBe(true);
        }, { timeout: 3000 });
    });

    it('error message shown when fetch fails', async () => {
        mockFetch('Server error', false);
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: 'Hi' },
        });
        fireEvent.click(screen.getByTitle('Send'));
        await waitFor(() =>
            expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
        );
    });

    it('auto-titles chat on first user message (>30 chars gets truncated)', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        const longMsg = 'A'.repeat(35);
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: longMsg },
        });
        await act(async () => {
            fireEvent.click(screen.getByTitle('Send'));
        });
        fireEvent.click(screen.getByTitle('Chat History'));
        await waitFor(() =>
            expect(screen.getByText('A'.repeat(30) + '…')).toBeInTheDocument()
        );
    });

    it('short message used as title without ellipsis', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        fireEvent.change(screen.getByPlaceholderText('Ask for track suggestions…'), {
            target: { value: 'Short' },
        });
        fireEvent.click(screen.getByTitle('Send'));
        // Title is written synchronously on first user message — verify via localStorage
        await waitFor(() => {
            const chats = JSON.parse(localStorage.getItem('digideck-ai-chats') || '[]');
            expect(chats.find(c => c.title === 'Short')).toBeTruthy();
        });
    });
});

// ─── Chat management ──────────────────────────────────────────────────────────

describe('AIPanel — chat management', () => {
    it('opens chat history modal when history button clicked', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByTitle('Chat History'));
        fireEvent.click(screen.getByTitle('Chat History'));
        expect(screen.getByText('Chat History')).toBeInTheDocument();
    });

    it('closes modal when backdrop clicked', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByTitle('Chat History'));
        fireEvent.click(screen.getByTitle('Chat History'));
        // Click the backdrop (fixed inset overlay)
        fireEvent.click(screen.getByText('Chat History').closest('.fixed'));
        await waitFor(() =>
            // Modal h3 disappears after close
            expect(screen.queryByRole('heading', { name: 'Chat History' })).not.toBeInTheDocument()
        );
    });

    it('can create a new chat from the modal', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByTitle('Chat History'));
        fireEvent.click(screen.getByTitle('Chat History'));
        // There are two "New Chat" texts — button in modal footer
        const newChatBtn = screen.getAllByText(/New Chat/i).find(el => el.tagName === 'BUTTON');
        fireEvent.click(newChatBtn);
        // Welcome message for new chat should appear
        await waitFor(() =>
            expect(screen.getByText(/No tracks yet/i)).toBeInTheDocument()
        );
    });

    it('new chat button is disabled at MAX_CHATS (5)', async () => {
        const chats = Array.from({ length: 5 }, (_, i) => ({
            id: i + 1,
            title: `Chat ${i + 1}`,
            messages: [{ role: 'assistant', content: 'hi' }],
            createdAt: Date.now(),
        }));
        localStorage.setItem('digideck-ai-chats', JSON.stringify(chats));
        localStorage.setItem('digideck-active-chat-id', '1');

        render(<AIPanel />);
        fireEvent.click(screen.getByTitle('Chat History'));
        await waitFor(() => screen.getByText('Chat 1'));
        // The footer New Chat button should be disabled
        const buttons = screen.getAllByRole('button').filter(b => b.textContent.includes('New Chat'));
        const footerBtn = buttons.find(b => b.disabled !== undefined);
        expect(footerBtn).toBeDisabled();
    });

    it('deletes a chat from the history modal', async () => {
        const chats = [
            { id: 1, title: 'Alpha', messages: [{ role: 'assistant', content: 'hi' }], createdAt: Date.now() },
            { id: 2, title: 'Beta', messages: [{ role: 'assistant', content: 'hi' }], createdAt: Date.now() },
        ];
        localStorage.setItem('digideck-ai-chats', JSON.stringify(chats));
        localStorage.setItem('digideck-active-chat-id', '2');

        render(<AIPanel />);
        fireEvent.click(screen.getByTitle('Chat History'));
        await waitFor(() => screen.getByText('Alpha'));
        fireEvent.click(screen.getAllByTitle('Delete chat')[0]);
        await waitFor(() =>
            expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
        );
    });

    it('switches to another chat when active chat is deleted', async () => {
        const chats = [
            { id: 1, title: 'Alpha', messages: [{ role: 'assistant', content: 'hi' }], createdAt: Date.now() },
            { id: 2, title: 'Beta', messages: [{ role: 'assistant', content: 'hi' }], createdAt: Date.now() },
        ];
        localStorage.setItem('digideck-ai-chats', JSON.stringify(chats));
        localStorage.setItem('digideck-active-chat-id', '1');

        render(<AIPanel />);
        fireEvent.click(screen.getByTitle('Chat History'));
        await waitFor(() => screen.getByText('Alpha'));
        fireEvent.click(screen.getAllByTitle('Delete chat')[0]); // delete Alpha
        await waitFor(() =>
            expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
        );
        // Beta should still be present
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('shows "No active chat" state when all chats deleted', async () => {
        const chats = [
            { id: 1, title: 'Only', messages: [{ role: 'assistant', content: 'hi' }], createdAt: Date.now() },
        ];
        localStorage.setItem('digideck-ai-chats', JSON.stringify(chats));
        localStorage.setItem('digideck-active-chat-id', '1');

        render(<AIPanel />);
        fireEvent.click(screen.getByTitle('Chat History'));
        await waitFor(() => screen.getByText('Only'));
        fireEvent.click(screen.getAllByTitle('Delete chat')[0]);
        await waitFor(() =>
            expect(screen.getByText('No active chat.')).toBeInTheDocument()
        );
    });

    it('persists chats to localStorage', async () => {
        render(<AIPanel />);
        await waitFor(() => screen.getByPlaceholderText('Ask for track suggestions…'));
        const stored = JSON.parse(localStorage.getItem('digideck-ai-chats'));
        expect(Array.isArray(stored)).toBe(true);
        expect(stored.length).toBeGreaterThan(0);
    });
});

// ─── Markdown rendering ───────────────────────────────────────────────────────

describe('AIPanel — markdown rendering', () => {
    it('renders **bold** as <strong>', () => {
        preloadChat([{ role: 'assistant', content: 'Use **reverb** here' }]);
        render(<AIPanel />);
        expect(screen.getByText('reverb').tagName).toBe('STRONG');
    });

    it('renders *italic* as <em>', () => {
        preloadChat([{ role: 'assistant', content: 'Try *subtle* changes' }]);
        render(<AIPanel />);
        expect(screen.getByText('subtle').tagName).toBe('EM');
    });

    it('renders `inline code` as <code>', () => {
        preloadChat([{ role: 'assistant', content: 'Set `mix` to 0.3' }]);
        render(<AIPanel />);
        expect(screen.getByText('mix').tagName).toBe('CODE');
    });

    it('renders - bullet list as <ul>', () => {
        preloadChat([{ role: 'assistant', content: '- item one\n- item two' }]);
        render(<AIPanel />);
        expect(document.querySelector('ul')).toBeInTheDocument();
        expect(screen.getByText('item one')).toBeInTheDocument();
        expect(screen.getByText('item two')).toBeInTheDocument();
    });

    it('renders 1. numbered list as <ol>', () => {
        preloadChat([{ role: 'assistant', content: '1. first step\n2. second step' }]);
        render(<AIPanel />);
        expect(document.querySelector('ol')).toBeInTheDocument();
    });

    it('renders ## heading as a paragraph', () => {
        preloadChat([{ role: 'assistant', content: '## EQ Tips' }]);
        render(<AIPanel />);
        expect(screen.getByText('EQ Tips')).toBeInTheDocument();
    });

    it('renders ### subheading as a paragraph', () => {
        preloadChat([{ role: 'assistant', content: '### Low End' }]);
        render(<AIPanel />);
        expect(screen.getByText('Low End')).toBeInTheDocument();
    });

    it('does not render raw ** characters', () => {
        preloadChat([{ role: 'assistant', content: '**bold**' }]);
        render(<AIPanel />);
        expect(screen.queryByText('**bold**')).not.toBeInTheDocument();
    });

    it('does not render raw * characters', () => {
        preloadChat([{ role: 'assistant', content: '*italic*' }]);
        render(<AIPanel />);
        expect(screen.queryByText('*italic*')).not.toBeInTheDocument();
    });
});
