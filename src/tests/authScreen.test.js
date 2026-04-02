import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthScreen from '../components/AuthScreen';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Simple factory — no closures over outer variables (avoids Jest-hoist TDZ issues).
jest.mock('../firebase/firebase', () => ({
    useFirebaseAuth: jest.fn(),
}));

// HeroUI Button uses onPress (React Aria). Map it to onClick for jsdom reliability.
jest.mock('@heroui/react', () => ({
    Button: ({ onPress, children, isLoading, disabled, type, ...props }) => (
        <button
            type={type || 'button'}
            onClick={onPress}
            disabled={disabled || isLoading}
            data-loading={isLoading ? 'true' : undefined}
            {...props}
        >
            {isLoading ? 'Loading…' : children}
        </button>
    ),
    Divider: () => <hr />,
}));

// ─── Per-test setup ───────────────────────────────────────────────────────────

const mockLoginWithGoogle = jest.fn();
const mockLoginWithEmail = jest.fn();
const mockSignUpWithEmail = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
    // Set return value here (after declarations are resolved) to avoid
    // jest.mock factory closure issues.
    const { useFirebaseAuth } = require('../firebase/firebase');
    useFirebaseAuth.mockReturnValue({
        loginWithGoogle: mockLoginWithGoogle,
        loginWithEmail: mockLoginWithEmail,
        signUpWithEmail: mockSignUpWithEmail,
    });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fillLogin = (email = 'user@test.com', password = 'password123') => {
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: email } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: password } });
};

const fillSignUp = (displayName = 'Test User', email = 'user@test.com', password = 'pass123') => {
    fireEvent.change(screen.getByPlaceholderText('Display Name'), { target: { value: displayName } });
    fillLogin(email, password);
};

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('AuthScreen — initial render', () => {
    it('renders the DigiDeck Studio heading', () => {
        render(<AuthScreen />);
        expect(screen.getByText('DigiDeck Studio')).toBeInTheDocument();
    });

    it('renders the email and password fields', () => {
        render(<AuthScreen />);
        expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    });

    it('does not render the display name field in login mode', () => {
        render(<AuthScreen />);
        expect(screen.queryByPlaceholderText('Display Name')).not.toBeInTheDocument();
    });

    it('renders the Log In and Sign Up buttons', () => {
        render(<AuthScreen />);
        expect(screen.getByText('Log In')).toBeInTheDocument();
        expect(screen.getByText('Sign Up')).toBeInTheDocument();
    });

    it('renders the Continue with Google button', () => {
        render(<AuthScreen />);
        expect(screen.getByText(/Continue with Google/i)).toBeInTheDocument();
    });
});

// ─── Sign-up mode toggle ──────────────────────────────────────────────────────

describe('AuthScreen — sign-up mode toggle', () => {
    it('shows the Display Name field after clicking Sign Up', () => {
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Sign Up'));
        expect(screen.getByPlaceholderText('Display Name')).toBeInTheDocument();
    });

    it('hides the Display Name field after switching back to login mode', () => {
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Sign Up'));
        expect(screen.getByPlaceholderText('Display Name')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Log In'));
        expect(screen.queryByPlaceholderText('Display Name')).not.toBeInTheDocument();
    });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('AuthScreen — form validation', () => {
    it('shows an error when submitting with no email', () => {
        render(<AuthScreen />);
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByText('Log In'));
        expect(screen.getByText('Please fill out all fields.')).toBeInTheDocument();
    });

    it('shows an error when submitting with no password', () => {
        render(<AuthScreen />);
        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByText('Log In'));
        expect(screen.getByText('Please fill out all fields.')).toBeInTheDocument();
    });

    it('shows an error when both login fields are empty', () => {
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Log In'));
        expect(screen.getByText('Please fill out all fields.')).toBeInTheDocument();
    });

    it('shows an error in sign-up mode when display name is missing', () => {
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Sign Up'));
        fillLogin(); // email + password only, no display name
        fireEvent.click(screen.getByText('Sign Up'));
        expect(screen.getByText('Please fill out all fields.')).toBeInTheDocument();
    });

    it('does not call loginWithEmail when fields are empty', () => {
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Log In'));
        expect(mockLoginWithEmail).not.toHaveBeenCalled();
    });
});

// ─── Login flow ───────────────────────────────────────────────────────────────

describe('AuthScreen — email login flow', () => {
    it('calls loginWithEmail with the entered credentials', async () => {
        mockLoginWithEmail.mockResolvedValueOnce(undefined);
        render(<AuthScreen />);
        fillLogin('user@example.com', 'mypassword');
        fireEvent.click(screen.getByText('Log In'));
        await waitFor(() =>
            expect(mockLoginWithEmail).toHaveBeenCalledWith('user@example.com', 'mypassword')
        );
    });

    it('displays the error message when loginWithEmail rejects', async () => {
        mockLoginWithEmail.mockRejectedValueOnce(new Error('auth/wrong-password'));
        render(<AuthScreen />);
        fillLogin();
        fireEvent.click(screen.getByText('Log In'));
        expect(await screen.findByText('auth/wrong-password')).toBeInTheDocument();
    });

    it('does not call loginWithEmail when Sign Up is clicked in login mode', () => {
        render(<AuthScreen />);
        fillLogin();
        fireEvent.click(screen.getByText('Sign Up'));
        expect(mockLoginWithEmail).not.toHaveBeenCalled();
    });
});

// ─── Sign-up flow ─────────────────────────────────────────────────────────────

describe('AuthScreen — sign-up flow', () => {
    it('calls signUpWithEmail with display name, email, and password', async () => {
        mockSignUpWithEmail.mockResolvedValueOnce(undefined);
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Sign Up'));
        fillSignUp('DJ Remix', 'dj@test.com', 'djpass');
        fireEvent.click(screen.getByText('Sign Up'));
        await waitFor(() =>
            expect(mockSignUpWithEmail).toHaveBeenCalledWith('dj@test.com', 'djpass', 'DJ Remix')
        );
    });

    it('displays an error when signUpWithEmail rejects', async () => {
        mockSignUpWithEmail.mockRejectedValueOnce(new Error('auth/email-already-in-use'));
        render(<AuthScreen />);
        fireEvent.click(screen.getByText('Sign Up'));
        fillSignUp();
        fireEvent.click(screen.getByText('Sign Up'));
        expect(await screen.findByText('auth/email-already-in-use')).toBeInTheDocument();
    });
});

// ─── Google login ─────────────────────────────────────────────────────────────

describe('AuthScreen — Google login', () => {
    it('calls loginWithGoogle when the Google button is clicked', async () => {
        mockLoginWithGoogle.mockResolvedValueOnce(undefined);
        render(<AuthScreen />);
        fireEvent.click(screen.getByText(/Continue with Google/i));
        await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalledTimes(1));
    });

    it('displays an error when loginWithGoogle rejects', async () => {
        mockLoginWithGoogle.mockRejectedValueOnce(new Error('popup_closed_by_user'));
        render(<AuthScreen />);
        fireEvent.click(screen.getByText(/Continue with Google/i));
        expect(await screen.findByText('popup_closed_by_user')).toBeInTheDocument();
    });
});

// ─── Form keyboard submission ─────────────────────────────────────────────────

describe('AuthScreen — Enter key submission', () => {
    it('submits the login form when the form onSubmit is triggered', async () => {
        mockLoginWithEmail.mockResolvedValueOnce(undefined);
        render(<AuthScreen />);
        fillLogin();
        // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
        const form = screen.getByPlaceholderText('Email').closest('form');
        fireEvent.submit(form);
        await waitFor(() => expect(mockLoginWithEmail).toHaveBeenCalled());
    });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe('AuthScreen — loading state', () => {
    it('renders a loading spinner while auth is in progress', async () => {
        let resolveLogin;
        mockLoginWithEmail.mockReturnValueOnce(new Promise(res => { resolveLogin = res; }));

        render(<AuthScreen />);
        fillLogin();
        fireEvent.click(screen.getByText('Log In'));

        await waitFor(() => {
            // eslint-disable-next-line testing-library/no-node-access
            expect(document.querySelector('.animate-spin')).toBeTruthy();
        });

        resolveLogin();
    });
});
