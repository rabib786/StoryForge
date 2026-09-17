import { getDatabase } from '../server/db/database.js';
import { runMigrations } from '../server/db/migrations.js';
import { storyCardEngine } from '../server/story-engine/story-card-engine.js';
import { memoryEngine } from '../server/story-engine/memory-engine.js';
import { storyEngine } from '../server/story-engine/story-engine.js';
import { contextManager } from '../server/story-engine/context-manager.js';
import crypto from 'crypto';

async function runTests() {
  console.log('=== Starting Phase 3.1 Ownership & Trust Boundary Hardening Test Suite ===\n');

  // Run migrations first
  runMigrations();
  const db = getDatabase();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${description}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${description}`);
      failed++;
    }
  }

  // Set up isolated test fixtures
  const testChronicleA = 'test-chron-a-' + crypto.randomUUID().slice(0, 8);
  const testChronicleB = 'test-chron-b-' + crypto.randomUUID().slice(0, 8);
  const testSessionA = 'test-sess-a-' + crypto.randomUUID().slice(0, 8);
  const testSessionB = 'test-sess-b-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  // Seed Chronicles
  db.prepare(`
    INSERT INTO chronicles (id, title, genre, system_instructions, opening_message, created_at, updated_at)
    VALUES (?, 'Test Chronicle A', 'fantasy', 'Instructions A', 'Opening A', ?, ?),
           (?, 'Test Chronicle B', 'cyberpunk', 'Instructions B', 'Opening B', ?, ?)
  `).run(testChronicleA, now, now, testChronicleB, now, now);

  // Seed Sessions
  db.prepare(`
    INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
    VALUES (?, ?, 'Session A', ?, ?),
           (?, ?, 'Session B', ?, ?)
  `).run(testSessionA, testChronicleA, now, now, testSessionB, testChronicleB, now, now);

  try {
    // -------------------------------------------------------------
    console.log('\n--- 1. Story Card Ownership & Trust Boundary ---');
    // -------------------------------------------------------------
    
    // 1.1 Creating card for non-existent chronicle fails
    let threwNonExistent = false;
    try {
      storyCardEngine.createCard({
        chronicleId: 'non-existent-chronicle',
        title: 'Ghost Card',
        content: 'Should not exist',
      });
    } catch (e: any) {
      threwNonExistent = e.message.includes('Chronicle not found');
    }
    assert(threwNonExistent, 'Creating Story Card for non-existent chronicle throws "Chronicle not found"');

    // 1.2 Create valid card in Chronicle A
    const cardA = storyCardEngine.createCard({
      chronicleId: testChronicleA,
      title: 'Elven Citadel',
      content: 'Ancient citadel of the high elves',
      category: 'location',
    });
    assert(cardA.chronicle_id === testChronicleA, 'Story Card created successfully with chronicle_id = Chronicle A');

    // 1.3 Update card specifying mismatched Chronicle B is rejected
    let threwMismatchUpdate = false;
    try {
      storyCardEngine.updateCard(cardA.id, { title: 'Corrupted Citadel' }, testChronicleB);
    } catch (e: any) {
      threwMismatchUpdate = e.message.includes('does not belong to specified chronicle');
    }
    assert(threwMismatchUpdate, 'Updating Story Card with mismatched expectedChronicleId is rejected');

    // Verify card was NOT modified
    const cardUnchanged = storyCardEngine.getCardById(cardA.id);
    assert(cardUnchanged?.title === 'Elven Citadel', 'Story Card title remains intact after rejected update');

    // 1.4 Update card with matching Chronicle A succeeds
    const updatedCard = storyCardEngine.updateCard(cardA.id, { title: 'Ancient Elven Citadel' }, testChronicleA);
    assert(updatedCard.title === 'Ancient Elven Citadel', 'Updating Story Card with matching expectedChronicleId succeeds');

    // 1.5 Update card without specifying chronicle succeeds by deriving from card
    const updatedCardDerived = storyCardEngine.updateCard(cardA.id, { content: 'Updated content derived' });
    assert(updatedCardDerived.content === 'Updated content derived', 'Updating Story Card without expectedChronicleId succeeds by deriving chronicle from card');

    // 1.6 Toggle pinned with mismatched chronicle is rejected
    let threwToggleMismatch = false;
    try {
      storyCardEngine.togglePinned(cardA.id, testChronicleB);
    } catch (e: any) {
      threwToggleMismatch = e.message.includes('does not belong to specified chronicle');
    }
    assert(threwToggleMismatch, 'Toggling pinned status on Story Card with mismatched chronicle is rejected');

    // 1.7 Toggle pinned with matching chronicle succeeds
    const toggled = storyCardEngine.togglePinned(cardA.id, testChronicleA);
    assert(toggled.is_pinned === 1, 'Toggling pinned status with matching chronicle succeeds');

    // 1.8 Delete card with mismatched chronicle is rejected
    let threwDeleteMismatch = false;
    try {
      storyCardEngine.deleteCard(cardA.id, testChronicleB);
    } catch (e: any) {
      threwDeleteMismatch = e.message.includes('does not belong to specified chronicle');
    }
    assert(threwDeleteMismatch, 'Deleting Story Card with mismatched expectedChronicleId is rejected');
    assert(storyCardEngine.getCardById(cardA.id) !== undefined, 'Story Card still exists after rejected delete');

    // 1.9 Read scoping: getChronicleStoryCards returns only cards for requested chronicle
    const cardB = storyCardEngine.createCard({
      chronicleId: testChronicleB,
      title: 'Neon Skyscraper',
      content: 'Tower in the dark future',
      category: 'location',
    });
    const cardsChronA = storyCardEngine.getChronicleStoryCards(testChronicleA);
    const cardsChronB = storyCardEngine.getChronicleStoryCards(testChronicleB);
    assert(cardsChronA.length === 1 && cardsChronA[0].id === cardA.id, 'Chronicle A returns strictly its own cards');
    assert(cardsChronB.length === 1 && cardsChronB[0].id === cardB.id, 'Chronicle B returns strictly its own cards');

    // 1.10 Non-existent chronicle lookup throws 404
    let threwNonExistentChronLook = false;
    try {
      storyCardEngine.getChronicleStoryCards('missing-chronicle-id');
    } catch (e: any) {
      threwNonExistentChronLook = e.message.includes('Chronicle not found');
    }
    assert(threwNonExistentChronLook, 'getChronicleStoryCards throws for non-existent chronicle');

    // -------------------------------------------------------------
    console.log('\n--- 2. Memory Creation Ownership & Derivation ---');
    // -------------------------------------------------------------

    // 2.1 Create memory deriving chronicle_id from session_id
    const mem1 = memoryEngine.createMemory({
      sessionId: testSessionA,
      content: 'The player found an enchanted silver locket',
      importance: 4,
    });
    assert(mem1.session_id === testSessionA && mem1.chronicle_id === testChronicleA, 'Memory creation correctly derived chronicle_id from session_id');

    // 2.2 Create memory with matching chronicle_id succeeds
    const mem2 = memoryEngine.createMemory({
      sessionId: testSessionA,
      chronicleId: testChronicleA,
      content: 'The silver locket glows near high elves',
      importance: 3,
    });
    assert(mem2.chronicle_id === testChronicleA, 'Memory creation with matching chronicle_id succeeds');

    // 2.3 Create memory with MISMATCHED chronicle_id is rejected
    let threwMemMismatch = false;
    try {
      memoryEngine.createMemory({
        sessionId: testSessionA,
        chronicleId: testChronicleB, // Mismatch!
        content: 'Cross-chronicle memory injection attempt',
        importance: 5,
      });
    } catch (e: any) {
      threwMemMismatch = e.message.includes('Chronicle ownership mismatch');
    }
    assert(threwMemMismatch, 'Memory creation with mismatched chronicle_id is rejected');

    // 2.4 Create memory with non-existent session_id is rejected
    let threwMemNonExistentSession = false;
    try {
      memoryEngine.createMemory({
        sessionId: 'phantom-session',
        content: 'Phantom session memory',
      });
    } catch (e: any) {
      threwMemNonExistentSession = e.message.includes('Story session not found');
    }
    assert(threwMemNonExistentSession, 'Memory creation for non-existent session is rejected');

    // 2.5 Memory source message must belong to the same session
    const msgA1 = 'msg-a1-' + crypto.randomUUID().slice(0, 8);
    const msgB1 = 'msg-b1-' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO messages (id, session_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, 'user', 'Hello Session A', 0, ?, ?),
             (?, ?, 'user', 'Hello Session B', 0, ?, ?)
    `).run(msgA1, testSessionA, now, now, msgB1, testSessionB, now, now);

    let threwSourceMismatch = false;
    try {
      memoryEngine.createMemory({
        sessionId: testSessionA,
        content: 'Memory referencing message from Session B',
        sourceMessageId: msgB1, // Mismatch: msgB1 is from Session B!
      });
    } catch (e: any) {
      threwSourceMismatch = e.message.includes('Source message ownership mismatch');
    }
    assert(threwSourceMismatch, 'Memory creation referencing source message from different session is rejected');

    // Valid source message succeeds
    const memValidSource = memoryEngine.createMemory({
      sessionId: testSessionA,
      content: 'Memory referencing message from Session A',
      sourceMessageId: msgA1,
    });
    assert(memValidSource.source_message_id === msgA1, 'Memory creation referencing valid source message from same session succeeds');

    // -------------------------------------------------------------
    console.log('\n--- 3. Memory Deletion Ownership ---');
    // -------------------------------------------------------------

    // 3.1 Deleting non-existent memory throws
    let threwDelMissing = false;
    try {
      memoryEngine.deleteMemory('missing-memory-id');
    } catch (e: any) {
      threwDelMissing = e.message.includes('Memory not found');
    }
    assert(threwDelMissing, 'Deleting non-existent memory throws "Memory not found"');

    // 3.2 Deleting memory scoped to wrong session fails
    let threwDelWrongSession = false;
    try {
      memoryEngine.deleteMemory(mem1.id, { sessionId: testSessionB });
    } catch (e: any) {
      threwDelWrongSession = e.message.includes('Memory does not belong to specified session');
    }
    assert(threwDelWrongSession, 'Deleting memory with mismatched sessionId scope is rejected');

    // 3.3 Deleting memory scoped to wrong chronicle fails
    let threwDelWrongChronicle = false;
    try {
      memoryEngine.deleteMemory(mem1.id, { chronicleId: testChronicleB });
    } catch (e: any) {
      threwDelWrongChronicle = e.message.includes('Memory does not belong to specified chronicle');
    }
    assert(threwDelWrongChronicle, 'Deleting memory with mismatched chronicleId scope is rejected');

    // Verify mem1 was NOT deleted
    const mem1StillExists = db.prepare('SELECT id FROM memories WHERE id = ?').get(mem1.id);
    assert(mem1StillExists !== undefined, 'Memory was not deleted after mismatched scope deletion attempt');

    // 3.4 Deleting memory with matching scope succeeds
    const deleted = memoryEngine.deleteMemory(mem1.id, { sessionId: testSessionA, chronicleId: testChronicleA });
    assert(deleted === true, 'Deleting memory with matching scope succeeds');
    const mem1Now = db.prepare('SELECT id FROM memories WHERE id = ?').get(mem1.id);
    assert(mem1Now === undefined, 'Memory is deleted after valid scoped delete');

    // -------------------------------------------------------------
    console.log('\n--- 4. Memory Read Scoping ---');
    // -------------------------------------------------------------

    // 4.1 Querying memories for non-existent session throws
    let threwGetMemMissingSession = false;
    try {
      memoryEngine.getSessionMemories('phantom-session-id');
    } catch (e: any) {
      threwGetMemMissingSession = e.message.includes('Story session not found');
    }
    assert(threwGetMemMissingSession, 'getSessionMemories for non-existent session throws 404');

    // 4.2 Querying memories with mismatched chronicleId throws
    let threwGetMemChronMismatch = false;
    try {
      memoryEngine.getSessionMemories(testSessionA, testChronicleB);
    } catch (e: any) {
      threwGetMemChronMismatch = e.message.includes('Chronicle ownership mismatch');
    }
    assert(threwGetMemChronMismatch, 'getSessionMemories with mismatched chronicleId throws ownership mismatch');

    // 4.3 Querying memories with derived/matching chronicle returns correct memories
    const sessionAMems = memoryEngine.getSessionMemories(testSessionA);
    assert(sessionAMems.every(m => m.session_id === testSessionA && m.chronicle_id === testChronicleA), 'All returned memories belong strictly to Session A and Chronicle A');

    // -------------------------------------------------------------
    console.log('\n--- 5. Generation Route & Context Inspection (Critical Fix) ---');
    // -------------------------------------------------------------

    // Snapshot chronicle updated_at and message count before test
    const chronBBefore = db.prepare('SELECT updated_at FROM chronicles WHERE id = ?').get(testChronicleB) as { updated_at: string };
    const msgCountBefore = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(testSessionA) as { c: number }).c;

    // 5.1 Calling generateResponse with mismatched chronicleId and sessionId
    const mismatchGenResult = await storyEngine.generateResponse({
      sessionId: testSessionA, // belongs to Chronicle A
      chronicleId: testChronicleB, // Mismatched!
      userMessage: 'This message must NOT be inserted into database',
    });

    assert(mismatchGenResult.success === false, 'generateResponse fails when chronicleId and sessionId mismatch');
    assert(mismatchGenResult.statusCode === 400, 'generateResponse returns statusCode 400 for chronicle mismatch');

    // CRITICAL: Verify NO mutations occurred
    const chronBAfter = db.prepare('SELECT updated_at FROM chronicles WHERE id = ?').get(testChronicleB) as { updated_at: string };
    const msgCountAfter = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(testSessionA) as { c: number }).c;
    assert(chronBAfter.updated_at === chronBBefore.updated_at, 'Mismatched chronicle updated_at was NOT modified');
    assert(msgCountAfter === msgCountBefore, 'Player message was NOT persisted during rejected generation');

    // 5.2 Calling generateResponse with non-existent sessionId
    const nonExistentGenResult = await storyEngine.generateResponse({
      sessionId: 'phantom-session',
      userMessage: 'Phantom message',
    });
    assert(nonExistentGenResult.success === false && nonExistentGenResult.statusCode === 404, 'generateResponse returns 404 for non-existent session');

    // 5.3 Context inspection: mismatched chronicleId is rejected
    let threwContextMismatch = false;
    try {
      contextManager.buildGenerationContext({
        sessionId: testSessionA,
        chronicleId: testChronicleB,
      });
    } catch (e: any) {
      threwContextMismatch = e.message.includes('Chronicle ownership mismatch');
    }
    assert(threwContextMismatch, 'contextManager.buildGenerationContext rejects mismatched chronicleId');

    // 5.4 Context inspection: non-existent sessionId is rejected
    let threwContextMissingSession = false;
    try {
      contextManager.buildGenerationContext({
        sessionId: 'phantom-session',
      });
    } catch (e: any) {
      threwContextMissingSession = e.message.includes('Story session not found');
    }
    assert(threwContextMissingSession, 'contextManager.buildGenerationContext rejects non-existent sessionId');

    // 5.5 Context inspection: valid session derives Chronicle A correctly
    const validContext = contextManager.buildGenerationContext({
      sessionId: testSessionA,
    });
    assert(validContext.chronicleTitle === 'Test Chronicle A', 'contextManager correctly derived Chronicle A from Session A');
    assert(validContext.diagnostic.chronicleTitle === 'Test Chronicle A', 'contextManager diagnostic reflects derived Chronicle A');

    // -------------------------------------------------------------
    console.log('\n--- 6. Message Parent Session Integrity (Trigger Enforcement) ---');
    // -------------------------------------------------------------

    // 6.1 Same-session parent message insertion succeeds
    const msgChildA = 'msg-child-a-' + crypto.randomUUID().slice(0, 8);
    let sameSessionSuccess = false;
    try {
      db.prepare(`
        INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
        VALUES (?, ?, ?, 'user', 'Child in session A', 10, ?, ?)
      `).run(msgChildA, testSessionA, msgA1, now, now);
      sameSessionSuccess = true;
    } catch (e: any) {
      sameSessionSuccess = false;
    }
    assert(sameSessionSuccess, 'Inserting message with parent_message_id in SAME session succeeds');

    // 6.2 Cross-session parent message insertion is BLOCKED by SQLite trigger
    const msgCrossAttempt = 'msg-cross-' + crypto.randomUUID().slice(0, 8);
    let crossInsertBlocked = false;
    try {
      db.prepare(`
        INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, sequence_order, created_at, updated_at)
        VALUES (?, ?, ?, 'user', 'Cross-session child', 10, ?, ?)
      `).run(msgCrossAttempt, testSessionB, msgA1, now, now); // Child in Session B, parent in Session A!
    } catch (e: any) {
      crossInsertBlocked = e.message.includes('Cross-session parent message relationship is forbidden');
    }
    assert(crossInsertBlocked, 'Cross-session parent message insertion is strictly BLOCKED by SQLite trigger');

    // 6.3 Cross-session update of parent_message_id is BLOCKED by SQLite trigger
    const msgStandaloneB = 'msg-standalone-b-' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO messages (id, session_id, sender_type, content, sequence_order, created_at, updated_at)
      VALUES (?, ?, 'user', 'Standalone in session B', 11, ?, ?)
    `).run(msgStandaloneB, testSessionB, now, now);

    let crossUpdateBlocked = false;
    try {
      db.prepare(`
        UPDATE messages SET parent_message_id = ? WHERE id = ?
      `).run(msgA1, msgStandaloneB); // Attempt to assign Session A parent to Session B message
    } catch (e: any) {
      crossUpdateBlocked = e.message.includes('Cross-session parent message relationship is forbidden');
    }
    assert(crossUpdateBlocked, 'Cross-session parent message UPDATE is strictly BLOCKED by SQLite trigger');

    // -------------------------------------------------------------
    console.log('\n--- 7. Database Integrity & Foreign Key Check ---');
    // -------------------------------------------------------------
    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    assert(Array.isArray(fkErrors) && fkErrors.length === 0, `PRAGMA foreign_key_check is completely clean (0 errors)`);

  } finally {
    // Clean up test fixtures
    db.prepare('DELETE FROM messages WHERE session_id IN (?, ?)').run(testSessionA, testSessionB);
    db.prepare('DELETE FROM memories WHERE session_id IN (?, ?)').run(testSessionA, testSessionB);
    db.prepare('DELETE FROM story_cards WHERE chronicle_id IN (?, ?)').run(testChronicleA, testChronicleB);
    db.prepare('DELETE FROM story_sessions WHERE id IN (?, ?)').run(testSessionA, testSessionB);
    db.prepare('DELETE FROM chronicles WHERE id IN (?, ?)').run(testChronicleA, testChronicleB);
  }

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Test suite failed with unexpected error:', e);
  process.exit(1);
});
