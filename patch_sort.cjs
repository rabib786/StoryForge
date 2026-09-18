const fs = require('fs');
let code = fs.readFileSync('server/story-engine/context-manager.ts', 'utf8');

code = code.replace(
  `        // Ensure deterministic sorting
        const sortedCharIds = Array.from(stateMap.keys()).sort();
        for (const charId of sortedCharIds) {
          const char = storyCharacters.find(c => c.id === charId);
          if (char) {
            const states = stateMap.get(charId)!.sort((a, b) => a.key.localeCompare(b.key));
            const stateLines = states.map(s => \`  - \${s.key}: \${s.value}\`).join('\\n');
            stateBlock += \`• \${char.name}:\\n\${stateLines}\\n\`;
          }
        }`,
  `        // Ensure deterministic sorting
        const charIds = Array.from(stateMap.keys());
        const validChars = charIds.map(id => storyCharacters.find(c => c.id === id)).filter(Boolean) as any[];
        validChars.sort((a, b) => a.name.localeCompare(b.name));

        for (const char of validChars) {
            const states = stateMap.get(char.id)!.sort((a, b) => a.key.localeCompare(b.key));
            const stateLines = states.map(s => \`  - \${s.key}: \${s.value}\`).join('\\n');
            stateBlock += \`• \${char.name}:\\n\${stateLines}\\n\`;
        }`
);

fs.writeFileSync('server/story-engine/context-manager.ts', code);
console.log("Patched sort");
