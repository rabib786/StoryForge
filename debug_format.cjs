const fs = require('fs');
let code = fs.readFileSync('test/character-state-behavioral-context.test.ts', 'utf8');

code = code.replace(
  `assert(ctx1.systemInstruction.includes(expectedFormatOrder), '5. State formatting is deterministic (alphabetical sorting).');`,
  `if (!ctx1.systemInstruction.includes(expectedFormatOrder)) {
    console.log("ACTUAL CONTEXT:\\n" + ctx1.systemInstruction);
  }
  assert(ctx1.systemInstruction.includes(expectedFormatOrder), '5. State formatting is deterministic (alphabetical sorting).');`
);

fs.writeFileSync('test/character-state-behavioral-context.test.ts', code);
