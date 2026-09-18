import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { storyEngine, generationLocks } from '../server/story-engine/story-engine.js';
import { providerManager } from '../server/providers/manager.js';
import express from 'express';
import { branchesRouter } from '../server/routes/story-branches.js';
import { sessionsRouter } from '../server/routes/story-sessions.js';
import { storyRouter } from '../server/routes/story.js';
import crypto from 'crypto';

let server: any;
let baseUrl: string;

async function runTests() {
  console.log('=== Starting Phase 4.4 Frontend Integration Test Suite ===\n');

  runMigrations();
  const db = getDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/branches', branchesRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/story', storyRouter);

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

  // Setup Chronicle
  const chronId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Phase 4.4', 'Test', ?, ?)`).run(chronId, now, now);

  try {
    // 1. Empty Branch
    console.log('--- 1. Empty Branch Integration ---');
    let res = await api('POST', '/sessions', { chronicle_id: chronId, title: 'Empty Sess' });
    const sessionId = res.data.session.id;
    let branches = (await api('GET', `/sessions/${sessionId}/branches`)).data.branches;
    const branchId = branches[0].id;
    
    // First message generation on empty branch
    providerManager.getProvider = () => ({
      generate: async () => ({ content: 'Hello World', tokensUsed: 10, generationTimeMs: 100 })
    } as any);

    res = await api('POST', '/story/generate', { sessionId, branchId, chronicleId: chronId, userMessage: 'Start' });
    assert(res.status === 200, 'Generation on empty branch succeeds');
    
    const sessAfter = (await api('GET', `/sessions/${sessionId}`)).data;
    assert(sessAfter.messages.length === 2, 'Session has 2 messages (user + ai)');
    const bAfter = (await api('GET', `/sessions/${sessionId}/branches`)).data.branches[0];
    assert(bAfter.head_message_id !== null, 'Branch head was established');
    assert(bAfter.head_message_id === sessAfter.messages[1].id, 'Branch head points to AI message');

    // 2. Isolation
    console.log('\n--- 2. Branch Isolation ---');
    const b1Id = bAfter.id;
    const m1 = sessAfter.messages[0].id;
    const m2 = sessAfter.messages[1].id;
    
    res = await api('POST', `/branches/${b1Id}/fork`, { messageId: m2, name: 'Branch B' });
    const b2Id = res.data.branch.id;
    
    // Switch to Branch A and generate
    await api('PUT', `/branches/${b1Id}/active`);
    providerManager.getProvider = () => ({ generate: async () => ({ content: 'A3', tokensUsed: 10, generationTimeMs: 100 }) } as any);
    await api('POST', '/story/generate', { sessionId, branchId: b1Id, chronicleId: chronId, userMessage: 'Go A' });

    // Switch to Branch B and generate
    await api('PUT', `/branches/${b2Id}/active`);
    providerManager.getProvider = () => ({ generate: async () => ({ content: 'B3', tokensUsed: 10, generationTimeMs: 100 }) } as any);
    await api('POST', '/story/generate', { sessionId, branchId: b2Id, chronicleId: chronId, userMessage: 'Go B' });
    
    // Verify isolation via active path
    await api('PUT', `/branches/${b1Id}/active`);
    let pathA = (await api('GET', `/sessions/${sessionId}`)).data.messages;
    
    await api('PUT', `/branches/${b2Id}/active`);
    let pathB = (await api('GET', `/sessions/${sessionId}`)).data.messages;
    
    const contentA = pathA.map((m: any) => m.content);
    const contentB = pathB.map((m: any) => m.content);
    
    assert(contentA.includes('A3'), 'Branch A contains A3');
    assert(!contentA.includes('B3'), 'Branch A does NOT contain B3');
    assert(contentB.includes('B3'), 'Branch B contains B3');
    assert(!contentB.includes('A3'), 'Branch B does NOT contain A3');

    // 3. Edit Flow
    console.log('\n--- 3. Edit Flow Integration ---');
    // Edit m2 (ancestor) from branch B
    res = await api('POST', `/branches/${b2Id}/messages/${m2}/edit`, { content: 'M2 Edited' });
    assert(res.status === 200, 'Edit ancestor succeeds');
    let pathBAfterEdit = (await api('GET', `/sessions/${sessionId}`)).data.messages;
    const contentBEdit = pathBAfterEdit.map((m: any) => m.content);
    assert(contentBEdit.includes('M2 Edited'), 'Edited alternate path created');
    assert(!contentBEdit.includes('B3'), 'Old future (B3) is safely ignored from new active path');

    // 4. Rewind Flow
    console.log('\n--- 4. Rewind Flow Integration ---');
    res = await api('POST', `/branches/${b1Id}/rewind`, { targetMessageId: m2 });
    assert(res.status === 200, 'Rewind succeeds');
    
    await api('PUT', `/branches/${b1Id}/active`);
    let pathARewind = (await api('GET', `/sessions/${sessionId}`)).data.messages;
    assert(pathARewind[pathARewind.length-1].id === m2, 'Active path head is now M2');
    
    const branchesFinal = (await api('GET', `/sessions/${sessionId}/branches`)).data.branches;
    const snapshot = branchesFinal.find((b: any) => b.is_archived);
    assert(snapshot !== undefined, 'Archived snapshot created');
    assert(snapshot.head_message_id !== m2, 'Snapshot preserves the abandoned future');

  } catch (e) {
    console.error(e);
  } finally {
    server.close();
  }

  console.log(`\n=== Phase 4.4 Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
