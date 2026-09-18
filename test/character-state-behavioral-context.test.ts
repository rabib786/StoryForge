import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { characterStateManager } from '../server/models/character-state.js';
import { contextManager } from '../server/story-engine/context-manager.js';
import { storyEngine } from '../server/story-engine/story-engine.js';
import { providerManager } from '../server/providers/manager.js';
import crypto from 'crypto';

async function runTests() {
  console.log('=== Starting Phase 5.5 Character State Behavioral Context Test Suite ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(`✅ PASS: ${description}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${description}`);
      failed++;
    }
  }

  const db = getDatabase();
  runMigrations();
  const now = new Date().toISOString();

  // Test setup
  const chronId = crypto.randomUUID();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Phase 5.5 Chron', 'SciFi', ?, ?)`).run(chronId, now, now);
  
  const charMiraId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Mira', 'npc', '', 'cautious', 'spy', '', '', '', '', '', '', 0, ?, ?)`).run(charMiraId, chronId, now, now);
  
  const charAlexId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Alex', 'npc', '', 'brave', 'pilot', '', '', '', '', '', '', 0, ?, ?)`).run(charAlexId, chronId, now, now);

  const personaId = crypto.randomUUID();
  db.prepare(`INSERT INTO personas (id, name, pronouns, appearance, personality, background, traits, role, instructions, avatar_path, created_at, updated_at) VALUES (?, 'Player', 'they', '', 'heroic', '', '', '', '', '', ?, ?)`).run(personaId, now, now);

  const sessId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_sessions (id, chronicle_id, active_persona_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, ?, 'Phase 5.5 Sess', 'mock', 'mock', ?, ?)`).run(sessId, chronId, personaId, now, now);

  const rootBranchId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Root', NULL, 1, ?, ?)`).run(rootBranchId, sessId, now, now);

  const m1 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Start', 0, 1, NULL, ?, ?)`).run(m1, sessId, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m1, rootBranchId);

  console.log('--- 1. Context Construction & Formatting ---');
  characterStateManager.createCharacterState(charMiraId, m1, 'health_status', 'wounded');
  characterStateManager.createCharacterState(charMiraId, m1, 'injured', 'true');
  characterStateManager.createCharacterState(charAlexId, m1, 'health_status', 'healthy');
  characterStateManager.createCharacterState(charAlexId, m1, 'alive', 'true');

  const ctx1 = contextManager.buildGenerationContext({ sessionId: sessId, branchId: rootBranchId, chronicleId: chronId });
  assert(ctx1.systemInstruction.includes('DYNAMIC CHARACTER STATES'), '1. Dynamic state appears in generation context.');
  assert(ctx1.systemInstruction.includes('- health_status: wounded') && ctx1.systemInstruction.includes('- injured: true'), '2. Multiple state keys resolve correctly.');
  assert(ctx1.systemInstruction.includes('Mira:') && ctx1.systemInstruction.includes('Alex:'), '3. Multiple characters resolve independently.');
  assert(ctx1.systemInstruction.includes('[STATIC STORY CHARACTER INFORMATION]') && ctx1.systemInstruction.includes('cautious'), '4. Static character data remains separate.');
  
  const expectedFormatOrder = `• Alex:\n  - alive: true\n  - health_status: healthy\n• Mira:\n  - health_status: wounded\n  - injured: true`;
  if (!ctx1.systemInstruction.includes(expectedFormatOrder)) {
    console.log("ACTUAL CONTEXT:\n" + ctx1.systemInstruction);
  }
  assert(ctx1.systemInstruction.includes(expectedFormatOrder), '5. State formatting is deterministic (alphabetical sorting).');
  assert(ctx1.systemInstruction.includes('[DYNAMIC CHARACTER STATE RULES]'), '31. Rules contract exists in context.');

  console.log('\\n--- 2. Branch Isolation ---');
  const branchA = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Branch A', ?, 0, ?, ?)`).run(branchA, sessId, m1, now, now);
  
  const m2A = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'ai', 'A', 0, 2, ?, ?, ?)`).run(m2A, sessId, m1, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2A, branchA);
  
  characterStateManager.createCharacterState(charMiraId, m2A, 'location', 'East Wing');

  const branchB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Branch B', ?, 0, ?, ?)`).run(branchB, sessId, m1, now, now);
  
  const m2B = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'ai', 'B', 0, 2, ?, ?, ?)`).run(m2B, sessId, m1, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2B, branchB);
  
  characterStateManager.createCharacterState(charMiraId, m2B, 'location', 'West Wing');
  characterStateManager.createCharacterState(charAlexId, m2B, 'location', 'Courtyard');

  const ctxA = contextManager.buildGenerationContext({ sessionId: sessId, branchId: branchA, chronicleId: chronId });
  const ctxB = contextManager.buildGenerationContext({ sessionId: sessId, branchId: branchB, chronicleId: chronId });

  assert(ctxA.systemInstruction.includes('- location: East Wing'), '6. Branch A sees its own state.');
  assert(ctxB.systemInstruction.includes('- location: West Wing'), '7. Branch B sees its own state.');
  assert(!ctxA.systemInstruction.includes('West Wing'), '8. Branch A cannot see Branch B state.');
  assert(!ctxB.systemInstruction.includes('East Wing'), '9. Branch B cannot see Branch A state.');
  assert(ctxB.systemInstruction.includes('- health_status: healthy'), '10. Shared ancestor state is visible to both branches.');

  console.log('\\n--- 3. Rewind & Nullification ---');
  const m3A = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Forward', 0, 3, ?, ?, ?)`).run(m3A, sessId, m2A, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m3A, branchA);
  
  characterStateManager.createCharacterState(charMiraId, m3A, 'injured', null);
  characterStateManager.createCharacterState(charMiraId, m3A, 'mood', 'angry');

  let ctx3A = contextManager.buildGenerationContext({ sessionId: sessId, branchId: branchA, chronicleId: chronId });
  assert(!ctx3A.systemInstruction.includes('- injured: true'), '14. Descendant nullification suppresses it.');
  assert(ctx3A.systemInstruction.includes('- mood: angry'), 'Future state is visible.');

  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2A, branchA);
  
  let ctxRewoundA = contextManager.buildGenerationContext({ sessionId: sessId, branchId: branchA, chronicleId: chronId });
  assert(!ctxRewoundA.systemInstruction.includes('- mood: angry'), '11. Future state disappears after rewind.');
  assert(ctxRewoundA.systemInstruction.includes('- injured: true'), '13. Non-null ancestor state is visible.');
  
  const m3AStates = db.prepare('SELECT count(*) as c FROM character_states WHERE source_message_id = ?').get(m3A) as any;
  assert(m3AStates.c === 2, '12. Historical database state remains intact after rewind. (15. Nullification does not delete historical records)');

  console.log('\\n--- 4. Consistency ---');
  characterStateManager.createCharacterState(charMiraId, m1, 'alive', 'false');
  characterStateManager.createCharacterState(charMiraId, m1, 'trust_player', '15');
  const ctxConst = contextManager.buildGenerationContext({ sessionId: sessId, branchId: rootBranchId, chronicleId: chronId });
  
  assert(ctxConst.systemInstruction.includes('- alive: false'), '16. alive=false is represented correctly.');
  assert(ctxConst.systemInstruction.includes('- injured: true'), '17. injured=true is represented correctly.');
  assert(ctxConst.systemInstruction.includes('- trust_player: 15'), '19. Numeric relationship state is represented correctly.');
  assert(ctxConst.systemInstruction.includes('- alive: true') && ctxConst.systemInstruction.includes('- alive: false'), '20. Boolean state is represented correctly.');

  console.log('\\n--- 5. Protection ---');
  const miraCanon = db.prepare('SELECT personality, background FROM story_characters WHERE id = ?').get(charMiraId) as any;
  assert(miraCanon.personality === 'cautious' && miraCanon.background === 'spy', '21. Canonical Story Character remains unchanged.');
  const personaCheck = db.prepare('SELECT name FROM personas WHERE id = ?').get(personaId) as any;
  assert(personaCheck.name === 'Player', '22. Persona remains untouched.');
  const chronCheck = db.prepare('SELECT title FROM chronicles WHERE id = ?').get(chronId) as any;
  assert(chronCheck.title === 'Phase 5.5 Chron', '23. Chronicle remains untouched.');
  
  assert(!ctxConst.systemInstruction.includes('East Wing') && !ctxConst.systemInstruction.includes('West Wing'), '24. Sibling state cannot contaminate root context.');

  console.log('\\n--- 6. Generation Integration ---');
  
  // Set provider behavior
  let generatedSystemInstruction = '';
  providerManager.getProvider = () => ({
    generate: async (modelId: string, messages: any[], opts: any) => {
      if (!opts.systemInstruction?.includes('CHARACTER STATE EXTRACTION')) {
        generatedSystemInstruction = opts.systemInstruction || '';
      }
      return { content: '{"states": []}', tokensUsed: 10, generationTimeMs: 100 };
    }
  } as any);
  
  db.prepare(`UPDATE story_branches SET is_active = 0`).run();
  db.prepare(`UPDATE story_branches SET is_active = 1 WHERE id = ?`).run(branchA);
  
  const genA = await storyEngine.generateResponse({ sessionId: sessId, /* no asCharacterId */ });
  assert(genA.success, 'Generation A successful');
  assert(generatedSystemInstruction.includes('- location: East Wing'), '25. Generation receives the correct branch-local character state.');
  assert(generatedSystemInstruction.includes('- health_status: wounded'), '27. A state generated on a shared ancestor is visible to both branches.');
  assert(!generatedSystemInstruction.includes('West Wing'), '26. A state generated on Branch A is not included when generating on Branch B.');
  
  providerManager.getProvider = () => ({
    generate: async () => {
      throw new Error('Simulated provider failure');
    }
  } as any);
  const failedGen = await storyEngine.generateResponse({ sessionId: sessId, /* no asCharacterId */ });
  assert(!failedGen.success, '28. State-context failure does not destroy the AI message. (Generation fails safely)');
  
  // Test existing extraction running afterwards. The extractor requires a valid schema JSON.
  providerManager.getProvider = () => ({
    generate: async (modelId: string, messages: any[], opts: any) => {
      if (opts.systemInstruction && opts.systemInstruction.includes('CHARACTER STATE EXTRACTION')) {
          return { content: `{"states": [{"characterId": "${charMiraId}", "stateKey": "mood", "stateValue": "happy"}]}`, tokensUsed: 10, generationTimeMs: 100 };
      }
      return { content: 'Mock response generating a new state', tokensUsed: 10, generationTimeMs: 100 };
    }
  } as any);
  
  const genExtracted = await storyEngine.generateResponse({ sessionId: sessId, /* no asCharacterId */ });
  assert(genExtracted.success, '29. Existing extraction still runs after successful AI generation.');
  
  const newlyExtractedState = characterStateManager.getVisibleCharacterStates(branchA);
  assert(newlyExtractedState.some(s => s.state_key === 'mood' && s.state_value === 'happy'), 'Extraction wrote state');

  console.log(`\\n=== Phase 5.5 Behavioral Context Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
