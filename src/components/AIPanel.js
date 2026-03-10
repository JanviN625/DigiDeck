import React, { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

export default function AIPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <aside className={`${isCollapsed ? 'w-16' : 'w-72'} bg-base-900 border-l border-base-700 flex flex-col shrink-0 transition-all duration-300 relative overflow-hidden`}>
            {isCollapsed ? (
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button
                        onClick={() => setIsCollapsed(false)}
                        title="Expand AI Panel"
                        className="p-1.5 rounded hover:bg-base-800 transition-colors"
                    >
                        <Sparkles className="text-base-700 hover:text-base-200 transition-colors" size={24} />
                    </button>
                </div>
            ) : (
                <div className="p-4 flex flex-col h-full w-72 shrink-0 transition-opacity duration-300">
                    <div className="flex justify-between items-center mb-3">
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
                    </div>

                    <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
                        {/* Empty Slate for Future AI Features */}
                    </div>
                </div>
            )}
        </aside>
    );
}
