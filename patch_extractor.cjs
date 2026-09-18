const fs = require('fs');
let code = fs.readFileSync('server/story-engine/character-state-extractor.ts', 'utf8');

const importSchema = `import { ALLOWED_STATE_KEYS, validateAndNormalizeStateValue } from '../models/character-state-schema.js';\n`;
code = code.replace(`import { characterStateManager }`, importSchema + `import { characterStateManager }`);

code = code.replace(
  `const ALLOWED_KEYS = ['health_status', 'injured', 'alive', 'conscious', 'location', 'trust_player', 'fear_player', 'relationship_status', 'has_item', 'mood', 'equipped_weapon'];`,
  `const ALLOWED_KEYS = ALLOWED_STATE_KEYS;`
);

const validationLoop = `          const val = st.stateValue === null ? null : String(st.stateValue).substring(0, 255); // Enforce max length and stringify
          
          const hash = \`\${st.characterId}:\${st.stateKey}\`;`;

const newValidationLoop = `          const validation = validateAndNormalizeStateValue(st.stateKey, st.stateValue);
          if (!validation.isValid) continue;
          const val = validation.normalizedValue === undefined ? null : validation.normalizedValue;
          
          const hash = \`\${st.characterId}:\${st.stateKey}\`;`;

code = code.replace(validationLoop, newValidationLoop);

fs.writeFileSync('server/story-engine/character-state-extractor.ts', code);
console.log("Patched extractor");
