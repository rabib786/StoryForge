const fs = require('fs');
let code = fs.readFileSync('server/story-engine/context-manager.ts', 'utf8');

code = code.replace(
  `systemParts.push(\`[STORY CAST / NPCS]\\nYou control these characters:\\n\${charBlock}\`);`,
  `systemParts.push(\`[STATIC STORY CHARACTER INFORMATION]\\nYou control these characters:\\n\${charBlock}\`);`
);

fs.writeFileSync('server/story-engine/context-manager.ts', code);
console.log("Patched context");
