import { getDatabase } from '../db/database.js';
import { GenerationMessage } from '../providers/types.js';
import { storyCardEngine, ScoredStoryCard } from './story-card-engine.js';
import { memoryEngine, ScoredMemory } from './memory-engine.js';
import { characterStateManager } from '../models/character-state.js';
import { parseTypedStateValue } from '../models/character-state-schema.js';

export interface StoryContextInput {
  sessionId: string;
  branchId?: string;
  chronicleId?: string;
  userMessage?: string;
  isOoc?: boolean;
  maxTotalTokens?: number;
  atMessageId?: string;
  characterId?: string;
  characterIds?: string[];
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
  resolvedCharacterStatesCount?: number;
}

export interface ResolvedCharacterStateItem {
  key: string;
  value: string | number | boolean;
  rawValue: string;
  sourceMessageId?: string;
  updatedAt?: string;
}

export interface ResolvedCharacterContext {
  characterId: string;
  characterName: string;
  role?: string;
  personality?: string;
  background?: string;
  states: ResolvedCharacterStateItem[];
}

export interface PreparedContext {
  systemInstruction: string;
  messages: GenerationMessage[];
  chronicleTitle: string;
  diagnostic: ContextDiagnostic;
  resolvedCharacters?: ResolvedCharacterContext[];
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

    if (input.characterId) {
      const char = db.prepare('SELECT id, chronicle_id FROM story_characters WHERE id = ?').get(input.characterId) as any;
      if (!char) {
        throw new Error(`Character not found: ${input.characterId}`);
      }
      if (char.chronicle_id !== derivedChronicleId) {
        throw new Error(`Unauthorized character: ${input.characterId} does not belong to chronicle ${derivedChronicleId}`);
      }
    }
    if (input.characterIds && input.characterIds.length > 0) {
      for (const cid of input.characterIds) {
        const char = db.prepare('SELECT id, chronicle_id FROM story_characters WHERE id = ?').get(cid) as any;
        if (!char) {
          throw new Error(`Character not found: ${cid}`);
        }
        if (char.chronicle_id !== derivedChronicleId) {
          throw new Error(`Unauthorized character: ${cid} does not belong to chronicle ${derivedChronicleId}`);
        }
      }
    }

    // 5. Resolve Branch and Load Raw Session Messages for history
    let branchId = input.branchId;
    if (!branchId) {
      const activeBranch = db.prepare(`SELECT id FROM story_branches WHERE session_id = ? AND is_active = 1`).get(input.sessionId) as { id: string } | undefined;
      if (!activeBranch) {
        throw new Error(`No active branch found for session ${input.sessionId}`);
      }
      branchId = activeBranch.id;
    }

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as { id: string, session_id: string, head_message_id: string | null } | undefined;
    if (!branch) {
      throw new Error(`Story branch not found: ${branchId}`);
    }

    if (branch.session_id !== input.sessionId) {
      throw new Error(`Branch ${branchId} does not belong to session ${input.sessionId}`);
    }

    const narrativePositionId = input.atMessageId || branch.head_message_id;
    if (input.atMessageId && branch.head_message_id && input.atMessageId !== branch.head_message_id) {
      const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(input.atMessageId) as any;
      if (!msg || msg.session_id !== input.sessionId) {
        throw new Error(`Message ${input.atMessageId} does not belong to session ${input.sessionId}`);
      }
    }

    let rawMessages: Array<{
      id: string;
      sender_type: string;
      content: string;
      is_ooc: number;
      created_at: string;
    }> = [];

    if (narrativePositionId) {
      rawMessages = db.prepare(`
        WITH RECURSIVE path(depth, id, parent_message_id, sender_type, content, is_ooc, created_at) AS (
            SELECT
                0,
                id,
                parent_message_id,
                sender_type,
                content,
                is_ooc,
                created_at
            FROM messages
            WHERE id = ?
            
            UNION ALL
            
            SELECT
                p.depth + 1,
                m.id,
                m.parent_message_id,
                m.sender_type,
                m.content,
                m.is_ooc,
                m.created_at
            FROM messages m
            JOIN path p
                ON m.id = p.parent_message_id
        )
        SELECT id, sender_type, content, is_ooc, created_at
        FROM path
        ORDER BY depth DESC;
      `).all(narrativePositionId) as any;
    }

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
      branchId: branchId,
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
      systemParts.push(`[STATIC STORY CHARACTER INFORMATION]\nYou control these characters:\n${charBlock}`);
    }

    // [4.1] DYNAMIC CHARACTER STATES
    const visibleStates = characterStateManager.getVisibleCharacterStates(branchId, input.characterId, narrativePositionId || undefined);

    // Group active states by character
    const stateMap = new Map<string, Array<{ key: string; value: any; rawValue: string; sourceMessageId?: string; updatedAt?: string }>>();
    for (const state of visibleStates) {
      if (state.state_value !== null) {
        if (!stateMap.has(state.character_id)) stateMap.set(state.character_id, []);
        const typedVal = parseTypedStateValue(state.state_key, state.state_value);
        stateMap.get(state.character_id)!.push({
          key: state.state_key,
          value: typedVal,
          rawValue: state.state_value,
          sourceMessageId: state.source_message_id,
          updatedAt: state.updated_at,
        });
      }
    }

    // Determine characters to represent
    let relevantStoryCharacters = [...storyCharacters];
    if (input.characterIds && input.characterIds.length > 0) {
      relevantStoryCharacters = storyCharacters.filter(c => input.characterIds!.includes(c.id));
    } else if (input.characterId) {
      relevantStoryCharacters = storyCharacters.filter(c => c.id === input.characterId);
    }

    // Sort characters deterministically: sort_order ASC, name ASC, id ASC
    relevantStoryCharacters.sort((a, b) => {
      const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      const nameDiff = a.name.localeCompare(b.name);
      if (nameDiff !== 0) return nameDiff;
      return a.id.localeCompare(b.id);
    });

    const resolvedCharacters: ResolvedCharacterContext[] = [];
    for (const char of relevantStoryCharacters) {
      const rawStates = stateMap.get(char.id) || [];
      // Deterministically sort state keys by key ASC
      rawStates.sort((a, b) => a.key.localeCompare(b.key));
      resolvedCharacters.push({
        characterId: char.id,
        characterName: char.name,
        role: char.role,
        personality: char.personality,
        background: char.background,
        states: rawStates.map(s => ({
          key: s.key,
          value: s.value,
          rawValue: s.rawValue,
          sourceMessageId: s.sourceMessageId,
          updatedAt: s.updatedAt,
        })),
      });
    }

    const charsWithState = resolvedCharacters.filter(c => c.states.length > 0);

    if (charsWithState.length > 0) {
      let stateBlock = `[DYNAMIC CHARACTER STATES]\nThe following states reflect timeline-specific facts for the current story branch:\n`;
      for (const char of charsWithState) {
        const stateLines = char.states.map(s => `  - ${s.key}: ${s.value}`).join('\n');
        stateBlock += `• ${char.characterName}:\n${stateLines}\n`;
      }
      stateBlock += `\n\n[DYNAMIC CHARACTER STATE RULES]\n` +
        `Dynamic character states represent the current narrative reality of the active timeline.\n` +
        `Treat these states as established facts unless the current narrative explicitly changes them.\n` +
        `Do not silently contradict an established state.\n` +
        `Do not invent state changes that did not occur in the narrative.\n` +
        `A state may change only as a consequence of the current story.\n` +
        `Dynamic state applies only to the characters and timeline represented in the current context.\n` +
        `Do not transfer state information from another branch or timeline.\n` +
        `Canonical character information remains distinct from dynamic state.`;
        
      systemParts.push(stateBlock.trim());
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

        // Phase 5.9: Filter out internal system events such as Phase 5.8 [Character State Mutation]
        if (m.sender_type === 'system' || m.content.startsWith('[Character State Mutation]')) {
          continue;
        }

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
      resolvedCharacterStatesCount: charsWithState.reduce((acc, c) => acc + c.states.length, 0),
    };

    return {
      systemInstruction,
      messages,
      chronicleTitle: chronicle.title,
      diagnostic,
      resolvedCharacters,
    };
  }
}

export const contextManager = new ContextManager();
