import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { storyEngine } from '../server/story-engine/story-engine.js';
import { providerManager } from '../server/providers/manager.js';
import crypto from 'crypto';

async function runTests() {
  runMigrations();
  const db = getDatabase();

  function createTestSession() {
    const chronicleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO chronicles (id, title, genre, created_at, updated_at) VALUES (?, 'Test Chron', 'SciFi', ?, ?)`).run(chronicleId, now, now);
    db.prepare(`INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at) VALUES (?, ?, 'Test Session', ?, ?)`).run(sessionId, chronicleId, now, now);
    const branchId = crypto.randomUUID();
    db.prepare(`INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at) VALUES (?, ?, 'Test Branch', NULL, 1, ?, ?)`).run(branchId, sessionId, now, now);
    return { chronicleId, sessionId, branchId };
  }

  // Mock Provider
  providerManager.getProvider = () => ({
    generate: async () => {
      return { content: 'Mocked AI Response', tokensUsed: 10, generationTimeMs: 100 };
    }
  } as any);

  try {
    const s = createTestSession();
    
    // Trigger two generations without awaiting the first one immediately?
    // Actually, locking prevents this at the controller layer. But if we bypass locks or if we mutate the branch during generation, it should fail the stale head check.
    // Let's mock a provider that waits, mutates the DB, and then finishes.
    
    providerManager.getProvider = () => ({
      generate: async () => {
        // Mutate the branch head while we are "generating"
        
        const m = crypto.randomUUID();
        db.prepare(`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, 'user', 'x', 0, 1, ?, ?)`).run(m, s.sessionId, new Date().toISOString(), new Date().toISOString());
        db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m, s.branchId);

        return { content: 'Mocked AI Response', tokensUsed: 10, generationTimeMs: 100 };
      }
    } as any);
    
    console.log('--- Test J — Stale-head protection ---');
    const result = await storyEngine.generateResponse({ sessionId: s.sessionId });
    if (!result.success && result.error && result.error.includes('Stale branch head')) {
       console.log('✅ PASS: Stale branch head check caught the concurrent mutation');
    } else {
       console.error('❌ FAIL: Stale branch head check failed to catch mutation');
       console.error(result);
    }
  } catch (e) {
    console.error(e);
  }
}
runTests();
