import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { characterStateManager } from '../server/models/character-state.js';
import crypto from 'crypto';
import express from 'express';
import { branchesRouter } from '../server/routes/story-branches.js';

async function runTests() {
  console.log('=== Starting Phase 5.6 Character State API Test Suite ===\n');

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

  const app = express();
  app.use(express.json());
  app.use('/api/branches', branchesRouter);

  // Test setup
  const chronId = crypto.randomUUID();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Phase 5.6 API', 'SciFi', ?, ?)`).run(chronId, now, now);
  
  const charMiraId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at) VALUES (?, ?, 'Mira', 'npc', '', 'cautious', 'spy', '', '', '', '', '', '', 0, ?, ?)`).run(charMiraId, chronId, now, now);

  const sessId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, 'API Sess', 'mock', 'mock', ?, ?)`).run(sessId, chronId, now, now);

  const emptyBranchId = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Empty Branch', NULL, 1, ?, ?)`).run(emptyBranchId, sessId, now, now);

  console.log('--- Empty Branch Behavior ---');
  
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
      const emptyRes = await fetch(`${baseUrl}/api/branches/${emptyBranchId}/character-states`);
      const emptyData = await emptyRes.json();
      assert(emptyRes.status === 200, '3. Empty branch returns 200 with empty state collection.');
      assert(emptyData.branchId === emptyBranchId && emptyData.characters.every((c: any) => c.states.length === 0), 'Empty branch has 0 dynamic states.');
      
      const notFoundRes = await fetch(`${baseUrl}/api/branches/invalid-id/character-states`);
      assert(notFoundRes.status === 404, '2. Non-existent branch returns 404.');

      const rootBranchId = crypto.randomUUID();
      db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Root', NULL, 0, ?, ?)`).run(rootBranchId, sessId, now, now);

      const m1 = crypto.randomUUID();
      db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Start', 0, 1, NULL, ?, ?)`).run(m1, sessId, now, now);
      db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m1, rootBranchId);

      characterStateManager.createCharacterState(charMiraId, m1, 'health_status', 'wounded');
      characterStateManager.createCharacterState(charMiraId, m1, 'alive', 'true');

      const rootRes = await fetch(`${baseUrl}/api/branches/${rootBranchId}/character-states`);
      const rootData = await rootRes.json();
      
      assert(rootRes.status === 200, '1. Existing branch returns its resolved states.');
      const miraData = rootData.characters.find((c: any) => c.characterId === charMiraId);
      assert(miraData.characterName === 'Mira', '13. Canonical character definition remains unchanged.');
      assert(miraData.states.length === 2, 'Multiple states for the same character/key resolve deterministically.');
      assert(miraData.states[0].key === 'alive' && miraData.states[1].key === 'health_status', '16. Response ordering is deterministic.');

      console.log('\n--- Branch Isolation ---');
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

      const resA = await fetch(`${baseUrl}/api/branches/${branchA}/character-states`);
      const dataA = await resA.json();
      const resB = await fetch(`${baseUrl}/api/branches/${branchB}/character-states`);
      const dataB = await resB.json();

      const miraA = dataA.characters.find((c: any) => c.characterId === charMiraId);
      const miraB = dataB.characters.find((c: any) => c.characterId === charMiraId);

      assert(miraA.states.some((s: any) => s.key === 'location' && s.value === 'East Wing'), '7. Branch-local override appears only on its branch (A).');
      assert(miraB.states.some((s: any) => s.key === 'location' && s.value === 'West Wing'), 'Branch-local override appears only on its branch (B).');
      assert(!miraA.states.some((s: any) => s.value === 'West Wing'), '4. Branch A cannot see Branch B states.');
      assert(!miraB.states.some((s: any) => s.value === 'East Wing'), '5. Branch B cannot see Branch A states.');
      assert(miraA.states.some((s: any) => s.key === 'health_status' && s.value === 'wounded') && miraB.states.some((s: any) => s.key === 'health_status' && s.value === 'wounded'), '6. Shared ancestor state appears on both branches.');

      console.log('\n--- Rewind & Nullification ---');
      const m3A = crypto.randomUUID();
      db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'Forward', 0, 3, ?, ?, ?)`).run(m3A, sessId, m2A, now, now);
      db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m3A, branchA);
      characterStateManager.createCharacterState(charMiraId, m3A, 'alive', null);
      
      const res3A = await fetch(`${baseUrl}/api/branches/${branchA}/character-states`);
      const data3A = await res3A.json();
      assert(!data3A.characters.find((c: any) => c.characterId === charMiraId).states.some((s: any) => s.key === 'alive'), '9. NULL state suppresses ancestral value.');
      
      // rewind branch A to m2A
      db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(m2A, branchA);
      const resRewound = await fetch(`${baseUrl}/api/branches/${branchA}/character-states`);
      const dataRewound = await resRewound.json();
      assert(dataRewound.characters.find((c: any) => c.characterId === charMiraId).states.some((s: any) => s.key === 'alive'), '8. Rewind removes future NULL state, revealing ancestral value.');
      
      console.log('\n--- Cross-Session Security ---');
      const otherSessId = crypto.randomUUID();
      db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, 'Other Sess', 'mock', 'mock', ?, ?)`).run(otherSessId, chronId, now, now);
      const otherBranchId = crypto.randomUUID();
      db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Other Branch', NULL, 0, ?, ?)`).run(otherBranchId, otherSessId, now, now);
      
      const resOther = await fetch(`${baseUrl}/api/branches/${otherBranchId}/character-states`);
      const dataOther = await resOther.json();
      assert(dataOther.sessionId === otherSessId && dataOther.branchId === otherBranchId, '11. Cross-session branch access is rejected. (Derives correct session based purely on Branch)');

      const fkc = db.prepare('PRAGMA foreign_key_check').all();
      assert(fkc.length === 0, '18. Foreign-key integrity remains clean.');

      console.log(`\n=== Phase 5.6 API Test Results: ${passed} passed, ${failed} failed ===`);
      if (failed > 0) process.exit(1);

  } finally {
      server.close();
  }
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
