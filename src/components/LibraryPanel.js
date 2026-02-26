import React, { useState } from 'react';
import { ChevronLeft, Library } from 'lucide-react';

export default function LibraryPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <aside className={`${isCollapsed ? 'w-16' : 'w-64'} bg-base-900 border-r border-base-700 flex flex-col shrink-0 transition-all duration-300 relative overflow-hidden`}>
            {isCollapsed ? (
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button
                        onClick={() => setIsCollapsed(false)}
                        title="Expand Library"
                        className="p-1.5 rounded hover:bg-base-800 transition-colors"
                    >
                        <Library className="text-base-300 hover:text-base-50 transition-colors" size={24} />
                    </button>
                </div>
            ) : (
                <div className="p-4 flex flex-col h-full w-64 shrink-0 transition-opacity duration-300">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-sm font-bold text-base-50 px-1">Imported Spotify Playlists</h2>
                        <button
                            onClick={() => setIsCollapsed(true)}
                            className="text-base-300 hover:text-base-50 p-1.5 rounded hover:bg-base-800 transition-colors shrink-0"
                            title="Collapse Library"
                        >
                            <ChevronLeft size={16} />
                        </button>
                    </div>
                    <div className="mb-6 mt-2 p-4 bg-base-800 rounded-md text-center text-sm font-medium">
                        Library Search
                    </div>
                    <nav className="flex-1 space-y-2">
                        <div className="h-10 bg-base-800 rounded-md opacity-70"></div>
                        <div className="h-10 bg-base-800 rounded-md opacity-70"></div>
                        <div className="h-10 bg-base-800 rounded-md opacity-70"></div>
                    </nav>
                </div>
            )}
        </aside>
    );
}
