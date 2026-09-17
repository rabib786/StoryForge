const fs = require('fs');

let content = fs.readFileSync('server/db/migrations.ts', 'utf8');
const injectionPoint = "console.log('[Migration] 006_message_parent_session_integrity applied successfully.');\n  }";

const migrationCode = `
  // Migration 007: Phase 4.1 Branch/Message Tree Foundation
  const m7 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('007_branch_architecture');
  if (!m7) {
    console.log('[Migration] Applying 007_branch_architecture...');
    db.exec('PRAGMA foreign_keys = OFF;');
    db.transaction(() => {
      const now = new Date().toISOString();
      const crypto = require('crypto'); // Ensure crypto is available

      // 1. Create story_branches table
      db.exec(\`
        CREATE TABLE IF NOT EXISTS story_branches (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            head_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (is_active IN (0, 1)),
            CHECK (is_archived IN (0, 1)),
            CHECK (NOT (is_active = 1 AND is_archived = 1))
        );
        CREATE INDEX IF NOT EXISTS idx_story_branches_session ON story_branches(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_story_branches_active ON story_branches(session_id) WHERE is_active = 1;
      \`);

      // Branch integrity triggers
      db.exec(\`
        CREATE TRIGGER IF NOT EXISTS trg_branches_head_session_check_insert
        BEFORE INSERT ON story_branches
        FOR EACH ROW
        WHEN NEW.head_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session branch head relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.head_message_id) != NEW.session_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_branches_head_session_check_update
        BEFORE UPDATE OF head_message_id, session_id ON story_branches
        FOR EACH ROW
        WHEN NEW.head_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session branch head relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.head_message_id) != NEW.session_id;
        END;
      \`);

      // 2. Drop messages.branch_id
      try {
        db.exec('ALTER TABLE messages DROP COLUMN branch_id;');
      } catch (e) {
        console.warn('Could not drop branch_id (might not exist):', e.message);
      }
      
      // Index for parent_message_id
      db.exec('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);');

      // 3. Backfill message tree and create branches
      const sessions = db.prepare('SELECT id FROM story_sessions').all();
      for (const session of sessions) {
        const messages = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order ASC').all(session.id);
        
        let parentId = null;
        for (const msg of messages) {
          db.prepare('UPDATE messages SET parent_message_id = ? WHERE id = ?').run(parentId, msg.id);
          parentId = msg.id;
        }

        // Create Main Timeline branch
        const latestMessage = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order DESC LIMIT 1').get(session.id);
        db.prepare(\`
          INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
          VALUES (?, ?, 'Main Timeline', ?, 1, 0, ?, ?)
        \`).run(crypto.randomUUID(), session.id, latestMessage ? latestMessage.id : null, now, now);
      }

      // 4. Memory source-message migration (recreate memories to enforce ON DELETE CASCADE)
      db.exec(\`
        CREATE TABLE IF NOT EXISTS new_memories_007 (
          id TEXT PRIMARY KEY,
          chronicle_id TEXT NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'event',
          content TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 3,
          status TEXT NOT NULL DEFAULT 'active',
          source_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO new_memories_007 SELECT id, chronicle_id, session_id, type, content, importance, status, source_message_id, is_pinned, created_at, updated_at FROM memories;
        DROP TABLE memories;
        ALTER TABLE new_memories_007 RENAME TO memories;
        
        CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
        CREATE INDEX IF NOT EXISTS idx_memories_chronicle ON memories(chronicle_id);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
        CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_message_id);
      \`);

      // Backfill source_message_id deterministically
      const memories = db.prepare('SELECT id, session_id, created_at, source_message_id FROM memories').all();
      for (const mem of memories) {
        if (mem.source_message_id) continue;

        // Nearest preceding message
        const closestMessage = db.prepare(\`
          SELECT id FROM messages 
          WHERE session_id = ? AND created_at <= ? 
          ORDER BY created_at DESC, sequence_order DESC, id DESC 
          LIMIT 1
        \`).get(mem.session_id, mem.created_at);

        if (closestMessage) {
          db.prepare('UPDATE memories SET source_message_id = ? WHERE id = ?').run(closestMessage.id, mem.id);
        } else {
          throw new Error(\`Migration failed: Cannot deterministically backfill source_message_id for memory \${mem.id}\`);
        }
      }

      // 5. Memory source integrity triggers
      db.exec(\`
        CREATE TRIGGER IF NOT EXISTS trg_memories_source_session_check_insert
        BEFORE INSERT ON memories
        FOR EACH ROW
        WHEN NEW.source_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session memory source relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.source_message_id) != NEW.session_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_memories_source_session_check_update
        BEFORE UPDATE OF source_message_id, session_id ON memories
        FOR EACH ROW
        WHEN NEW.source_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session memory source relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.source_message_id) != NEW.session_id;
        END;
      \`);

      // 6. Memory supersessions
      db.exec(\`
        CREATE TABLE IF NOT EXISTS memory_supersessions (
            id TEXT PRIMARY KEY,
            superseding_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            superseded_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            CHECK (superseding_id <> superseded_id),
            UNIQUE (superseding_id, superseded_id)
        );
        CREATE INDEX IF NOT EXISTS idx_memory_supersessions_superseding ON memory_supersessions(superseding_id);
        CREATE INDEX IF NOT EXISTS idx_memory_supersessions_superseded ON memory_supersessions(superseded_id);

        CREATE TRIGGER IF NOT EXISTS trg_memory_supersessions_session_check_insert
        BEFORE INSERT ON memory_supersessions
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session supersession is forbidden')
          WHERE (SELECT session_id FROM memories WHERE id = NEW.superseding_id) != (SELECT session_id FROM memories WHERE id = NEW.superseded_id);
        END;
      \`);

      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('007_branch_architecture', now);
    })();
    db.exec('PRAGMA foreign_keys = ON;');
    const fkErrors = db.pragma('foreign_key_check');
    if (fkErrors && fkErrors.length > 0) {
      throw new Error(\`Foreign key check failed after 007_branch_architecture: \${JSON.stringify(fkErrors)}\`);
    }
    console.log('[Migration] 007_branch_architecture applied successfully.');
  }
`;

content = content.replace(injectionPoint, injectionPoint + "\n" + migrationCode);
fs.writeFileSync('server/db/migrations.ts', content);
console.log('Migration 007 added');
