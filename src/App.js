import React from 'react';
import Header from './components/Header';
import LibraryPanel from './components/LibraryPanel';
import AIPanel from './components/AIPanel';
import MainWorkspace from './components/MainWorkspace';
import AuthScreen from './components/AuthScreen';
import { useFirebaseAuth } from './firebase/firebase';
import { useMix } from './spotify/appContext';

function App() {
  const { user, loading } = useFirebaseAuth();

  if (loading) {
    return (
      <div className="flex flex-col h-screen w-full bg-base-900 justify-center items-center font-sans">
        <div className="w-32 h-32 border-8 border-white/20 border-t-white rounded-full animate-spin shadow-lg"></div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return <AppLayout />;
}

function AppLayout() {
  const { isLibraryCollapsed, setIsLibraryCollapsed, isAICollapsed, setIsAICollapsed } = useMix();

  return (
    <div className="flex flex-col h-screen w-full bg-base-900 text-base-200 overflow-hidden font-sans">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <LibraryPanel isCollapsed={isLibraryCollapsed} setIsCollapsed={setIsLibraryCollapsed} />
        <MainWorkspace />
        <AIPanel isCollapsed={isAICollapsed} setIsCollapsed={setIsAICollapsed} />
      </div>
    </div>
  );
}

export default App;
