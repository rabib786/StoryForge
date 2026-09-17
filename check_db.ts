import { getDatabase } from './server/db/database.js';
const db = getDatabase();
db.exec('PRAGMA foreign_keys = ON;');
const fk = db.pragma('foreign_key_check');
console.log('FK check:', fk);
const integrity = db.pragma('integrity_check');
console.log('Integrity check:', integrity);
