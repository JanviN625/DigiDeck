import React, { useState } from 'react';
import { ChevronRight, Sparkles, RefreshCw } from 'lucide-react';

export default function AIPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [suggestions] = useState(
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(letter => ({
            id: letter,
            name: `Track ${letter}`,
            bpm: '[BPM]',
            key: '[Key]',
            match: "100" // Default variable value for later use
        }))
    );

    return (
        <aside className={`${isCollapsed ? 'w-16' : 'w-72'} bg-base-900 border-l border-base-700 flex flex-col shrink-0 transition-all duration-300 relative overflow-hidden`}>
            {isCollapsed ? (
                <div className="flex flex-col items-center py-6 w-full h-full">
                    <button
                        onClick={() => setIsCollapsed(false)}
                        title="Expand AI Recommendations"
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

                    <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1">
                        <div className="text-xs font-semibold text-base-400 uppercase tracking-wider mb-2">Based on your current mix:</div>

                        {suggestions.map((suggestion) => (
                            <div key={suggestion.id} className="bg-base-800 p-3 rounded-lg border border-base-700 hover:border-base-400 transition-colors cursor-pointer group shadow-sm hover:shadow-md">
                                <div className="flex justify-between items-start mb-1">
                                    <div className="text-sm font-bold text-base-50 group-hover:text-base-50">{suggestion.name}</div>
                                    <div className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">{suggestion.match}% Match</div>
                                </div>
                                <div className="text-xs text-base-300 mb-2">{suggestion.bpm} • {suggestion.key}</div>
                                <div className="flex flex-col gap-2 mt-3">
                                    <button className="text-xs bg-base-900 text-base-100 px-2 py-1.5 rounded hover:bg-base-600 hover:text-base-50 transition-colors w-full border border-base-700">Preview</button>
                                    <button className="text-xs font-semibold bg-base-500 text-base-50 px-2 py-1.5 rounded hover:bg-base-400 transition-colors w-full shadow-sm">+ Add to New Track</button>
                                </div>
                            </div>
                        ))}

                        <button className="flex items-center justify-center gap-2 w-full py-3 mt-4 text-xs font-bold text-base-300 hover:text-base-100 bg-base-900 border border-base-700 hover:border-base-500 rounded-lg transition-colors group">
                            <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
                            Refresh Suggestions
                        </button>
                    </div>
                </div>
            )}
        </aside>
    );
}
