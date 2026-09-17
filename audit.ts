import { getDatabase } from './server/db/database.js';

const db = getDatabase();

console.log("=== SCHEMA AUDIT ===");
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all() as any[];
const branchesTable = tables.find(t => t.name === 'story_branches');
console.log("story_branches exists:", !!branchesTable);
const messagesTable = tables.find(t => t.name === 'messages');
console.log("messages branch_id removed:", !messagesTable.sql.includes('branch_id'));
console.log("messages parent_message_id exists:", messagesTable.sql.includes('parent_message_id'));
const memoriesTable = tables.find(t => t.name === 'memories');
console.log("memories source_message_id exists:", memoriesTable.sql.includes('source_message_id'));
const supersessionsTable = tables.find(t => t.name === 'memory_supersessions');
console.log("memory_supersessions exists:", !!supersessionsTable);

console.log("\n=== MEMORY MIGRATION AUDIT ===");
const memories = db.prepare("SELECT * FROM memories").all() as any[];
let validPreserved = 0;
let backfilled = 0; // We can't strictly distinguish backfilled from preserved here without history, but we can verify 100% resolution.
let unresolved = 0;
memories.forEach(m => {
  if (m.source_message_id) {
    validPreserved++;
  } else {
    unresolved++;
  }
});
console.log(`Total memories: ${memories.length}`);
console.log(`Resolved (Preserved/Backfilled): ${validPreserved}`);
console.log(`Unresolved: ${unresolved}`);

console.log("\n=== MESSAGE TREE AUDIT ===");
const messages = db.prepare("SELECT * FROM messages").all() as any[];
const crossSessionParents = db.prepare(`
  SELECT m1.id FROM messages m1 
  JOIN messages m2 ON m1.parent_message_id = m2.id 
  WHERE m1.session_id != m2.session_id
`).all();
console.log(`Cross-session parents: ${crossSessionParents.length}`);

console.log("\n=== INTEGRITY CHECKS ===");
db.exec('PRAGMA foreign_keys = ON;');
const fkCheck = db.pragma('foreign_key_check') as any[];
console.log(`Foreign Key errors: ${fkCheck.length}`);
const integrityCheck = db.pragma('integrity_check') as any[];
console.log(`Integrity Check: ${integrityCheck[0].integrity_check}`);
