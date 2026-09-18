import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { characterStateManager } from '../server/models/character-state.js';
import { contextManager } from '../server/story-engine/context-manager.js';
import crypto from 'crypto';

function runTests() {
  console.log('=== Starting Phase 5.2 Dynamic Character State Integration Test Suite ===\n');

  runMigrations();
  const db = getDatabase();

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

  const now = new Date().toISOString();
  
  // Setup baseline
  const chronId = crypto.randomUUID();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Phase 5.2 Chron', 'A', ?, ?)`).run(chronId, now, now);
  
  const charA = crypto.randomUUID();
  const charB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Mira', '', '', 'cautious', 'spy', '', '', '', '', '', '', 0, ?, ?)`).run(charA, chronId, now, now);
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Thorin', '', '', 'bold', 'warrior', '', '', '', '', '', '', 0, ?, ?)`).run(charB, chronId, now, now);
  
  const sessId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, 'Phase 5.2 Sess', 'p', 'm', ?, ?)`).run(sessId, chronId, now, now);
  
  const branchId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Main', NULL, 1, ?, ?)`).run(branchId, sessId, now, now);

  // M1
  const m1 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Start', 0, 1, NULL, ?, ?)`).run(m1, sessId, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m1, branchId);

  // State 1
  characterStateManager.createCharacterState(charA, m1, 'trust_player', '10');
  
  // M2
  const m2 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'ai', 'Resp', 0, 2, ?, ?, ?)`).run(m2, sessId, m1, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2, branchId);
  
  characterStateManager.createCharacterState(charA, m2, 'injured', 'true');
  characterStateManager.createCharacterState(charA, m2, 'trust_player', '40'); // override
  characterStateManager.createCharacterState(charB, m2, 'location', 'castle');

  console.log('--- 1. State Resolution & Nullification ---');
  let states = characterStateManager.getVisibleCharacterStates(branchId);
  
  let miraTrust = states.find(s => s.character_id === charA && s.state_key === 'trust_player');
  assert(miraTrust?.state_value === '40', 'Resolves latest state on active path');
  
  let miraInjured = states.find(s => s.character_id === charA && s.state_key === 'injured');
  assert(miraInjured?.state_value === 'true', 'Resolves multiple state keys independently');
  
  let thorinLoc = states.find(s => s.character_id === charB && s.state_key === 'location');
  assert(thorinLoc?.state_value === 'castle', 'Resolves multiple characters independently');

  // M3
  const m3 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Action', 0, 3, ?, ?, ?)`).run(m3, sessId, m2, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m3, branchId);

  // Nullification
  characterStateManager.createCharacterState(charA, m3, 'injured', null);
  
  states = characterStateManager.getVisibleCharacterStates(branchId);
  miraInjured = states.find(s => s.character_id === charA && s.state_key === 'injured');
  assert(miraInjured?.state_value === null, 'Handles NULL state values correctly');
  assert(states.length === 3, 'Nullification overrides older values without deleting history');

  console.log('\n--- 2. Context Integration ---');
  let ctx = contextManager.buildGenerationContext({
    sessionId: sessId,
    branchId: branchId,
    chronicleId: chronId
  });

  assert(ctx.systemInstruction.includes('NPC "Mira"'), 'ContextManager includes canonical character definitions');
  assert(ctx.systemInstruction.includes('[DYNAMIC CHARACTER STATES]'), 'ContextManager includes resolved character states');
  assert(ctx.systemInstruction.includes('- trust_player: 40'), 'Context includes latest state');
  assert(!ctx.systemInstruction.includes('- injured:'), 'Context correctly suppresses NULL state');
  assert(ctx.systemInstruction.includes('- location: castle'), 'Context includes other characters');
  
  const charDb = db.prepare('SELECT * FROM story_characters WHERE id = ?').get(charA) as any;
  assert(charDb.personality === 'cautious', 'Canonical character fields remain unchanged');

  console.log('\n--- 3. Branch Behavior & Inheritance & Isolation ---');
  // Fork branch B from m2
  const branchIdB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Branch B', ?, 0, ?, ?)`).run(branchIdB, sessId, m2, now, now);
  
  states = characterStateManager.getVisibleCharacterStates(branchIdB);
  miraTrust = states.find(s => s.character_id === charA && s.state_key === 'trust_player');
  assert(miraTrust?.state_value === '40', 'Shared ancestor state is inherited by Branch B');

  // Branch B creates new state
  const m3B = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Action B', 0, 3, ?, ?, ?)`).run(m3B, sessId, m2, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m3B, branchIdB);
  
  characterStateManager.createCharacterState(charA, m3B, 'trust_player', '90');
  
  states = characterStateManager.getVisibleCharacterStates(branchIdB);
  miraTrust = states.find(s => s.character_id === charA && s.state_key === 'trust_player');
  assert(miraTrust?.state_value === '90', 'Branch-specific state overrides shared ancestor state');
  
  let statesA = characterStateManager.getVisibleCharacterStates(branchId);
  miraTrust = statesA.find(s => s.character_id === charA && s.state_key === 'trust_player');
  assert(miraTrust?.state_value === '40', 'Branch B state is invisible to Branch A');
  
  characterStateManager.createCharacterState(charB, m3, 'location', 'forest'); // M3 is on Branch A
  let statesB = characterStateManager.getVisibleCharacterStates(branchIdB);
  thorinLoc = statesB.find(s => s.character_id === charB && s.state_key === 'location');
  assert(thorinLoc?.state_value === 'castle', 'Branch A state is invisible to Branch B');

  console.log('\n--- 4. Rewind Behavior ---');
  // Rewind Branch A to m2
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2, branchId);
  statesA = characterStateManager.getVisibleCharacterStates(branchId);
  miraInjured = statesA.find(s => s.character_id === charA && s.state_key === 'injured');
  assert(miraInjured?.state_value === 'true', 'Rewind removes future NULL state, revealing previous value');
  
  const ctxRewound = contextManager.buildGenerationContext({
    sessionId: sessId,
    branchId: branchId,
    chronicleId: chronId
  });
  assert(ctxRewound.systemInstruction.includes('- injured: true'), 'Rewind removes future state from active context');
  
  const futureState = db.prepare('SELECT state_value FROM character_states WHERE source_message_id = ? AND state_key = ?').get(m3, 'injured') as any;
  assert(futureState.state_value === null, 'Rewound state remains persisted in database');

  console.log('\n--- 5. Database Integrity ---');
  const fk = db.pragma('foreign_key_check') as any[];
  assert(fk.length === 0, 'SQLite foreign_key_check is clean');
  
  const integrity = db.pragma('integrity_check') as any[];
  assert(integrity[0].integrity_check === 'ok', 'SQLite integrity is clean');
  
  console.log(`\n=== Phase 5.2 Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests();
