import { getDatabase } from '../db/database.js';
import { GenerationMessage } from '../providers/types.js';
import { storyCardEngine, ScoredStoryCard } from './story-card-engine.js';
import { memoryEngine, ScoredMemory } from './memory-engine.js';

export interface StoryContextInput {
  sessionId: string;
  chronicleId?: string;
  userMessage?: string;
  isOoc?: boolean;
  maxTotalTokens?: number;
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

export interface PreparedContext {
  systemInstruction: string;
  messages: GenerationMessage[];
  chronicleTitle: string;
  diagnostic: ContextDiagnostic;
}

export class ContextManager {
  /**
   * Builds full deterministic generation context following Context Builder V2 architecture:
   * System Directives -> Chronicle & Canon -> Active Persona -> Story Cast ->
   * Relevant Story Cards -> Relevant Memories -> Recent History -> Current Input
   */
  prepareContext(input: StoryContextInput): PreparedContext {
    return this.buildGenerationContext(input);
  }

  buildGenerationContext(input: StoryContextInput): PreparedContext {
    const db = getDatabase();
    const maxBudget = input.maxTotalTokens ?? 8192;

    // 1. Fetch Session FIRST to establish canonical trust root & ownership
    const session = db.prepare(`
      SELECT * FROM story_sessions WHERE id = ?
    `).get(input.sessionId) as {
      id: string;
      chronicle_id: string;
      title: string;
      active_persona_id: string | null;
    } | undefined;

    if (!session) {
      throw new Error(`Story session not found: ${input.sessionId}`);
    }

    // 2. Reject mismatch if caller supplied a differing chronicleId
    if (input.chronicleId && input.chronicleId !== session.chronicle_id) {
      throw new Error(`Chronicle ownership mismatch: session belongs to chronicle ${session.chronicle_id}, not ${input.chronicleId}`);
    }

    const derivedChronicleId = session.chronicle_id;

    // 3. Fetch Chronicle (Canon & Settings) using verified derivedChronicleId
    const chronicle = db.prepare(`
      SELECT * FROM chronicles WHERE id = ?
    `).get(derivedChronicleId) as {
      id: string;
      title: string;
      description: string;
      genre: string;
      system_instructions: string;
      opening_message: string;
      world_info: string;
      tags: string;
    } | undefined;

    if (!chronicle) {
      throw new Error(`Chronicle not found: ${derivedChronicleId}`);
    }

    let personaName: string | null = null;
    let personaDesc = '';
    if (session.active_persona_id) {
      const persona = db.prepare(`
        SELECT * FROM personas WHERE id = ?
      `).get(session.active_persona_id) as any;
      if (persona) {
        personaName = persona.name;
        personaDesc = `[ACTIVE PLAYER PERSONA: ${persona.name}]\n` +
          `The human user plays as this character. Never generate internal monologue or decisions for them.\n` +
          `${persona.pronouns ? `Pronouns: ${persona.pronouns}\n` : ''}` +
          `${persona.role ? `Role / Archetype: ${persona.role}\n` : ''}` +
          `${persona.appearance ? `Appearance: ${persona.appearance}\n` : ''}` +
          `${persona.personality ? `Personality: ${persona.personality}\n` : ''}` +
          `${persona.background ? `Background: ${persona.background}\n` : ''}` +
          `${persona.traits ? `Traits: ${persona.traits}\n` : ''}` +
          `${persona.instructions ? `Special Directives: ${persona.instructions}\n` : ''}`;
      }
    }

    // 4. Fetch Story Cast (NPCs owned strictly by this Chronicle)
    const storyCharacters = db.prepare(`
      SELECT * FROM story_characters WHERE chronicle_id = ? ORDER BY sort_order ASC, name ASC
    `).all(derivedChronicleId) as Array<any>;

    // 5. Load Raw Session Messages for history and trigger matching
    const rawMessages = db.prepare(`
      SELECT id, sender_type, content, is_ooc, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY sequence_order ASC, created_at ASC
    `).all(input.sessionId) as Array<{
      id: string;
      sender_type: string;
      content: string;
      is_ooc: number;
      created_at: string;
    }>;

    // Concatenate recent messages to serve as trigger reference
    const recentSampleForTriggers = rawMessages.slice(-8).map((m) => m.content).join(' ');

    // 6. Retrieve Relevant Story Cards (Chronicle-owned & budget-bounded)
    const { selectedCards } = storyCardEngine.retrieveRelevantCards({
      chronicleId: derivedChronicleId,
      userMessage: input.userMessage,
      recentHistoryText: recentSampleForTriggers,
      maxTokenBudget: 1500,
    });

    // 7. Retrieve Relevant Memories (Session-owned & budget-bounded)
    const { selectedMemories } = memoryEngine.retrieveRelevantMemories({
      chronicleId: derivedChronicleId,
      sessionId: input.sessionId,
      maxTokenBudget: 1200,
    });

    // 7. Assemble Structured System Instruction in Deterministic Priority Order
    const systemParts: string[] = [];

    // [1] CORE AI OWNERSHIP MODEL
    systemParts.push(
      `[CORE ROLEPLAY & STORYTELLING DIRECTIVE]\n` +
      `You are the narrative engine for StoryForge.\n` +
      `You are responsible for narration, world presentation, NPC behavior, NPC dialogue, consequences, and environmental reactions.\n` +
      `CRITICAL RULE: The PLAYER PERSONA is controlled entirely by the user.\n` +
      `You MUST NOT invent the player's intentional actions, thoughts, feelings, dialogue, or decisions unless explicitly requested.\n` +
      `You may describe the environment around the player, the reactions of NPCs, sounds, discoveries, and consequences, but DO NOT act on behalf of the player.\n` +
      `Story Characters (NPCs) are controlled by you, the narrative engine.\n` +
      `Respect Chronicle Canon. Do not contradict established facts unless the user explicitly changes the canon.\n` +
      `Maintain continuity with the Session history.\n` +
      `Write immersive interactive fiction rather than explaining the roleplay system to the user.`
    );

    // [2] CHRONICLE SETTING & CANON
    if (chronicle.genre) {
      systemParts.push(`[CHRONICLE GENRE & TONE]\n${chronicle.genre}`);
    }

    const chronicleBlock = [
      `[CHRONICLE SETTING & WORLD CANON]`,
      `Title: ${chronicle.title}`,
      chronicle.description ? `Premise: ${chronicle.description}` : null,
      chronicle.world_info ? `Authoritative World Canon:\n${chronicle.world_info}` : null,
      chronicle.system_instructions ? `Storyteller Directives:\n${chronicle.system_instructions}` : null,
    ].filter(Boolean).join('\n');

    if (chronicleBlock.length > 20) {
      systemParts.push(chronicleBlock);
    }

    // [3] ACTIVE PLAYER PERSONA
    if (personaDesc) {
      systemParts.push(personaDesc);
    }

    // [4] STORY CAST / NPCS
    if (storyCharacters.length > 0) {
      const charBlock = storyCharacters.map((c) =>
        `• NPC "${c.name}"${c.title ? ` (${c.title})` : ''}: Role: ${c.role || 'ai'}, Personality: ${c.personality || 'Unknown'}, Background: ${c.background || 'None'}, Speech Style: ${c.speech_style || 'Natural'}, Instructions: ${c.behavior_instructions || ''}`
      ).join('\n');
      systemParts.push(`[STORY CAST / NPCS]\nYou control these characters:\n${charBlock}`);
    }

    // [5] RELEVANT STORY CARDS (Retrieved Lore)
    if (selectedCards.length > 0) {
      const cardTexts = selectedCards.map((sc) =>
        `• [CARD: ${sc.card.title}] (${sc.card.category})\n${sc.card.content}`
      ).join('\n\n');
      systemParts.push(`[ACTIVE STORY CARDS / CONTEXTUAL LORE]\nThese specific lore elements are active for this scene:\n${cardTexts}`);
    }

    // [6] RELEVANT MEMORIES (Durable Session Facts)
    if (selectedMemories.length > 0) {
      const memoryTexts = selectedMemories.map((sm) =>
        `• (${sm.memory.type.toUpperCase()}) ${sm.memory.content}`
      ).join('\n');
      systemParts.push(`[DURABLE SESSION MEMORIES]\nFacts and developments established earlier in this story session:\n${memoryTexts}`);
    }

    // [7] FORMATTING CONVENTIONS
    systemParts.push(
      `[FORMATTING CONVENTIONS]\n` +
      `- Write vivid narrative prose using quotation marks for spoken dialogue ("...") and descriptive text for actions.\n` +
      `- If the user writes out-of-character using double parentheses ((like this)), address their OOC question briefly in ((OOC: ...)) while continuing the narrative.`
    );

    const systemInstruction = systemParts.join('\n\n');

    // 8. Session History Assembly & Context Budget Control
    // Calculate system tokens
    const systemTokenEst = Math.ceil(systemInstruction.length / 4);
    // Reserve 1200 tokens for generation output + user input buffer
    const availableForHistory = Math.max(800, maxBudget - systemTokenEst - 1200);

    const messages: GenerationMessage[] = [];

    if (rawMessages.length === 0 && chronicle.opening_message) {
      messages.push({
        role: 'model',
        content: chronicle.opening_message,
      });
    } else {
      // Start from the most recent messages and walk backwards until token budget is met
      const reversedSelected: GenerationMessage[] = [];
      let historyTokensUsed = 0;

      for (let i = rawMessages.length - 1; i >= 0; i--) {
        const m = rawMessages[i];
        const content = m.is_ooc ? `((OOC: ${m.content}))` : m.content;
        const msgTokens = Math.ceil(content.length / 4);

        if (historyTokensUsed + msgTokens > availableForHistory && reversedSelected.length >= 4) {
          // Budget reached and we have at least 4 recent messages
          break;
        }

        reversedSelected.unshift({
          role: m.sender_type === 'user' ? 'user' : 'model',
          content,
        });
        historyTokensUsed += msgTokens;
      }

      messages.push(...reversedSelected);
    }

    // Current player input (always appended)
    if (input.userMessage) {
      messages.push({
        role: 'user',
        content: input.isOoc ? `((OOC: ${input.userMessage}))` : input.userMessage,
      });
    }

    // 9. Compute Diagnostic Context
    const totalEstimatedTokens =
      systemTokenEst +
      messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);

    const diagnostic: ContextDiagnostic = {
      systemInstructionsLength: systemInstruction.length,
      chronicleTitle: chronicle.title,
      canonLength: (chronicle.world_info || '').length,
      activePersonaName: personaName,
      storyCastCount: storyCharacters.length,
      selectedStoryCards: selectedCards.map((sc) => ({
        id: sc.card.id,
        title: sc.card.title,
        category: sc.card.category,
        isPinned: !!sc.card.is_pinned,
        relevanceScore: sc.relevanceScore,
        matchedReasons: sc.matchedReasons,
        estimatedTokens: sc.estimatedTokens,
      })),
      selectedMemories: selectedMemories.map((sm) => ({
        id: sm.memory.id,
        type: sm.memory.type,
        content: sm.memory.content,
        importance: sm.memory.importance,
        status: sm.memory.status,
        isPinned: !!sm.memory.is_pinned,
        estimatedTokens: sm.estimatedTokens,
      })),
      historyMessagesCount: messages.length,
      estimatedTotalTokens: totalEstimatedTokens,
      maxContextBudget: maxBudget,
    };

    return {
      systemInstruction,
      messages,
      chronicleTitle: chronicle.title,
      diagnostic,
    };
  }
}

export const contextManager = new ContextManager();
