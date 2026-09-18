import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { contextManager } from '../server/story-engine/context-manager.js';
import { memoryEngine } from '../server/story-engine/memory-engine.js';
import { storyEngine } from '../server/story-engine/story-engine.js';
import crypto from 'crypto';

async function runTests() {
  console.log('=== Starting Phase 4.2 Engine Migration Test Suite ===\n');

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

  function createTestSession() {
    const chronicleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Test Chron', 'SciFi', ?, ?)`).run(chronicleId, now, now);
    db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at) VALUES (?, ?, 'Test Session', ?, ?)`).run(sessionId, chronicleId, now, now);
    return { chronicleId, sessionId };
  }

  function createBranch(sessionId: string, headMsgId: string | null, isActive: boolean = false) {
    const branchId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Test Branch', ?, ?, ?, ?)`).run(branchId, sessionId, headMsgId, isActive ? 1 : 0, now, now);
    return branchId;
  }
  
  function insertMessage(id: string, sessionId: string, parentId: string | null, content: string) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, ?, 'ai', ?, 0, 1, ?, ?)`).run(id, sessionId, parentId, content, now, now);
  }

  try {
    console.log('--- Test C — Context follows ancestry ---');
    const c1 = createTestSession();
    const b1 = createBranch(c1.sessionId, null, true);
    const m1 = crypto.randomUUID(); insertMessage(m1, c1.sessionId, null, 'Msg 1');
    const m2 = crypto.randomUUID(); insertMessage(m2, c1.sessionId, m1, 'Msg 2');
    const m3 = crypto.randomUUID(); insertMessage(m3, c1.sessionId, m2, 'Msg 3');
    const mSibling = crypto.randomUUID(); insertMessage(mSibling, c1.sessionId, m2, 'Sibling');
    
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m3, b1);
    
    const ctx = contextManager.prepareContext({ sessionId: c1.sessionId, branchId: b1, chronicleId: c1.chronicleId });
    const contentList = ctx.messages.map(m => m.content);
    assert(contentList.includes('Msg 1'), 'Context includes M1');
    assert(contentList.includes('Msg 2'), 'Context includes M2');
    assert(contentList.includes('Msg 3'), 'Context includes M3');
    assert(!contentList.includes('Sibling'), 'Context excludes sibling');
    
    console.log('\n--- Test D — Sibling isolation ---');
    const bA = b1; // using active branch for A
    const bB = createBranch(c1.sessionId, mSibling, false);
    
    const ctxA = contextManager.prepareContext({ sessionId: c1.sessionId, branchId: bA, chronicleId: c1.chronicleId });
    const ctxB = contextManager.prepareContext({ sessionId: c1.sessionId, branchId: bB, chronicleId: c1.chronicleId });
    
    assert(ctxA.messages.map(m => m.content).includes('Msg 3'), 'Branch A sees M3');
    assert(!ctxA.messages.map(m => m.content).includes('Sibling'), 'Branch A isolated from Sibling');
    
    assert(ctxB.messages.map(m => m.content).includes('Sibling'), 'Branch B sees Sibling');
    assert(!ctxB.messages.map(m => m.content).includes('Msg 3'), 'Branch B isolated from M3');

    console.log('\n--- Test E — Memory branch isolation ---');
    memoryEngine.createMemory({ sessionId: c1.sessionId, content: 'Mem A', sourceMessageId: m3 });
    memoryEngine.createMemory({ sessionId: c1.sessionId, content: 'Mem B', sourceMessageId: mSibling });
    
    const memsA = memoryEngine.retrieveRelevantMemories({ sessionId: c1.sessionId, branchId: bA, chronicleId: c1.chronicleId });
    const memsB = memoryEngine.retrieveRelevantMemories({ sessionId: c1.sessionId, branchId: bB, chronicleId: c1.chronicleId });
    
    assert(memsA.allActiveMemories.some(m => m.content === 'Mem A'), 'Branch A sees Mem A');
    assert(!memsA.allActiveMemories.some(m => m.content === 'Mem B'), 'Branch A does not see Mem B');
    assert(memsB.allActiveMemories.some(m => m.content === 'Mem B'), 'Branch B sees Mem B');
    assert(!memsB.allActiveMemories.some(m => m.content === 'Mem A'), 'Branch B does not see Mem A');

    console.log('\n--- Test F — Ancestor memory inheritance ---');
    memoryEngine.createMemory({ sessionId: c1.sessionId, content: 'Mem Root', sourceMessageId: m1 });
    const memsARoot = memoryEngine.retrieveRelevantMemories({ sessionId: c1.sessionId, branchId: bA, chronicleId: c1.chronicleId });
    assert(memsARoot.allActiveMemories.some(m => m.content === 'Mem Root'), 'Branch A sees ancestor memory');

    console.log('\n--- Test G — Branch-specific supersession ---');
    const oldMem = memoryEngine.createMemory({ sessionId: c1.sessionId, content: 'Old Mem', sourceMessageId: m2 });
    const newMem = memoryEngine.createMemory({ sessionId: c1.sessionId, content: 'New Mem A', sourceMessageId: m3 });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), newMem.id, oldMem.id, now);
    
    const supersessionCheckA = memoryEngine.retrieveRelevantMemories({ sessionId: c1.sessionId, branchId: bA, chronicleId: c1.chronicleId });
    const supersessionCheckB = memoryEngine.retrieveRelevantMemories({ sessionId: c1.sessionId, branchId: bB, chronicleId: c1.chronicleId });
    
    assert(!supersessionCheckA.allActiveMemories.some(m => m.content === 'Old Mem'), 'Branch A hides superseded memory');
    assert(supersessionCheckA.allActiveMemories.some(m => m.content === 'New Mem A'), 'Branch A sees new memory');
    assert(supersessionCheckB.allActiveMemories.some(m => m.content === 'Old Mem'), 'Branch B still sees original memory');

  } catch (e) {
    console.error(e);
  }

  console.log(`\n=== Engine Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
