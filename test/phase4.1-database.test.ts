// @ts-nocheck
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { getDatabase } from '../server/db/database';
import crypto from 'crypto';

describe('Phase 4.1 Database Foundation', () => {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  let chronicleId: string;
  let sessionA: string;
  let sessionB: string;

  beforeAll(() => {
    chronicleId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO chronicles (id, title, created_at, updated_at) 
      VALUES (?, ?, ?, ?)
    `).run(chronicleId, 'Test Chronicle', now, now);

    sessionA = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
      VALUES (?, ?, 'Test Session A', ?, ?)
    `).run(sessionA, chronicleId, now, now);

    sessionB = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
      VALUES (?, ?, 'Test Session B', ?, ?)
    `).run(sessionB, chronicleId, now, now);
  });

  afterAll(() => {
    db.prepare('DELETE FROM chronicles WHERE id = ?').run(chronicleId);
  });

  it('Empty session receives Main Timeline branch automatically or can be created', () => {
    const branchId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(branchId, sessionA, 'Main Timeline', null, 1, now, now);

    const branch = db.prepare('SELECT * FROM story_branches WHERE id = ?').get(branchId) as any;
    expect(branch.head_message_id).toBeNull();
    expect(branch.is_active).toBe(1);
  });

  it('Branch uniqueness: two active branches in one session must fail', () => {
    const branchId2 = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(branchId2, sessionA, 'Second Branch', null, 1, now, now);
    }).toThrow(/UNIQUE constraint failed: story_branches\.session_id/);
  });

  it('Cross-session parent: a message in Session A cannot use a parent from Session B', () => {
    const msgA = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, sender_type, content, is_ooc, created_at, updated_at)
      VALUES (?, ?, 'user', 'hello', 0, ?, ?)
    `).run(msgA, sessionA, now, now);

    const msgB = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO messages (id, session_id, sender_type, content, is_ooc, parent_message_id, created_at, updated_at)
        VALUES (?, ?, 'ai', 'hi', 0, ?, ?, ?)
      `).run(msgB, sessionB, msgA, now, now);
    }).toThrow(/Cross-session parent message relationship is forbidden/);
  });

  it('Cross-session branch head: a Branch in Session A cannot point to a Message in Session B', () => {
    const msgB = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, sender_type, content, is_ooc, created_at, updated_at)
      VALUES (?, ?, 'user', 'hello B', 0, ?, ?)
    `).run(msgB, sessionB, now, now);

    const branchA2 = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(branchA2, sessionA, 'Invalid Head', msgB, 0, now, now);
    }).toThrow(/Cross-session branch head relationship is forbidden/);
  });

  it('Cross-session memory source: a Memory in Session A cannot reference a Message from Session B', () => {
    const memA = crypto.randomUUID();
    const msgB = db.prepare('SELECT id FROM messages WHERE session_id = ? LIMIT 1').get(sessionB) as any;
    
    expect(() => {
      db.prepare(`
        INSERT INTO memories (id, chronicle_id, session_id, content, importance, source_message_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(memA, chronicleId, sessionA, 'Test memory', 3, msgB.id, now, now);
    }).toThrow(/Cross-session memory source relationship is forbidden/);
  });

  it('Memory supersession: Cannot supersede itself', () => {
    const mem1 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO memories (id, chronicle_id, session_id, content, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mem1, chronicleId, sessionA, 'Memory 1', 3, now, now);

    const sups = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(sups, mem1, mem1, now);
    }).toThrow(/CHECK constraint failed/);
  });

  it('Memory supersession: Duplicate relationships fail', () => {
    const mem1 = crypto.randomUUID();
    const mem2 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO memories (id, chronicle_id, session_id, content, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mem1, chronicleId, sessionA, 'Memory 1', 3, now, now);
    db.prepare(`
      INSERT INTO memories (id, chronicle_id, session_id, content, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mem2, chronicleId, sessionA, 'Memory 2', 3, now, now);

    const rel1 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(rel1, mem2, mem1, now);

    const rel2 = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(rel2, mem2, mem1, now);
    }).toThrow(/UNIQUE constraint failed: memory_supersessions\.superseding_id, memory_supersessions\.superseded_id/);
  });

  it('Memory supersession: Cross-session fails', () => {
    const memA = db.prepare('SELECT id FROM memories WHERE session_id = ? LIMIT 1').get(sessionA) as any;
    
    const memB = crypto.randomUUID();
    db.prepare(`
      INSERT INTO memories (id, chronicle_id, session_id, content, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(memB, chronicleId, sessionB, 'Memory B', 3, now, now);

    const rel = crypto.randomUUID();
    expect(() => {
      db.prepare(`
        INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(rel, memB, memA.id, now);
    }).toThrow(/Cross-session supersession is forbidden/);
  });

  it('Shared ancestry & Shared-head rewind scenario', () => {
    const sessionC = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
      VALUES (?, ?, 'Test Session C', ?, ?)
    `).run(sessionC, chronicleId, now, now);

    const msgIds = [];
    let parentId = null;
    for (let i = 1; i <= 10; i++) {
      const msgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, session_id, sender_type, content, is_ooc, parent_message_id, created_at, updated_at)
        VALUES (?, ?, 'user', ?, 0, ?, ?, ?)
      `).run(msgId, sessionC, "Message " + i, parentId, now, now);
      parentId = msgId;
      msgIds.push(msgId);
    }

    const branch1 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at)
      VALUES (?, ?, 'Timeline A', ?, 1, ?, ?)
    `).run(branch1, sessionC, msgIds[9], now, now);

    const branch2 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, created_at, updated_at)
      VALUES (?, ?, 'Timeline B', ?, 0, ?, ?)
    `).run(branch2, sessionC, msgIds[9], now, now);

    // Shared-head rewind on A
    db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(msgIds[6], branch1);

    // Verify messages 8-10 remain intact
    const msg10 = db.prepare('SELECT id FROM messages WHERE id = ?').get(msgIds[9]);
    expect(msg10).toBeDefined();
  });
});
