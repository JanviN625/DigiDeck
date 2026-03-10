import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Avatar, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection } from '@heroui/react';
import { getDynamicInputWidth } from '../utils/helpers';
import { useFirebaseAuth } from '../firebase/firebase';
import { useSpotifyConnect } from '../spotify/spotifyContext';

export default function Header() {
    const { user, signOut } = useFirebaseAuth();
    const { isSpotifyConnected, connectSpotify, disconnectSpotify } = useSpotifyConnect();
    const [projectName, setProjectName] = useState('Untitled project');
    const [isEditingProject, setIsEditingProject] = useState(false);

    // Resolve Profile Data
    const displayName = user?.displayName || user?.email || 'User';

    // Avatar uses Firebase Auth photoURL permanently
    const avatarSrc = user?.photoURL || null;

    // Custom initials logic: First character and last character before the '@' symbol
    const CustomInitials = (nameStr) => {
        if (!nameStr) return '?';
        const isEmail = nameStr.includes('@');
        if (isEmail) {
            const username = nameStr.split('@')[0];
            if (username.length === 1) return username[0].toUpperCase();
            return (username[0] + username[username.length - 1]).toUpperCase();
        }
        // Non-email fallback (e.g. Google displayName)
        const parts = nameStr.trim().split(/\s+/);
        if (parts.length === 1) {
            if (parts[0].length === 1) return parts[0].toUpperCase();
            return (parts[0][0] + parts[0][parts[0].length - 1]).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    return (
        <header className="h-16 bg-base-800 border-b border-base-700 flex items-center justify-between px-6 shrink-0 relative">
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <img src="/icon.png" alt="DigiDeck Logo" className="w-11 h-11 object-contain drop-shadow-md" />
                    <div className="font-extrabold text-sm leading-tight tracking-wider text-base-50 text-left">
                        <div>DigiDeck</div>
                        <div className="text-base-300 font-bold">Studio</div>
                    </div>
                </div>

                <div className="h-8 w-px bg-base-700" />

                <div className="flex items-center gap-2 relative group">
                    <input
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        disabled={!isEditingProject}
                        style={{ width: getDynamicInputWidth(projectName, 16) }}
                        className={`text-base-200 font-medium px-1 py-1 rounded outline-none transition-colors cursor-text ${isEditingProject ? 'bg-base-900' : 'bg-transparent'}`}
                        onKeyDown={(e) => e.key === 'Enter' && setIsEditingProject(false)}
                    />
                    <button
                        onClick={() => setIsEditingProject(!isEditingProject)}
                        className={`transition-colors p-1 rounded border ${isEditingProject ? 'bg-base-900 text-base-200 border-base-500' : 'bg-transparent border-transparent text-base-700 hover:text-base-200 hover:border-base-500'}`}
                        title="Rename project"
                    >
                        <Pencil size={16} />
                    </button>
                </div>
            </div>

            <div className="flex gap-4 relative h-full items-center justify-end">
                {/* Secondary Navigation Actions */}
                <nav className="flex items-center gap-1.5 mr-2">
                    <button className="text-sm font-semibold text-base-300 hover:text-base-50 hover:bg-base-700 px-3 py-1.5 rounded transition-colors tracking-wide">Save</button>
                    <button className="text-sm font-semibold text-base-300 hover:text-base-50 hover:bg-base-700 px-3 py-1.5 rounded transition-colors tracking-wide">Load</button>
                    <button className="text-sm font-semibold text-base-300 hover:text-base-50 hover:bg-base-700 px-3 py-1.5 rounded transition-colors tracking-wide">Export</button>
                    <div className="w-px h-5 bg-base-700 mx-2"></div>
                    <button className="text-sm font-bold text-base-50 bg-base-600 hover:bg-base-500 px-4 py-1.5 rounded-full transition-colors tracking-wide border border-base-500 shadow-sm ml-1">Preview Full Mix</button>
                </nav>

                <Dropdown
                    placement="bottom-end"
                    classNames={{
                        content: "bg-base-800 border border-base-700 rounded-lg shadow-xl text-base-200 min-w-[200px]"
                    }}
                >
                    <DropdownTrigger>
                        {avatarSrc ? (
                            <button className="bg-base-700 border-2 border-transparent hover:border-base-500 transition-colors cursor-pointer rounded-full overflow-hidden w-10 h-10 flex items-center justify-center shrink-0">
                                <img src={avatarSrc} alt={displayName} className="w-full h-full object-cover" />
                            </button>
                        ) : (
                            <Avatar
                                as="button"
                                name={displayName}
                                getInitials={CustomInitials}
                                showFallback
                                classNames={{
                                    base: "bg-base-700 border-2 border-transparent hover:border-base-500 transition-colors cursor-pointer",
                                    name: "text-base-50 font-bold"
                                }}
                            />
                        )}
                    </DropdownTrigger>

                    <DropdownMenu aria-label="Profile Actions" variant="flat">
                        <DropdownItem key="profile" className="h-14 gap-2 opacity-100 hover:bg-transparent cursor-default">
                            <p className="font-semibold truncate text-base-50">{displayName}</p>
                            <p className="text-xs text-base-400 truncate">{user?.email}</p>
                        </DropdownItem>

                        <DropdownItem key="account" className="hover:bg-base-700 hover:text-base-50 text-sm py-2">
                            Account info
                        </DropdownItem>

                        <DropdownItem key="settings" className="hover:bg-base-700 hover:text-base-50 text-sm py-2">
                            Settings
                        </DropdownItem>

                        <DropdownItem
                            key="spotify"
                            onPress={isSpotifyConnected ? disconnectSpotify : connectSpotify}
                            className="hover:bg-base-700 hover:text-base-50 text-sm py-2"
                        >
                            {isSpotifyConnected ? 'Disconnect Spotify' : 'Connect Spotify'}
                        </DropdownItem>

                        <DropdownSection showDivider>
                            <DropdownItem
                                key="logout"
                                className="text-base-400 hover:text-base-400 hover:bg-base-700 font-medium text-sm py-2"
                                onPress={signOut}
                            >
                                Logout
                            </DropdownItem>
                        </DropdownSection>
                    </DropdownMenu>
                </Dropdown>
            </div>
        </header>
    );
}
