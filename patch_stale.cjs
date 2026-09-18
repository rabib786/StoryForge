const fs = require('fs');
let code = fs.readFileSync('test/phase4.2-stale.test.ts', 'utf8');

const target = `db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(crypto.randomUUID(), s.branchId);`;
const replacement = `
        const m = crypto.randomUUID();
        db.prepare(\`INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at) VALUES (?, ?, 'user', 'x', 0, 1, ?, ?)\`).run(m, s.sessionId, new Date().toISOString(), new Date().toISOString());
        db.prepare('UPDATE story_branches SET head_message_id = ? WHERE id = ?').run(m, s.branchId);
`;

code = code.replace(target, replacement);
fs.writeFileSync('test/phase4.2-stale.test.ts', code);
console.log("Patched stale test");
