import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { storyEngine, generationLocks } from '../server/story-engine/story-engine.js';
import { memoryEngine } from '../server/story-engine/memory-engine.js';
import { contextManager } from '../server/story-engine/context-manager.js';
import { providerManager } from '../server/providers/manager.js';
import express from 'express';
import { branchesRouter } from '../server/routes/story-branches.js';
import { sessionsRouter } from '../server/routes/story-sessions.js';
import crypto from 'crypto';

let server: any;
let baseUrl: string;

async function runTests() {
  console.log('=== Starting Phase 4.3 Branch API Test Suite ===\n');

  runMigrations();
  const db = getDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/branches', branchesRouter);
  app.use('/api/sessions', sessionsRouter);

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

  // Helper
  async function api(method: string, path: string, body?: any) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  // Setup Chronicle
  const chronId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Test Chron', 'SciFi', ?, ?)`).run(chronId, now, now);

  try {
    console.log('--- 1. Branch Lifecycle ---');
    let res = await api('POST', '/sessions', { chronicle_id: chronId, title: 'Test Sess' });
    const sessionId = res.data.session.id;
    assert(res.status === 201, 'Session created');

    res = await api('GET', `/sessions/${sessionId}/branches`);
    let branches = res.data.branches;
    assert(branches.length === 1 && branches[0].name === 'Main Timeline', 'Main Timeline exists');
    const b1Id = branches[0].id;

    res = await api('PUT', `/branches/${b1Id}`, { name: 'Renamed Timeline' });
    assert(res.data.branch.name === 'Renamed Timeline', 'Branch renamed');

    res = await api('POST', `/branches/${b1Id}/fork`, {});
    assert(res.status === 201, 'Alternate branch created');
    const b2Id = res.data.branch.id;

    res = await api('GET', `/sessions/${sessionId}/branches`);
    branches = res.data.branches;
    assert(branches.length === 2, 'Two branches exist');
    const activeCount = branches.filter((b: any) => b.is_active).length;
    assert(activeCount === 1, 'Exactly one active branch exists');
    assert(branches.find((b:any) => b.id === b2Id).is_active === 1, 'New branch is active');

    res = await api('PUT', `/branches/${b1Id}/active`);
    assert(res.status === 200, 'Branch 1 activated');
    const branchesAfterAct = (await api('GET', `/sessions/${sessionId}/branches`)).data.branches;
    assert(branchesAfterAct.find((b:any)=>b.id===b1Id).is_active === 1, 'B1 is active');
    assert(branchesAfterAct.find((b:any)=>b.id===b2Id).is_active === 0, 'B2 is inactive');

    res = await api('DELETE', `/branches/${b2Id}`);
    assert(res.status === 200, 'Inactive branch deleted');
    const branchesAfterDel = (await api('GET', `/sessions/${sessionId}/branches`)).data.branches;
    assert(branchesAfterDel.length === 1, 'Branch deleted');

    console.log('\n--- 2. Fork Isolation & Shared Ancestry ---');
    // We'll create M1..M5 on B1, fork, create M6A, M6B
    function createMsg(id: string, parentId: string|null, content: string) {
      db.prepare(`INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, ?, 'ai', ?, 0, 1, ?, ?)`).run(id, sessionId, parentId, content, now, now);
    }
    const m1 = crypto.randomUUID(); createMsg(m1, null, 'M1');
    const m2 = crypto.randomUUID(); createMsg(m2, m1, 'M2');
    const m3 = crypto.randomUUID(); createMsg(m3, m2, 'M3');
    const m4 = crypto.randomUUID(); createMsg(m4, m3, 'M4');
    const m5 = crypto.randomUUID(); createMsg(m5, m4, 'M5');
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m5, b1Id);

    // Fork at M5
    res = await api('POST', `/branches/${b1Id}/fork`, { messageId: m5, name: 'Branch B' });
    const branchBId = res.data.branch.id;
    
    const m6a = crypto.randomUUID(); createMsg(m6a, m5, 'M6A');
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m6a, b1Id);
    const m6b = crypto.randomUUID(); createMsg(m6b, m5, 'M6B');
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m6b, branchBId);

    const ctxA = contextManager.prepareContext({ sessionId, branchId: b1Id, chronicleId: chronId });
    const ctxB = contextManager.prepareContext({ sessionId, branchId: branchBId, chronicleId: chronId });

    assert(ctxA.messages.map(m=>m.content).includes('M6A'), 'Branch A sees M6A');
    assert(!ctxA.messages.map(m=>m.content).includes('M6B'), 'Branch A does not see M6B');
    assert(ctxB.messages.map(m=>m.content).includes('M6B'), 'Branch B sees M6B');
    assert(!ctxB.messages.map(m=>m.content).includes('M6A'), 'Branch B does not see M6A');
    
    assert(ctxA.messages.map(m=>m.content).includes('M5'), 'Branch A shares M5');
    assert(ctxB.messages.map(m=>m.content).includes('M5'), 'Branch B shares M5');

    console.log('\n--- 3. Memory & Supersession Isolation ---');
    memoryEngine.createMemory({ sessionId, content: 'Mem A', sourceMessageId: m6a });
    memoryEngine.createMemory({ sessionId, content: 'Shared Mem', sourceMessageId: m5 });
    
    const memsA = memoryEngine.retrieveRelevantMemories({ sessionId, branchId: b1Id, chronicleId: chronId });
    const memsB = memoryEngine.retrieveRelevantMemories({ sessionId, branchId: branchBId, chronicleId: chronId });
    
    assert(memsA.allActiveMemories.some(m=>m.content === 'Mem A'), 'Branch A sees Mem A');
    assert(!memsB.allActiveMemories.some(m=>m.content === 'Mem A'), 'Branch B does not see Mem A');
    assert(memsA.allActiveMemories.some(m=>m.content === 'Shared Mem'), 'Branch A inherits shared mem');
    assert(memsB.allActiveMemories.some(m=>m.content === 'Shared Mem'), 'Branch B inherits shared mem');

    const oldMem = memoryEngine.createMemory({ sessionId, content: 'Mira trusts Alex.', sourceMessageId: m4 });
    const newMem = memoryEngine.createMemory({ sessionId, content: 'Mira hates Alex.', sourceMessageId: m6a });
    db.prepare('INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), newMem.id, oldMem.id, now);

    const checkMemsA = memoryEngine.retrieveRelevantMemories({ sessionId, branchId: b1Id, chronicleId: chronId });
    const checkMemsB = memoryEngine.retrieveRelevantMemories({ sessionId, branchId: branchBId, chronicleId: chronId });

    assert(checkMemsA.allActiveMemories.some(m=>m.content === 'Mira hates Alex.'), 'Branch A suppresses old mem');
    assert(!checkMemsA.allActiveMemories.some(m=>m.content === 'Mira trusts Alex.'), 'Branch A suppresses old mem correctly');
    assert(checkMemsB.allActiveMemories.some(m=>m.content === 'Mira trusts Alex.'), 'Branch B still sees original mem');

    console.log('\n--- 4. Rewind ---');
    res = await api('POST', `/branches/${branchBId}/rewind`, { targetMessageId: m2 });
    assert(res.status === 200, 'Rewind succeeds');
    assert(res.data.branch.head_message_id === m2, 'Active head = M2');
    
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(sessionId) as any;
    assert(msgCount.c > 2, 'M3/M4/M5 still exist');
    
    const archBranches = db.prepare("SELECT * FROM story_branches WHERE session_id = ? AND is_archived = 1 AND name = 'Auto-Save: Before Rewind'").all(sessionId) as any[];
    assert(archBranches.length === 1 && archBranches[0].head_message_id === m6b, 'Auto-save branch points to M6B');

    const m3b = crypto.randomUUID(); createMsg(m3b, m2, 'M3B');
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m3b, branchBId);
    const ctxB2 = contextManager.prepareContext({ sessionId, branchId: branchBId, chronicleId: chronId });
    assert(ctxB2.messages.map(m=>m.content).includes('M3B'), 'New path is M1 -> M2 -> M3B');
    assert(!ctxB2.messages.map(m=>m.content).includes('M3'), 'Old M3 not in path');

    console.log('\n--- 5. Edit ---');
    res = await api('POST', `/branches/${b1Id}/messages/${m3}/edit`, { content: 'M3 Edited' });
    assert(res.status === 200, 'Edit succeeds');
    const newHeadId = res.data.message.id;
    assert(res.data.message.content === 'M3 Edited', 'Message edited');
    const originalM3 = db.prepare('SELECT * FROM messages WHERE id = ?').get(m3) as any;
    assert(originalM3.content === 'M3', 'Original message remains unchanged');
    assert(res.data.message.parent_message_id === m2, 'Edited message has same parent');
    const checkB1 = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(b1Id) as any;
    assert(checkB1.head_message_id === newHeadId, 'Active branch moved to edited node');

    console.log('\n--- 6. Regeneration ---');
    providerManager.getProvider = () => ({
      generate: async () => { return { content: 'Regen AI', tokensUsed: 10, generationTimeMs: 100 }; }
    } as any);
    
    res = await api('POST', `/branches/${b1Id}/messages/${newHeadId}/regenerate`);
    if (res.status !== 200) console.log(res.data); assert(res.status === 200, 'Leaf regenerate succeeds');
    assert(res.data.message.content === 'Regen AI', 'Content updated');
    assert(res.data.message.id === newHeadId, 'Message ID unchanged');
    
    const genCount = db.prepare('SELECT COUNT(*) as c FROM message_generations WHERE message_id = ?').get(newHeadId) as any;
    assert(genCount.c === 1, 'Generation count increased');

    // Regenerate ancestor
    res = await api('POST', `/branches/${b1Id}/messages/${m2}/regenerate`);
    assert(res.status === 200, 'Ancestor regenerate succeeds');
    const ancestorRegenId = res.data.message.id;
    assert(ancestorRegenId !== m2, 'Ancestor regen created sibling');
    const checkB1_2 = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(b1Id) as any;
    assert(checkB1_2.head_message_id === ancestorRegenId, 'Branch moved to new sibling');
    const originalM2 = db.prepare('SELECT * FROM messages WHERE id = ?').get(m2) as any;
    assert(originalM2.content === 'M2', 'Original ancestor unchanged');

    console.log('\n--- 7. Cross-Session Security ---');
    const chronId2 = crypto.randomUUID();
    db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Test Chron2', 'SciFi', ?, ?)`).run(chronId2, now, now);
    const sess2 = (await api('POST', '/sessions', { chronicle_id: chronId2 })).data.session.id;
    const sess2Branch = (await api('GET', `/sessions/${sess2}/branches`)).data.branches[0].id;
    
    res = await api('POST', `/branches/${sess2Branch}/fork`, { messageId: m2 });
    assert(res.status === 400, 'Fork with msg from another session rejected');
    res = await api('POST', `/branches/${sess2Branch}/rewind`, { targetMessageId: m2 });
    assert(res.status === 400, 'Rewind to msg from another session rejected');
    res = await api('POST', `/branches/${sess2Branch}/messages/${m2}/edit`, { content: 'Hi' });
    assert(res.status === 400, 'Edit msg from another session rejected');
    res = await api('POST', `/branches/${sess2Branch}/messages/${m2}/regenerate`);
    assert(res.status === 400, 'Regen msg from another session rejected');

    console.log('\n--- 8. Concurrency / Stale Head ---');
    providerManager.getProvider = () => ({
      generate: async () => {
        const dummy = crypto.randomUUID();
        db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, 'ai', 'Stale', 0, 1, ?, ?)`).run(dummy, sess2, now, now);
        db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(dummy, sess2Branch);
        return { content: 'Stale AI', tokensUsed: 10, generationTimeMs: 100 };
      }
    } as any);
    
    // Create an initial msg for sess2Branch
    const mSess2 = crypto.randomUUID();
    db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, 'ai', 'A', 0, 1, ?, ?)`).run(mSess2, sess2, now, now);
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(mSess2, sess2Branch);

    res = await api('POST', `/branches/${sess2Branch}/messages/${mSess2}/regenerate`);
    if (res.status !== 409) console.log(res); assert(res.status === 409, 'Stale request failed safely');

    console.log('\n--- 9. Database Integrity ---');
    const fkCheck = db.pragma('foreign_key_check') as any[];
    assert(fkCheck.length === 0, 'foreign_key_check = 0 errors');
    const integrityCheck = db.pragma('integrity_check') as any[];
    assert(integrityCheck[0].integrity_check === 'ok', 'integrity_check = ok');

  } catch (e) {
    console.error(e);
  } finally {
    server.close();
  }

  console.log(`\n=== Branch API Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
