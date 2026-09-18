const fs = require('fs');
let code = fs.readFileSync('server/db/migrations.ts', 'utf8');

code = code.replace("const fkErrors = db.pragma('foreign_key_check');", "const fkErrors = db.pragma('foreign_key_check') as unknown[];");

fs.writeFileSync('server/db/migrations.ts', code);
