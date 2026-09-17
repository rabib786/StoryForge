export interface Chronicle {
  id: string;
  title: string;
  description: string;
  genre: string;
  tags: string;
  cover_url: string;
  system_instructions: string;
  opening_message: string;
  world_info: string;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

export interface Persona {
  id: string;
  name: string;
  pronouns: string;
  appearance: string;
  personality: string;
  background: string;
  traits: string;
  role: string;
  instructions: string;
  avatar_path: string;
  created_at: string;
  updated_at: string;
}

export interface StoryCharacter {
  id: string;
  chronicle_id: string;
  name: string;
  role: string;
  appearance: string;
  personality: string;
  background: string;
  goals: string;
  fears: string;
  relationships: string;
  speech_style: string;
  behavior_instructions: string;
  avatar_path: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StorySession {
  id: string;
  chronicle_id: string;
  active_persona_id?: string | null;
  title: string;
  active_provider_id: string;
  active_model_id: string;
  is_favorite: number;
  created_at: string;
  updated_at: string;
  chronicle_title?: string;
  opening_message?: string;
  genre?: string;
  cover_url?: string;
}

export interface Message {
  id: string;
  session_id: string;
  sender_type: 'user' | 'ai' | 'system' | 'narrator';
  sender_character_id?: string | null;
  sender_character_name?: string | null;
  sender_avatar_url?: string | null;
  sender_avatar_color?: string | null;
  content: string;
  is_ooc: number;
  sequence_order: number;
  created_at: string;
  updated_at: string;
  tokens_used?: number;
  generation_time_ms?: number;
  model_id?: string;
}

export interface StoryCard {
  id: string;
  chronicle_id?: string;
  title: string;
  content: string;
  category: 'lore' | 'location' | 'faction' | 'item' | 'rule';
  is_pinned: number;
  is_active: number;
  triggers?: string[];
  created_at: string;
  updated_at: string;
}

export interface Memory {
  id: string;
  chronicle_id: string;
  session_id: string;
  type: 'discovery' | 'event' | 'relationship' | 'decision' | 'fact' | 'character_state' | 'item';
  content: string;
  importance: number;
  status: 'active' | 'superseded';
  source_message_id?: string | null;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export interface ContextDiagnostic {
  systemInstructionsLength: number;
  chronicleTitle: string;
  canonLength: number;
  activePersonaName: string | null;
  storyCastCount: number;
  selectedStoryCards: Array<{
    id: string;
    title: string;
    category: string;
    isPinned: boolean;
    relevanceScore: number;
    matchedReasons: string[];
    estimatedTokens: number;
  }>;
  selectedMemories: Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    status: string;
    isPinned: boolean;
    estimatedTokens: number;
  }>;
  historyMessagesCount: number;
  estimatedTotalTokens: number;
  maxContextBudget: number;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  contextWindow: number;
}

export interface LLMProviderData {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  hasKey: boolean;
  isEnabled: number;
  models: ProviderModel[];
}

export interface AppSettings {
  [key: string]: string;
}

export interface DatabaseStats {
  chronicles: number;
  characters: number;
  chats: number;
  messages: number;
}
