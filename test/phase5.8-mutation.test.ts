import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import express from 'express';
import { branchesRouter } from '../server/routes/story-branches.js';
import crypto from 'crypto';

let server: any;
let baseUrl: string;

async function runTests() {
  console.log('=== Starting Phase 5.8 Character State Mutation Test Suite ===\n');

  runMigrations();
  const db = getDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/branches', branchesRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}/api`;
      resolve();
    });
  });

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

  async function api(method: string, path: string, body?: any) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  const now = new Date().toISOString();
  
  // Setup User A (Chronicle A, Session A)
  const chronA = crypto.randomUUID();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'A', 'A', ?, ?)`).run(chronA, now, now);
  const charA = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, created_at, updated_at) VALUES (?, ?, 'Char A', ?, ?)`).run(charA, chronA, now, now);
  const sessA = crypto.randomUUID();
  db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, 'Sess A', 'p', 'm', ?, ?)`).run(sessA, chronA, now, now);
  
  const msgA1 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, 'user', '1', 0, 1, ?, ?)`).run(msgA1, sessA, now, now);
  const branchA = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Main', ?, 1, ?, ?)`).run(branchA, sessA, msgA1, now, now);

  // Setup User B (Chronicle B, Session B)
  const chronB = crypto.randomUUID();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'B', 'B', ?, ?)`).run(chronB, now, now);
  const charB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_characters (id, chronicle_id, name, created_at, updated_at) VALUES (?, ?, 'Char B', ?, ?)`).run(charB, chronB, now, now);
  const sessB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, active_provider_id, active_model_id, created_at, updated_at) VALUES (?, ?, 'Sess B', 'p', 'm', ?, ?)`).run(sessB, chronB, now, now);
  const msgB1 = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, 'user', '1', 0, 1, ?, ?)`).run(msgB1, sessB, now, now);
  const branchB = crypto.randomUUID();
  db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Main', ?, 1, ?, ?)`).run(branchB, sessB, msgB1, now, now);


  console.log('\n--- A. Successful mutation ---');
  let res = await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    stateKey: 'mood',
    value: 'angry'
  });
  assert(res.status === 201 && res.data.state.state_value === 'angry', 'Successful mutation returns 201 with state');
  
  let getRes = await api('GET', `/branches/${branchA}/character-states`);
  let found = getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'angry');
  assert(found !== undefined, 'Canonical GET resolves the newly applied state');

  console.log('\n--- B. Historical preservation ---');
  const msgA2 = crypto.randomUUID();
  // We need to fetch the branch's current head in case it was advanced by the first mutation
  let currentHeadRow = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(branchA) as any;
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', '2', 0, 2, ?, ?, ?)`).run(msgA2, sessA, currentHeadRow.head_message_id, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(msgA2, branchA);
  
  await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    stateKey: 'mood',
    value: 'happy'
  });

  const msgA3 = crypto.randomUUID();
  currentHeadRow = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(branchA) as any;
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', '3', 0, 3, ?, ?, ?)`).run(msgA3, sessA, currentHeadRow.head_message_id, now, now);
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(msgA3, branchA);

  await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    stateKey: 'mood',
    value: 'sad'
  });

  getRes = await api('GET', `/branches/${branchA}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'sad') !== undefined, 'Resolves to sad at msg3');

  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(msgA2, branchA);
  getRes = await api('GET', `/branches/${branchA}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'happy') === undefined, 'Wait, msgA2 was before happy! Rewind to msgA2 actually resolves to angry because happy was on sys_msgA2 AFTER msgA2');
  
  // To correctly rewind to 'happy', we need to rewind to sys_msgA2!
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(currentHeadRow.head_message_id, branchA);
  getRes = await api('GET', `/branches/${branchA}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'happy') !== undefined, 'Rewind to sys_msgA2 resolves to happy');

  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(msgA1, branchA);
  getRes = await api('GET', `/branches/${branchA}/character-states`);
  // wait, msgA1 was the head BEFORE the first mutation. The first mutation created a system message!
  // So at msgA1, the state should be UNDEFINED! Because the first mutation happened on sys_msgA1.
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'angry') === undefined, 'Rewind to msg1 resolves to undefined');

  // Let's test rewind to the first mutation's system message
  let firstSysRow = db.prepare('SELECT parent_message_id FROM messages WHERE id = ?').get(msgA2) as any;
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(firstSysRow.parent_message_id, branchA);
  getRes = await api('GET', `/branches/${branchA}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'angry') !== undefined, 'Rewind to sys_msgA1 resolves to angry');

  // Restore head
  currentHeadRow = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order DESC LIMIT 1').get(sessA) as any;
  db.prepare(`UPDATE story_branches SET head_message_id = ? WHERE id = ?`).run(currentHeadRow.id, branchA);

  console.log('\n--- C. Same-key update ---');
  await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    stateKey: 'mood',
    value: 'excited'
  });
  getRes = await api('GET', `/branches/${branchA}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'excited') !== undefined, 'Same-key update resolves to latest');

  console.log('\n--- D. Branch isolation & E. Fork inheritance ---');
  // Fork branchA to branchA_fork
  let forkRes = await api('POST', `/branches/${branchA}/fork`);
  const branchAFork = forkRes.data.branch.id;
  
  getRes = await api('GET', `/branches/${branchAFork}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'excited') !== undefined, 'Fork inherits parent state');

  await api('POST', `/branches/${branchAFork}/character-states`, {
    characterId: charA,
    stateKey: 'mood',
    value: 'nervous'
  });

  getRes = await api('GET', `/branches/${branchAFork}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'nervous') !== undefined, 'Child state is mutated');

  getRes = await api('GET', `/branches/${branchA}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'excited') !== undefined, 'Parent state remains unchanged');

  console.log('\n--- F. Parent-after-fork isolation ---');
  await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    stateKey: 'mood',
    value: 'calm'
  });
  getRes = await api('GET', `/branches/${branchAFork}/character-states`);
  assert(getRes.data.characters[0]?.states.find((s:any) => s.key === 'mood' && s.value === 'nervous') !== undefined, 'Child historical branch semantics remain isolated from parent updates after fork');


  console.log('\n--- H. Cross-story character ---');
  res = await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charB, // User B's character
    stateKey: 'mood',
    value: 'angry'
  });
  assert(res.status === 403, 'Cross-story character mutation fails');

  console.log('\n--- J. Invalid values ---');
  res = await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    // missing stateKey
    value: 'angry'
  });
  assert(res.status === 400, 'Missing stateKey fails');

  res = await api('POST', `/branches/${branchA}/character-states`, {
    characterId: charA,
    stateKey: 'mood'
    // missing value
  });
  assert(res.status === 400, 'Missing value fails');
  
  // Specific messageId which is NOT on branch
  const msgA_side = crypto.randomUUID();
  db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, parent_message_id, created_at, updated_at) VALUES (?, ?, 'user', 'side', 0, 2, ?, ?, ?)`).run(msgA_side, sessA, msgA1, now, now);
  
  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===`);
  server.close();
  if (failed > 0) process.exit(1);
}

runTests();
