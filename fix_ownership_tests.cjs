const fs = require('fs');
let code = fs.readFileSync('test/ownership-hardening.test.ts', 'utf8');

const search = `  db.prepare(\`
    INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
    VALUES (?, ?, 'Session A', ?, ?),
           (?, ?, 'Session B', ?, ?)
  \`).run(testSessionA, testChronicleA, now, now, testSessionB, testChronicleB, now, now);`;

const replace = `  db.prepare(\`
    INSERT INTO story_sessions (id, chronicle_id, title, created_at, updated_at)
    VALUES (?, ?, 'Session A', ?, ?),
           (?, ?, 'Session B', ?, ?)
  \`).run(testSessionA, testChronicleA, now, now, testSessionB, testChronicleB, now, now);

  db.prepare(\`
    INSERT INTO story_branches (id, session_id, name, is_active, created_at, updated_at)
    VALUES (?, ?, 'Main', 1, ?, ?),
           (?, ?, 'Main', 1, ?, ?)
  \`).run(
    crypto.randomBytes(4).toString('hex'), testSessionA, now, now,
    crypto.randomBytes(4).toString('hex'), testSessionB, now, now
  );`;

code = code.replace(search, replace);
fs.writeFileSync('test/ownership-hardening.test.ts', code);
