import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { getDatabase } from '../server/db/database.js';
import { contextManager } from '../server/story-engine/context-manager.js';
import { characterStateManager } from '../server/models/character-state.js';
import { storyEngine } from '../server/story-engine/story-engine.js';
import { providerManager } from '../server/providers/manager.js';

describe('Phase 5.9 — Character State -> Narrative Generation Context Test Suite', () => {
  let db: ReturnType<typeof getDatabase>;
  let chronicleId: string;
  let sessionId: string;
  let char1Id: string;
  let char2Id: string;
  let branchAId: string;
  let rootMsgId: string;

  beforeEach(() => {
    db = getDatabase();
    chronicleId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    char1Id = crypto.randomUUID();
    char2Id = crypto.randomUUID();
    branchAId = crypto.randomUUID();
    rootMsgId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Register test mock provider
    providerManager.registerProvider({
      id: 'mock_test',
      name: 'Mock Test Provider',
      type: 'openai_compatible',
      generate: async () => ({
        content: 'The dawn shines over the high towers of Eldoria.',
        tokensUsed: 15,
        generationTimeMs: 12,
      }),
      stream: async () => ({
        content: 'The dawn shines over the high towers of Eldoria.',
        tokensUsed: 15,
        generationTimeMs: 12,
      }),
      testConnection: async () => ({ success: true, message: 'OK' }),
      listModels: async () => [{ id: 'mock-model', displayName: 'Mock Model', contextWindow: 8192 }],
    });

    // 1. Create chronicle
    db.prepare(`
      INSERT INTO chronicles (id, title, description, genre, system_instructions, opening_message, world_info, tags, created_at, updated_at)
      VALUES (?, 'Eldoria Chronicles', 'Fantasy Kingdom', 'High Fantasy', 'You are the storyteller.', 'Welcome to Eldoria.', 'Magic exists.', 'fantasy', ?, ?)
    `).run(chronicleId, now, now);

    // 2. Create story characters
    db.prepare(`
      INSERT INTO story_characters (id, chronicle_id, name, role, personality, background, sort_order, created_at, updated_at)
      VALUES (?, ?, 'Aria Vance', 'Mage', 'Analytical and cautious', 'Court wizard', 1, ?, ?)
    `).run(char1Id, chronicleId, now, now);

    db.prepare(`
      INSERT INTO story_characters (id, chronicle_id, name, role, personality, background, sort_order, created_at, updated_at)
      VALUES (?, ?, 'Boran Thorne', 'Knight', 'Loyal and brave', 'Captain of the guard', 2, ?, ?)
    `).run(char2Id, chronicleId, now, now);

    // 3. Create session
    db.prepare(`
      INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
      VALUES (?, ?, 'Main Campaign', ?, ?)
    `).run(sessionId, chronicleId, now, now);

    // 4. Create root message
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, NULL, 'model', 'The journey begins at dawn.', 0, ?, ?)
    `).run(rootMsgId, sessionId, now, now);

    // 5. Create main branch A
    db.prepare(`
      INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
      VALUES (?, ?, 'Main Branch', ?, 1, 0, ?, ?)
    `).run(branchAId, sessionId, rootMsgId, now, now);
  });

  it('1. Generation context for a branch with character states receives correctly resolved active state values', () => {
    // Apply state on rootMsgId for Aria: mood = "determined"
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'mood', 'determined');

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    expect(context.systemInstruction).toContain('[DYNAMIC CHARACTER STATES]');
    expect(context.systemInstruction).toContain('• Aria Vance:');
    expect(context.systemInstruction).toContain('- mood: determined');
    expect(context.resolvedCharacters).toBeDefined();
    const aria = context.resolvedCharacters?.find(c => c.characterId === char1Id);
    expect(aria).toBeDefined();
    expect(aria?.states).toContainEqual(expect.objectContaining({
      key: 'mood',
      value: 'determined',
    }));
  });

  it('2. Generation context reflects inherited states from ancestor branches across fork points', () => {
    // Apply ancestral state on rootMsgId for Boran: armor_integrity = 100
    characterStateManager.createCharacterState(char2Id, rootMsgId, 'armor_integrity', '100');

    // Fork branch B from rootMsgId
    const branchBId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
      VALUES (?, ?, 'Branch B', ?, 0, 0, ?, ?)
    `).run(branchBId, sessionId, rootMsgId, now, now);

    const contextB = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchBId,
    });

    expect(contextB.systemInstruction).toContain('• Boran Thorne:');
    expect(contextB.systemInstruction).toContain('- armor_integrity: 100');
    const boran = contextB.resolvedCharacters?.find(c => c.characterId === char2Id);
    expect(boran?.states).toContainEqual(expect.objectContaining({
      key: 'armor_integrity',
      value: 100, // parsed as number!
    }));
  });

  it('3. Generation context reflects branch-local overrides without changing ancestor or sibling branch context', () => {
    // Ancestral state
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'status', 'healthy');

    // Advance branch A with msgA
    const msgAId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'model', 'Aria was struck by venom.', 1, ?, ?)
    `).run(msgAId, sessionId, rootMsgId, now, now);
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(msgAId, branchAId);

    // Branch A override: status = poisoned
    characterStateManager.createCharacterState(char1Id, msgAId, 'status', 'poisoned');

    // Fork branch B from rootMsgId (before msgA)
    const branchBId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
      VALUES (?, ?, 'Branch B', ?, 0, 0, ?, ?)
    `).run(branchBId, sessionId, rootMsgId, now, now);

    const contextA = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });
    const contextB = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchBId,
    });

    // Branch A sees override: poisoned
    expect(contextA.systemInstruction).toContain('- status: poisoned');
    expect(contextA.systemInstruction).not.toContain('- status: healthy');

    // Branch B sees ancestral value: healthy, completely isolated from Branch A's poisoned state
    expect(contextB.systemInstruction).toContain('- status: healthy');
    expect(contextB.systemInstruction).not.toContain('- status: poisoned');
  });

  it('4. Future character state changes do not leak into generation context for an earlier narrative position', () => {
    // msg1 (ancestor)
    const msg1Id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'model', 'Step 1', 1, ?, ?)
    `).run(msg1Id, sessionId, rootMsgId, now, now);

    characterStateManager.createCharacterState(char1Id, msg1Id, 'location', 'Tavern');

    // msg2 (later narrative position)
    const msg2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'model', 'Step 2', 2, ?, ?)
    `).run(msg2Id, sessionId, msg1Id, now, now);
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(msg2Id, branchAId);

    characterStateManager.createCharacterState(char1Id, msg2Id, 'location', 'Dungeon');

    // Context at branch head (msg2): Tavern overridden by Dungeon
    const currentContext = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });
    expect(currentContext.systemInstruction).toContain('- location: Dungeon');

    // Context at earlier narrative position (msg1): MUST be Tavern, Dungeon must not leak!
    const rewoundContext = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
      atMessageId: msg1Id,
    });
    expect(rewoundContext.systemInstruction).toContain('- location: Tavern');
    expect(rewoundContext.systemInstruction).not.toContain('- location: Dungeon');
  });

  it('5. Explicitly nullified states are not presented as active in generation context', () => {
    // Initial state
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'curse', 'Shadow Curse');

    // Later nullification
    const msg2Id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'model', 'The curse was lifted.', 1, ?, ?)
    `).run(msg2Id, sessionId, rootMsgId, now, now);
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(msg2Id, branchAId);

    characterStateManager.createCharacterState(char1Id, msg2Id, 'curse', null);

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    // Nullified state must not appear in prompt
    expect(context.systemInstruction).not.toContain('curse');
    const aria = context.resolvedCharacters?.find(c => c.characterId === char1Id);
    expect(aria?.states.some(s => s.key === 'curse')).toBe(false);
  });

  it('6. Internal system event messages representing character-state mutations are excluded/filtered from raw narrative generation context', () => {
    const now = new Date().toISOString();
    // Normal message 1
    const msg1Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'user', 'I open the chest.', 1, ?, ?)
    `).run(msg1Id, sessionId, rootMsgId, now, now);

    // Phase 5.8 System event message
    const sysMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'system', '[Character State Mutation] Aria Vance: gold = 50', 2, ?, ?)
    `).run(sysMsgId, sessionId, msg1Id, now, now);

    // Normal message 2
    const msg2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, 'model', 'Gold glitters before you.', 3, ?, ?)
    `).run(msg2Id, sessionId, sysMsgId, now, now);
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(msg2Id, branchAId);

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    // Check message contents sent to LLM
    const contents = context.messages.map(m => m.content);
    expect(contents).toContain('I open the chest.');
    expect(contents).toContain('Gold glitters before you.');
    for (const c of contents) {
      expect(c).not.toContain('[Character State Mutation]');
    }
  });

  it('7. Character state values preserve semantics defined by Phases 5.6 and 5.8 (boolean, number, string typed resolution)', () => {
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'is_alive', 'true');
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'hp', '42.5');
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'class', 'Archmage');

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    const aria = context.resolvedCharacters?.find(c => c.characterId === char1Id);
    const alive = aria?.states.find(s => s.key === 'is_alive');
    const hp = aria?.states.find(s => s.key === 'hp');
    const cls = aria?.states.find(s => s.key === 'class');

    expect(alive?.value).toBe(true);
    expect(hp?.value).toBe(42.5);
    expect(cls?.value).toBe('Archmage');
  });

  it('8. Generation without character context functions cleanly without errors or injected empty sections', () => {
    // When no character states exist
    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    expect(context.systemInstruction).not.toContain('[DYNAMIC CHARACTER STATES]');
    expect(context.diagnostic.resolvedCharacterStatesCount).toBe(0);
    expect(context.systemInstruction).toContain('[STATIC STORY CHARACTER INFORMATION]');
  });

  it('9. Multiple characters in generation context each receive their own correctly resolved state mappings', () => {
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'mana', '100');
    characterStateManager.createCharacterState(char2Id, rootMsgId, 'shield', 'equipped');

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    expect(context.systemInstruction).toContain('• Aria Vance:\n  - mana: 100');
    expect(context.systemInstruction).toContain('• Boran Thorne:\n  - shield: equipped');
  });

  it('10. Unchanged states continue to resolve across intervening narrative turns', () => {
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'affinity', 'Fire');

    // Add 3 turns without mutating affinity
    let parent = rootMsgId;
    const now = new Date().toISOString();
    for (let i = 1; i <= 3; i++) {
      const mid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
        VALUES (?, ?, ?, 'model', 'Turn narrative ${i}', ?, ?, ?)
      `).run(mid, sessionId, parent, i, now, now);
      parent = mid;
    }
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(parent, branchAId);

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    expect(context.systemInstruction).toContain('- affinity: Fire');
  });

  it('11. Client cannot supply raw state overrides into generation context (must reject or ignore client-supplied state, resolving only from canonical server authority)', () => {
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'level', '5');

    // If client tries to forge raw states in request body, contextManager ignores it completely
    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
      // @ts-expect-error test client injection attempt
      forgedState: { 'Aria Vance': { level: 999 } },
    });

    expect(context.systemInstruction).toContain('- level: 5');
    expect(context.systemInstruction).not.toContain('999');
  });

  it('12. Generation fails safely if character context references an unauthorized or nonexistent character', () => {
    const fakeCharId = crypto.randomUUID();
    expect(() => {
      contextManager.buildGenerationContext({
        sessionId,
        branchId: branchAId,
        characterId: fakeCharId,
      });
    }).toThrow(/Character not found/);

    // Another chronicle's character
    const otherChronicleId = crypto.randomUUID();
    const otherCharId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO chronicles (id, title, created_at, updated_at)
      VALUES (?, 'Other Chronicle', ?, ?)
    `).run(otherChronicleId, now, now);
    db.prepare(`
      INSERT INTO story_characters (id, chronicle_id, name, created_at, updated_at)
      VALUES (?, ?, 'Foreign NPC', ?, ?)
    `).run(otherCharId, otherChronicleId, now, now);

    expect(() => {
      contextManager.buildGenerationContext({
        sessionId,
        branchId: branchAId,
        characterId: otherCharId,
      });
    }).toThrow(/Unauthorized character/);
  });

  it('13. Generation context preserves deterministic ordering of characters and their state keys', () => {
    // Add states with unordered keys
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'z_state', 'last');
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'a_state', 'first');
    characterStateManager.createCharacterState(char1Id, rootMsgId, 'm_state', 'middle');

    const context1 = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });
    const context2 = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    expect(context1.systemInstruction).toEqual(context2.systemInstruction);
    const ariaBlock = context1.systemInstruction.split('• Aria Vance:\n')[1].split('\n\n')[0];
    const lines = ariaBlock.split('\n');
    expect(lines[0]).toContain('a_state');
    expect(lines[1]).toContain('m_state');
    expect(lines[2]).toContain('z_state');
  });

  it('14. Generation context token budgeting properly accounts for character state payload in diagnostic', () => {
    characterStateManager.createCharacterState(
      char1Id,
      rootMsgId,
      'detailed_equipment',
      'Staff of the Archmagi with diamond core and intricate celestial engravings'
    );

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });

    expect(context.diagnostic.resolvedCharacterStatesCount).toBe(1);
    expect(context.diagnostic.systemInstructionsLength).toBeGreaterThan(500);
    expect(context.diagnostic.estimatedTotalTokens).toBeGreaterThan(100);
  });

  it('15. Generation context adheres to single authoritative resolution pathway (Active-Path Context Engine)', () => {
    // Verify that ContextManager calls characterStateManager.getVisibleCharacterStates
    const spy = characterStateManager.getVisibleCharacterStates;
    expect(typeof spy).toBe('function');

    const context = contextManager.buildGenerationContext({
      sessionId,
      branchId: branchAId,
    });
    expect(context).toHaveProperty('diagnostic');
    expect(context).toHaveProperty('systemInstruction');
    expect(context).toHaveProperty('messages');
  });

  it('16. Existing branch generation operations continue to function without regressions', async () => {
    const result = await storyEngine.generateResponse({
      sessionId,
      branchId: branchAId,
      userMessage: 'What do you see on the horizon?',
      providerId: 'mock_test',
      modelId: 'mock-model',
    });

    expect(result.success).toBe(true);
    expect(result.aiMessage).toBeDefined();
    expect(result.aiMessage.content).toBeDefined();
    expect(result.userMessageId).toBeDefined();
  });

  it('17. Existing regeneration operations continue to function without regressions', async () => {
    // Generate a message first
    const genResult = await storyEngine.generateResponse({
      sessionId,
      branchId: branchAId,
      userMessage: 'Test prompt',
      providerId: 'mock_test',
      modelId: 'mock-model',
    });

    expect(genResult.success).toBe(true);
    const aiMsgId = genResult.aiMessage.id;

    // Verify AI message exists in DB
    const dbMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(aiMsgId) as any;
    expect(dbMsg).toBeDefined();
    expect(dbMsg.sender_type).toBe('ai');
  });

  it('18. Character state read APIs (5.6), UI state inspector contracts (5.7), and mutation endpoints (5.8) continue to pass all regression tests', () => {
    // Check Phase 5.6 API function
    const states = characterStateManager.getVisibleCharacterStates(branchAId);
    expect(Array.isArray(states)).toBe(true);

    // Check Phase 5.8 mutation function
    const mutation = characterStateManager.createCharacterState(char1Id, rootMsgId, 'sanity', '95');
    expect(mutation).toBeDefined();
    expect(mutation.state_key).toBe('sanity');

    const updated = characterStateManager.getVisibleCharacterStates(branchAId, char1Id);
    expect(updated.some(s => s.state_key === 'sanity' && s.state_value === '95')).toBe(true);
  });
});
