import {
  Chronicle,
  Persona, StoryCharacter,
  StorySession,
  Message,
  StoryCard,
  Memory,
  ContextDiagnostic,
  LLMProviderData,
  AppSettings,
  DatabaseStats,
} from '../types';

export const api = {
  // Story Personas
  async getStoryCharacters(chronicle_id: string): Promise<{ storyCharacters: StoryCharacter[] }> {
    const res = await fetch(`/api/story-personas?chronicle_id=${chronicle_id}`);
    if (!res.ok) throw new Error('Failed to load story personas');
    return res.json();
  },
  async createStoryCharacter(data: Partial<StoryCharacter>): Promise<{ storyCharacter: StoryCharacter }> {
    const res = await fetch('/api/story-personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create story persona');
    return res.json();
  },
  async updateStoryCharacter(id: string, data: Partial<StoryCharacter>): Promise<{ storyCharacter: StoryCharacter }> {
    const res = await fetch(`/api/story-personas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update story persona');
    return res.json();
  },
  async deleteStoryCharacter(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/story-personas/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete story persona');
    return res.json();
  },

  // Chronicles
  async getChronicles(params?: { favorite?: boolean; search?: string; genre?: string }): Promise<{ chronicles: Chronicle[] }> {
    const query = new URLSearchParams();
    if (params?.favorite) query.set('favorite', 'true');
    if (params?.search) query.set('search', params.search);
    if (params?.genre) query.set('genre', params.genre);
    const res = await fetch(`/api/chronicles?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch chronicles');
    return res.json();
  },

  async getChronicle(id: string): Promise<{
    chronicle: Chronicle;
    personas: Persona[];
    storyCharacters: StoryCharacter[];
    sessions: StorySession[];
    storyCards: StoryCard[];
  }> {
    const res = await fetch(`/api/chronicles/${id}`);
    if (!res.ok) throw new Error('Failed to load chronicle details');
    return res.json();
  },

  async createChronicle(data: Partial<Chronicle> & { story_character_ids?: string[] }): Promise<{ chronicle: Chronicle }> {
    const res = await fetch('/api/chronicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create chronicle' }));
      throw new Error(err.error || 'Failed to create chronicle');
    }
    return res.json();
  },

  async updateChronicle(id: string, data: Partial<Chronicle> & { story_character_ids?: string[] }): Promise<{ chronicle: Chronicle }> {
    const res = await fetch(`/api/chronicles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update chronicle');
    return res.json();
  },

  async toggleFavorite(id: string): Promise<{ is_favorite: number }> {
    const res = await fetch(`/api/chronicles/${id}/favorite`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to toggle favorite');
    return res.json();
  },

  async deleteChronicle(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/chronicles/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete chronicle');
    return res.json();
  },

  // Personas
  async getPersonas(params?: { is_user?: boolean; search?: string }): Promise<{ personas: Persona[] }> {
    const query = new URLSearchParams();
    if (params?.is_user !== undefined) query.set('is_user', params.is_user ? '1' : '0');
    if (params?.search) query.set('search', params.search);
    const res = await fetch(`/api/personas?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to load personas');
    return res.json();
  },

  async createPersona(data: Partial<Persona>): Promise<{ persona: Persona }> {
    const res = await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create persona');
    return res.json();
  },

  async updatePersona(id: string, data: Partial<Persona>): Promise<{ persona: Persona }> {
    const res = await fetch(`/api/personas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update persona');
    return res.json();
  },

  async deletePersona(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/personas/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete persona');
    return res.json();
  },

  // Chats & Messages
  async getSession(id: string): Promise<{
    session: StorySession;
    messages: Message[];
    storyCharacters: StoryCharacter[];
  }> {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) throw new Error('Failed to load session chronicle');
    return res.json();
  },

  async createSession(chronicle_id: string, title?: string, active_persona_id?: string): Promise<{ session: StorySession }> {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chronicle_id, title, active_persona_id }),
    });
    if (!res.ok) throw new Error('Failed to create session session');
    return res.json();
  },

  async editMessage(sessionId: string, messageId: string, content: string): Promise<{ message: Message }> {
    const res = await fetch(`/api/sessions/${sessionId}/messages/${messageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Failed to edit message');
    return res.json();
  },

  async deleteMessage(sessionId: string, messageId: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/sessions/${sessionId}/messages/${messageId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete message');
    return res.json();
  },

  // Story Cards
  async getStoryCards(chronicleId: string): Promise<{ storyCards: StoryCard[] }> {
    const res = await fetch(`/api/story-cards/chronicle/${chronicleId}`);
    if (!res.ok) throw new Error('Failed to load story cards');
    return res.json();
  },

  async createStoryCard(data: {
    chronicle_id: string;
    title: string;
    content: string;
    category?: 'lore' | 'location' | 'faction' | 'item' | 'rule';
    is_pinned?: boolean;
    is_active?: boolean;
    triggers?: string[];
  }): Promise<{ storyCard: StoryCard }> {
    const res = await fetch('/api/story-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create story card');
    return res.json();
  },

  async updateStoryCard(id: string, data: Partial<StoryCard>): Promise<{ storyCard: StoryCard }> {
    const res = await fetch(`/api/story-cards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update story card');
    return res.json();
  },

  async toggleStoryCardPinned(id: string): Promise<{ storyCard: StoryCard }> {
    const res = await fetch(`/api/story-cards/${id}/toggle-pinned`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to toggle story card pinned status');
    return res.json();
  },

  async deleteStoryCard(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/story-cards/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete story card');
    return res.json();
  },

  // Memories
  async getSessionMemories(sessionId: string, chronicleId?: string): Promise<{ memories: Memory[] }> {
    const query = chronicleId ? `?chronicleId=${chronicleId}` : '';
    const res = await fetch(`/api/memories/session/${sessionId}${query}`);
    if (!res.ok) throw new Error('Failed to load session memories');
    return res.json();
  },

  async createMemory(data: {
    chronicle_id: string;
    session_id: string;
    type?: string;
    content: string;
    importance?: number;
    is_pinned?: boolean;
  }): Promise<{ memory: Memory }> {
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create memory');
    return res.json();
  },

  async deleteMemory(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete memory');
    return res.json();
  },

  // Context Diagnostics
  async inspectContext(sessionId: string, chronicleId: string, userMessage?: string): Promise<{
    diagnostic: ContextDiagnostic;
    systemInstruction: string;
    messagesCount: number;
  }> {
    const query = new URLSearchParams({ sessionId, chronicleId });
    if (userMessage) query.set('userMessage', userMessage);
    const res = await fetch(`/api/story/inspect-context?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to inspect context');
    return res.json();
  },

  // Story Generation
  async generateStory(options: {
    sessionId: string;
    chronicleId: string;
    userMessage?: string;
    isOoc?: boolean;
    providerId?: string;
    modelId?: string;
  }): Promise<{
    success: boolean;
    userMessageId?: string;
    aiMessage?: Message;
    diagnostic?: ContextDiagnostic;
    memoriesExtracted?: number;
    error?: string;
  }> {
    const res = await fetch('/api/story/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    const data = await res.json();
    if (!res.ok && !data.error) {
      throw new Error('Network error generating story response');
    }
    return data;
  },

  // Providers
  async getProviders(): Promise<{
    providers: LLMProviderData[];
    activeProviderId: string;
    activeModelId: string;
  }> {
    const res = await fetch('/api/providers');
    if (!res.ok) throw new Error('Failed to load providers');
    return res.json();
  },

  async testProvider(providerId: string, options?: { apiKey?: string; baseUrl?: string }): Promise<{
    success: boolean;
    message: string;
  }> {
    const res = await fetch(`/api/providers/${providerId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
    return res.json();
  },

  // Settings
  async getSettings(): Promise<{
    settings: AppSettings;
    stats: DatabaseStats;
    hasGeminiApiKey: boolean;
  }> {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Failed to load settings');
    return res.json();
  },

  async updateSettings(settings: Record<string, string>): Promise<{ success: boolean }> {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to save settings');
    return res.json();
  },

  async downloadBackup(): Promise<void> {
    const res = await fetch('/api/settings/backup', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to generate backup');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storyforge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
};
