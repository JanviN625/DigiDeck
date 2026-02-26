import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { getDynamicInputWidth } from '../utils/helpers';

export default function Header({ profile, logout }) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [projectName, setProjectName] = useState('Untitled project');
    const [isEditingProject, setIsEditingProject] = useState(false);
    const avatarUrl = profile?.images?.[0]?.url;
    const displayName = profile?.display_name || 'User';

    return (
        <header className="h-16 bg-base-800 border-b border-base-700 flex items-center justify-between px-6 shrink-0 relative">
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <img src="/icon.png" alt="DigiDeck Logo" className="w-11 h-11 object-contain drop-shadow-md" />
                    <div className="font-extrabold text-sm leading-tight tracking-wider text-base-50">
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

            <div
                className="flex gap-4 relative h-full items-center justify-end"
                onMouseLeave={() => setDropdownOpen(false)}
            >
                {/* Secondary Navigation Actions */}
                <nav className="flex items-center gap-1.5 mr-2">
                    <button className="text-sm font-semibold text-base-300 hover:text-base-50 hover:bg-base-700 px-3 py-1.5 rounded transition-colors tracking-wide">Save</button>
                    <button className="text-sm font-semibold text-base-300 hover:text-base-50 hover:bg-base-700 px-3 py-1.5 rounded transition-colors tracking-wide">Load</button>
                    <button className="text-sm font-semibold text-base-300 hover:text-base-50 hover:bg-base-700 px-3 py-1.5 rounded transition-colors tracking-wide">Export</button>
                    <div className="w-px h-5 bg-base-700 mx-2"></div>
                    <button className="text-sm font-bold text-base-50 bg-base-600 hover:bg-base-500 px-4 py-1.5 rounded-full transition-colors tracking-wide border border-base-500 shadow-sm ml-1">Preview Full Mix</button>
                </nav>

                <div className="relative">
                    <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className={`w-10 h-10 rounded-full bg-base-700 flex items-center justify-center overflow-hidden border-2 transition-colors focus:outline-none relative z-10 ${dropdownOpen ? 'border-base-500' : 'border-transparent hover:border-base-500'}`}
                        title="Account profile"
                    >
                        {avatarUrl ? (
                            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                        ) : (
                            <span className="font-bold text-lg text-base-50">{displayName[0]?.toUpperCase() || '?'}</span>
                        )}
                    </button>

                    {dropdownOpen && (
                        /* Invisible padding area expanding to the left and up to catch mouse travel */
                        <div className="absolute top-0 right-0 pt-10 -ml-16 w-48 z-50">
                            <div className="w-full bg-base-800 border border-base-700 rounded-lg shadow-xl overflow-hidden text-base-200">
                                <div className="px-4 py-3 border-b border-base-700 bg-base-900/50">
                                    <p className="font-semibold truncate" title={displayName}>{displayName}</p>
                                </div>
                                <div className="py-1">
                                    <button className="w-full text-left px-4 py-2 hover:bg-base-700 transition-colors text-sm">
                                        Account info
                                    </button>
                                    <button className="w-full text-left px-4 py-2 hover:bg-base-700 transition-colors text-sm">
                                        Settings
                                    </button>
                                    <div className="border-t border-base-700 my-1"></div>
                                    <button
                                        onClick={() => {
                                            setDropdownOpen(false);
                                            logout();
                                        }}
                                        className="w-full text-left px-4 py-2 hover:bg-base-700 text-base-500 font-medium transition-colors outline-none text-sm"
                                    >
                                        Logout
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
