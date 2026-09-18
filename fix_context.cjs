const fs = require('fs');
let code = fs.readFileSync('server/story-engine/context-manager.ts', 'utf8');

// Add import
const importMem = `import { memoryEngine, ScoredMemory } from './memory-engine.js';`;
const importState = `\nimport { characterStateManager } from '../models/character-state.js';`;
code = code.replace(importMem, importMem + importState);

const targetCast = `    // [4] STORY CAST / NPCS
    if (storyCharacters.length > 0) {
      const charBlock = storyCharacters.map((c) =>
        \`• NPC "\${c.name}"\${c.title ? \` (\${c.title})\` : ''}: Role: \${c.role || 'ai'}, Personality: \${c.personality || 'Unknown'}, Background: \${c.background || 'None'}, Speech Style: \${c.speech_style || 'Natural'}, Instructions: \${c.behavior_instructions || ''}\`
      ).join('\\n');
      systemParts.push(\`[STORY CAST / NPCS]\\nYou control these characters:\\n\${charBlock}\`);
    }`;

const replaceCast = `    // [4] STORY CAST / NPCS
    if (storyCharacters.length > 0) {
      const charBlock = storyCharacters.map((c) =>
        \`• NPC "\${c.name}"\${c.title ? \` (\${c.title})\` : ''}: Role: \${c.role || 'ai'}, Personality: \${c.personality || 'Unknown'}, Background: \${c.background || 'None'}, Speech Style: \${c.speech_style || 'Natural'}, Instructions: \${c.behavior_instructions || ''}\`
      ).join('\\n');
      systemParts.push(\`[STORY CAST / NPCS]\\nYou control these characters:\\n\${charBlock}\`);
    }

    // [4.1] DYNAMIC CHARACTER STATES
    const visibleStates = characterStateManager.getVisibleCharacterStates(branchId);
    if (visibleStates.length > 0) {
      // Group states by character
      const stateMap = new Map<string, Array<{ key: string; value: string }>>();
      for (const state of visibleStates) {
        if (state.state_value !== null) {
          if (!stateMap.has(state.character_id)) stateMap.set(state.character_id, []);
          stateMap.get(state.character_id).push({ key: state.state_key, value: state.state_value });
        }
      }

      if (stateMap.size > 0) {
        let stateBlock = \`[DYNAMIC CHARACTER STATES]\\nThe following states reflect timeline-specific facts for the current story branch:\\n\`;
        for (const [charId, states] of stateMap.entries()) {
          const char = storyCharacters.find(c => c.id === charId);
          if (char) {
            const stateLines = states.map(s => \`  - \${s.key}: \${s.value}\`).join('\\n');
            stateBlock += \`• \${char.name}:\\n\${stateLines}\\n\`;
          }
        }
        systemParts.push(stateBlock.trim());
      }
    }`;

code = code.replace(targetCast, replaceCast);

fs.writeFileSync('server/story-engine/context-manager.ts', code);
console.log("Updated context manager");
