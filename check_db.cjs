const Database = require('better-sqlite3');
const db = new Database('server/db/database.sqlite');
console.log("Foreign Key Check:", db.pragma('foreign_key_check'));
console.log("Integrity Check:", db.pragma('integrity_check'));
