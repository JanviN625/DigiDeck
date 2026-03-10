import React, { useState } from 'react';
import { Button, Divider } from '@heroui/react';
import { Mail, Lock, User } from 'lucide-react';
import { useFirebaseAuth } from '../firebase/firebase';

export default function AuthScreen() {
    const { loginWithGoogle, loginWithEmail, signUpWithEmail } = useFirebaseAuth();
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        if (e && typeof e.preventDefault === 'function') {
            e.preventDefault();
        }

        if (!email || !password || (isSignUp && !displayName)) {
            setError('Please fill out all fields.');
            return;
        }

        setError(null);
        setIsLoading(true);

        try {
            if (isSignUp) {
                await signUpWithEmail(email, password, displayName);
            } else {
                await loginWithEmail(email, password);
            }
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    const handleGoogle = async () => {
        setError(null);
        setIsLoading(true);
        try {
            await loginWithGoogle();
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-screen w-full bg-base-900 justify-center items-center font-sans">
                <div className="w-32 h-32 border-8 border-white/20 border-t-base-450 rounded-full animate-spin shadow-lg"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen w-full bg-base-900 text-base-200 justify-center items-center font-sans">
            <div className="bg-base-800 p-8 sm:p-10 rounded-xl shadow-2xl border border-base-700 w-full max-w-lg text-center mx-4">
                <div className="flex flex-col items-center justify-center gap-4 mb-4">
                    <img src="/icon.png" alt="DigiDeck Logo" className="w-16 h-16 object-contain drop-shadow-lg" />
                    <h1 className="text-3xl font-extrabold tracking-tight text-base-400">DigiDeck Studio</h1>
                </div>
                <p className="text-base-300 mb-6 leading-relaxed text-sm">
                    Welcome to DigiDeck, an AI-Enhanced Music Mashup Studio. Sign in to save your projects, upload tracks, and optionally connect Spotify for catalog browsing.
                </p>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
                    {error && <p className="text-sm font-semibold text-base-400 text-center">{error}</p>}

                    {isSignUp && (
                        <input
                            type="text"
                            aria-label="Display Name"
                            placeholder="Display Name"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            required
                            className="w-full bg-base-900 border border-base-600 rounded-lg px-3 py-2 text-sm text-base-200 placeholder-base-200 focus:outline-none focus:border-base-450 focus:ring-1 focus:ring-base-450 transition-colors h-10"
                        />
                    )}

                    <input
                        type="email"
                        aria-label="Email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full bg-base-900 border border-base-600 rounded-lg px-3 py-2 text-sm text-base-200 placeholder-base-200 focus:outline-none focus:border-base-450 focus:ring-1 focus:ring-base-450 transition-colors h-10 mt-2"
                    />

                    <input
                        type="password"
                        aria-label="Password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full bg-base-900 border border-base-600 rounded-lg px-3 py-2 text-sm text-base-200 placeholder-base-200 focus:outline-none focus:border-base-450 focus:ring-1 focus:ring-base-450 transition-colors h-10 mt-2"
                    />

                    <div className="flex flex-row gap-3 mt-4">
                        <Button
                            type="button"
                            onPress={() => !isSignUp ? handleSubmit() : setIsSignUp(false)}
                            isLoading={!isSignUp && isLoading}
                            radius="full"
                            variant="solid"
                            className="flex-1 font-bold bg-base-450 text-white hover:bg-base-450/80"
                        >
                            Log In
                        </Button>
                        <Button
                            type="button"
                            onPress={() => isSignUp ? handleSubmit() : setIsSignUp(true)}
                            isLoading={isSignUp && isLoading}
                            radius="full"
                            variant="solid"
                            className="flex-1 bg-base-700 text-base-50 font-bold hover:bg-base-600"
                        >
                            Sign Up
                        </Button>
                        {/* Hidden submit button to intercept 'Enter' key press and trigger the form's onSubmit */}
                        <button type="submit" className="hidden" aria-hidden="true" tabIndex="-1">Submit</button>
                    </div>
                </form>

                <div className="flex items-center gap-4 my-6">
                    <Divider className="flex-1" />
                    <span className="text-xs text-base-450 font-bold tracking-widest uppercase">OR</span>
                    <Divider className="flex-1" />
                </div>

                <Button
                    onPress={handleGoogle}
                    isLoading={isLoading}
                    radius="full"
                    fullWidth
                    variant="solid"
                    className="bg-base-700 hover:bg-base-600 text-base-50 font-bold flex items-center gap-2"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Continue with Google
                </Button>
            </div>
        </div>
    );
}
