import { validateAndNormalizeStateValue, CHARACTER_STATE_SCHEMA } from '../server/models/character-state-schema.js';
import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import crypto from 'crypto';

function runTests() {
  console.log('=== Starting Phase 5.4 Character State Semantics Test Suite ===\n');

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

  console.log('--- 1. Schema Metadata ---');
  assert(CHARACTER_STATE_SCHEMA['injured'] !== undefined, 'every supported key has metadata (injured)');
  assert(CHARACTER_STATE_SCHEMA['trust_player'] !== undefined, 'every supported key has metadata (trust_player)');
  assert(CHARACTER_STATE_SCHEMA['location'] !== undefined, 'every supported key has metadata (location)');

  console.log('\\n--- 2. Value-Type Validation & Normalization ---');
  let res = validateAndNormalizeStateValue('unknown_key', 'true');
  assert(!res.isValid && res.error === 'Unknown state key', 'invalid key rejected');

  res = validateAndNormalizeStateValue('injured', 'banana');
  assert(!res.isValid && res.error === 'Invalid boolean value', 'unsupported type rejected (boolean)');

  res = validateAndNormalizeStateValue('injured', 'true');
  assert(res.isValid && res.normalizedValue === 'true', 'valid boolean accepted');

  res = validateAndNormalizeStateValue('trust_player', 'banana');
  assert(!res.isValid && res.error === 'Invalid numeric value', 'unsupported type rejected (number)');

  res = validateAndNormalizeStateValue('trust_player', '150');
  assert(!res.isValid && res.error === 'Value above maximum 100', 'invalid numeric range rejected (above max)');

  res = validateAndNormalizeStateValue('trust_player', '-10');
  assert(!res.isValid && res.error === 'Value below minimum 0', 'invalid numeric range rejected (below min)');

  res = validateAndNormalizeStateValue('trust_player', '80');
  assert(res.isValid && res.normalizedValue === '80', 'valid number accepted');

  const bigString = 'a'.repeat(300);
  res = validateAndNormalizeStateValue('mood', bigString);
  assert(!res.isValid && res.error!.includes('exceeds max length'), 'oversized value rejected');

  res = validateAndNormalizeStateValue('mood', 'happy');
  assert(res.isValid && res.normalizedValue === 'happy', 'valid string accepted');

  console.log('\\n--- 3. NULL Semantics ---');
  res = validateAndNormalizeStateValue('injured', null);
  assert(res.isValid && res.normalizedValue === undefined, 'NULL accepted where allowed (nullable=true)');

  res = validateAndNormalizeStateValue('alive', null);
  assert(!res.isValid && res.error === 'State key cannot be nullified', 'NULL rejected where not allowed (nullable=false)');

  console.log(`\\n=== Phase 5.4 Semantics Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests();

async function runIntegration() {
  console.log('\\n--- 4. Resolution & Engine Integration ---');
  const db = getDatabase();
  runMigrations();
  const now = new Date().toISOString();
  
  const chronId = crypto.randomUUID();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Phase 5.4 Chron', 'A', ?, ?)`).run(chronId, now, now);
  const charA = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Mira', '', '', 'cautious', 'spy', '', '', '', '', '', '', 0, ?, ?)`).run(charA, chronId, now, now);
  
  const sessId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, 'Phase 5.4 Sess', 'mock', 'mock', ?, ?)`).run(sessId, chronId, now, now);
  
  const branchId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Main', NULL, 1, ?, ?)`).run(branchId, sessId, now, now);

  const m1 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Start', 0, 1, NULL, ?, ?)`).run(m1, sessId, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m1, branchId);
  
  const { characterStateManager } = await import('../server/models/character-state.js');
  const { contextManager } = await import('../server/story-engine/context-manager.js');
  
  characterStateManager.createCharacterState(charA, m1, 'health_status', 'healthy');
  characterStateManager.createCharacterState(charA, m1, 'trust_player', '50');
  
  let states = characterStateManager.getVisibleCharacterStates(branchId);
  if (states.length === 2) console.log('✅ PASS: States resolved'); else { console.error('❌ FAIL: States resolved'); process.exit(1); }
  
  const m2 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'ai', 'Resp', 0, 2, ?, ?, ?)`).run(m2, sessId, m1, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2, branchId);
  
  characterStateManager.createCharacterState(charA, m2, 'health_status', 'wounded');
  characterStateManager.createCharacterState(charA, m2, 'trust_player', null);
  
  states = characterStateManager.getVisibleCharacterStates(branchId);
  if (states.find(s => s.state_key === 'health_status')?.state_value === 'wounded') console.log('✅ PASS: latest state wins'); else { console.error('❌ FAIL: latest state wins'); process.exit(1); }
  if (states.find(s => s.state_key === 'trust_player')?.state_value === null) console.log('✅ PASS: NULL suppresses previous state'); else { console.error('❌ FAIL: NULL suppresses previous state'); process.exit(1); }
  
  const ctx = contextManager.buildGenerationContext({ sessionId: sessId, branchId, chronicleId: chronId });
  if (ctx.systemInstruction.includes('STATIC STORY CHARACTER INFORMATION')) console.log('✅ PASS: static character fields remain separate'); else { console.error('❌ FAIL: static character fields remain separate'); process.exit(1); }
  if (ctx.systemInstruction.includes('DYNAMIC CHARACTER STATES')) console.log('✅ PASS: dynamic state appears in context'); else { console.error('❌ FAIL: dynamic state appears in context'); process.exit(1); }
  if (ctx.systemInstruction.includes('- health_status: wounded')) console.log('✅ PASS: resolved values only'); else { console.error('❌ FAIL: resolved values only'); process.exit(1); }
  if (!ctx.systemInstruction.includes('- trust_player:')) console.log('✅ PASS: NULL state is hidden from context'); else { console.error('❌ FAIL: NULL state is hidden from context'); process.exit(1); }
  
  const charB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Jon', '', '', 'brave', '', '', '', '', '', '', '', 0, ?, ?)`).run(charB, chronId, now, now);
  characterStateManager.createCharacterState(charB, m2, 'location', 'courtyard');
  const ctx2 = contextManager.buildGenerationContext({ sessionId: sessId, branchId, chronicleId: chronId });
  if (ctx2.systemInstruction.includes('- location: courtyard')) console.log('✅ PASS: multiple characters supported in context'); else { console.error('❌ FAIL: multiple characters'); process.exit(1); }

  const branchB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Branch B', ?, 0, ?, ?)`).run(branchB, sessId, m1, now, now);
  const statesB = characterStateManager.getVisibleCharacterStates(branchB);
  if (statesB.find(s => s.state_key === 'health_status')?.state_value === 'healthy') console.log('✅ PASS: shared ancestor inheritance'); else { console.error('❌ FAIL: shared ancestor'); process.exit(1); }
  if (!statesB.find(s => s.state_key === 'location')) console.log('✅ PASS: branch isolation / hidden branch state absent'); else { console.error('❌ FAIL: isolation'); process.exit(1); }
  
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m1, branchId);
  const statesRewind = characterStateManager.getVisibleCharacterStates(branchId);
  if (statesRewind.find(s => s.state_key === 'health_status')?.state_value === 'healthy') console.log('✅ PASS: rewind visibility'); else { console.error('❌ FAIL: rewind'); process.exit(1); }

  const m3Count = db.prepare('SELECT count(*) as c FROM character_states WHERE source_message_id = ?').get(m2) as {c: number};
  if (m3Count.c === 3) console.log('✅ PASS: historical events remain'); else { console.error('❌ FAIL: history destroyed'); process.exit(1); }
}

runIntegration().catch(console.error);
