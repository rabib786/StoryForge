const fs = require('fs');
let code = fs.readFileSync('server/db/migrations.ts', 'utf8');

code = code.replace(/const sessions = db.prepare\('SELECT id FROM story_sessions'\)\.all\(\);/g, "const sessions = db.prepare('SELECT id FROM story_sessions').all() as any[];");
code = code.replace(/const messages = db.prepare\('SELECT id FROM messages WHERE session_id = \? ORDER BY sequence_order ASC'\)\.all\(session.id\);/g, "const messages = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order ASC').all(session.id) as any[];");
code = code.replace(/const latestMessage = db.prepare\('SELECT id FROM messages WHERE session_id = \? ORDER BY sequence_order DESC LIMIT 1'\)\.get\(session.id\);/g, "const latestMessage = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order DESC LIMIT 1').get(session.id) as any;");
code = code.replace(/const memories = db.prepare\('SELECT id, session_id, created_at, source_message_id FROM memories'\)\.all\(\);/g, "const memories = db.prepare('SELECT id, session_id, created_at, source_message_id FROM memories').all() as any[];");
code = code.replace(/\\.get\\(mem\\.session_id, mem\\.created_at\\);/g, ".get(mem.session_id, mem.created_at) as any;");
code = code.replace(/const fkErrors = db.pragma\\('foreign_key_check'\\);/g, "const fkErrors = db.pragma('foreign_key_check') as unknown[];");

fs.writeFileSync('server/db/migrations.ts', code);
