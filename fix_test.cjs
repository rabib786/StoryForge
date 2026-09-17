const fs = require('fs');
let code = fs.readFileSync('test/phase4.1-database.test.ts', 'utf8');
code = code.replace(/\\\`Message \\\$\\{i\\}\\\`/g, '`Message ${i}`');
fs.writeFileSync('test/phase4.1-database.test.ts', code);
