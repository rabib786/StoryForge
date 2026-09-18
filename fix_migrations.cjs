const fs = require('fs');
let code = fs.readFileSync('server/db/migrations.ts', 'utf8');

const targetEnd = `  // Migration 007: Phase 4.1 Branch/Message Tree Foundation`;

const replacement = `  // Migration 008: Phase 5.1 Dynamic Character State
  const m8 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('008_character_states');
  if (!m8) {
    console.log('[Migration] Applying 008_character_states...');
    db.exec('PRAGMA foreign_keys = OFF;');
    db.transaction(() => {
      const now = new Date().toISOString();
      
      db.exec(\`
        CREATE TABLE IF NOT EXISTS character_states (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL REFERENCES story_characters(id) ON DELETE CASCADE,
            source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            state_key TEXT NOT NULL,
            state_value TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_character_states_character ON character_states(character_id);
        CREATE INDEX IF NOT EXISTS idx_character_states_source ON character_states(source_message_id);
        
        CREATE TRIGGER IF NOT EXISTS trg_character_states_chronicle_check_insert
        BEFORE INSERT ON character_states
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'Cross-chronicle character state relationship is forbidden')
          WHERE (SELECT chronicle_id FROM story_characters WHERE id = NEW.character_id) != 
                (SELECT chronicle_id FROM story_sessions WHERE id = (SELECT session_id FROM messages WHERE id = NEW.source_message_id));
        END;
        
        CREATE TRIGGER IF NOT EXISTS trg_character_states_chronicle_check_update
        BEFORE UPDATE OF character_id, source_message_id ON character_states
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'Cross-chronicle character state relationship is forbidden')
          WHERE (SELECT chronicle_id FROM story_characters WHERE id = NEW.character_id) != 
                (SELECT chronicle_id FROM story_sessions WHERE id = (SELECT session_id FROM messages WHERE id = NEW.source_message_id));
        END;
      \`);
      
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('008_character_states', now);
    })();
    db.exec('PRAGMA foreign_keys = ON;');
    const fkErrors = db.pragma('foreign_key_check');
    if (fkErrors && fkErrors.length > 0) {
      throw new Error(\`Foreign key check failed after 008_character_states: \${JSON.stringify(fkErrors)}\`);
    }
    console.log('[Migration] 008_character_states applied successfully.');
  }

  // Migration 007: Phase 4.1 Branch/Message Tree Foundation`;
  
code = code.replace(targetEnd, replacement);
fs.writeFileSync('server/db/migrations.ts', code);
console.log("Migrations updated");
