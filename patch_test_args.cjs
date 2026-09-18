const fs = require('fs');
let code = fs.readFileSync('test/character-state-behavioral-context.test.ts', 'utf8');

code = code.replace(/asCharacterId: null/g, '/* no asCharacterId */');
fs.writeFileSync('test/character-state-behavioral-context.test.ts', code);
console.log("Patched test args");
