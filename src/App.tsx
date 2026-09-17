import React, { useState, useEffect } from 'react';
import { AppHeader } from './components/AppHeader';
import { BottomNav, NavTab } from './components/BottomNav';
import { HomeScreen } from './components/HomeScreen';
import { ChroniclesLibrary } from './components/ChroniclesLibrary';
import { ChronicleStudio } from './components/ChronicleStudio';
import { PersonaManager } from './components/PersonaManager';
import { SessionView } from './components/SessionView';
import { SettingsScreen } from './components/SettingsScreen';
import { Chronicle, Persona, StorySession } from './types';
import { api } from './services/api';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [chronicles, setChronicles] = useState<Chronicle[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [recentSessions, setRecentSessions] = useState<StorySession[]>([]);
  const [activeProviderName, setActiveProviderName] = useState('Gemini 2.5 Flash');

  // Deep view states
  const [activeStoryChronicleId, setActiveStoryChronicleId] = useState<string | null>(null);
  const [activeSessionViewId, setActiveSessionViewId] = useState<string | null>(null);
  const [editingChronicleId, setEditingChronicleId] = useState<string | null | undefined>(undefined);

  // Load chronicles and personas
  const loadData = async () => {
    try {
      const [scRes, pRes, provRes] = await Promise.all([
        api.getChronicles(),
        api.getPersonas(),
        api.getProviders().catch(() => ({ activeModelId: 'gemini-2.5-flash' })),
      ]);
      setChronicles(scRes.chronicles);
      setPersonas(pRes.personas);
      if (provRes && 'activeModelId' in provRes) {
        setActiveProviderName(provRes.activeModelId);
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handlers
  const handleOpenStory = (chronicleId: string, sessionId?: string) => {
    setActiveStoryChronicleId(chronicleId);
    setActiveSessionViewId(sessionId || null);
    setEditingChronicleId(undefined);
  };

  const handleEditChronicle = (chronicleId: string) => {
    setEditingChronicleId(chronicleId);
    setActiveStoryChronicleId(null);
  };

  const handleNewStory = () => {
    setEditingChronicleId(null); // null means create new
    setActiveStoryChronicleId(null);
  };

  const handleToggleFavorite = async (chronicleId: string) => {
    try {
      const res = await api.toggleFavorite(chronicleId);
      setChronicles((prev) =>
        prev.map((s) => (s.id === chronicleId ? { ...s, is_favorite: res.is_favorite } : s))
      );
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // If user is inside the SessionView reading experience
  if (activeStoryChronicleId) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
        <SessionView
          chronicleId={activeStoryChronicleId}
          sessionId={activeSessionViewId || undefined}
          personas={personas}
          onBack={() => {
            setActiveStoryChronicleId(null);
            setActiveSessionViewId(null);
            loadData();
          }}
        />
      </div>
    );
  }

  // If user is creating or editing a chronicle
  if (editingChronicleId !== undefined) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200 pb-12">
        <AppHeader
          title={editingChronicleId ? 'Edit Chronicle' : 'New Chronicle'}
          activeProviderName={activeProviderName}
          onNavigateHome={() => setEditingChronicleId(undefined)}
        />
        <main className="flex-1 flex flex-col">
          <ChronicleStudio
            chronicleId={editingChronicleId}
            onBack={() => setEditingChronicleId(undefined)}
            onSaved={(savedChronicle) => {
              setEditingChronicleId(undefined);
              loadData();
              handleOpenStory(savedChronicle.id);
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200 pb-20">
      {/* App Header */}
      <AppHeader
        title={
          currentTab === 'home'
            ? 'Home'
            : currentTab === 'stories'
            ? 'Chronicle Library'
            : currentTab === 'personas'
            ? 'Personas'
            : 'Settings'
        }
        activeProviderName={activeProviderName}
        onNavigateHome={() => setCurrentTab('home')}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        {currentTab === 'home' && (
          <HomeScreen
            chronicles={chronicles}
            recentSessions={recentSessions}
            onOpenStory={handleOpenStory}
            onNewStory={handleNewStory}
            onNewPersona={() => setCurrentTab('personas')}
            onOpenSettings={() => setCurrentTab('settings')}
            onToggleFavorite={handleToggleFavorite}
            onViewAllStories={() => setCurrentTab('stories')}
          />
        )}

        {currentTab === 'stories' && (
          <ChroniclesLibrary
            chronicles={chronicles}
            onOpenStory={handleOpenStory}
            onEditChronicle={handleEditChronicle}
            onNewStory={handleNewStory}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {currentTab === 'personas' && (
          <PersonaManager
            personas={personas}
            onRefresh={loadData}
          />
        )}

        {currentTab === 'settings' && <SettingsScreen />}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setEditingChronicleId(undefined);
          setActiveStoryChronicleId(null);
          setCurrentTab(tab);
        }}
      />
    </div>
  );
}
