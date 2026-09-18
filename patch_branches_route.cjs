const fs = require('fs');
let code = fs.readFileSync('server/routes/story-branches.ts', 'utf8');

// Ensure characterStateManager is imported
if (!code.includes("characterStateManager")) {
  code = code.replace(
    "import { contextManager } from '../story-engine/context-manager.js';",
    "import { contextManager } from '../story-engine/context-manager.js';\nimport { characterStateManager } from '../models/character-state.js';"
  );
}

const newRoute = `
// Get branch character states
branchesRouter.get('/:id/character-states', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    if (!branch.head_message_id) {
      // Empty branch
      return res.json({
        branchId: branch.id,
        sessionId: branch.session_id,
        characters: []
      });
    }

    const session = db.prepare('SELECT id, chronicle_id FROM story_sessions WHERE id = ?').get(branch.session_id) as any;
    
    // Get visible character states for this branch
    const visibleStates = characterStateManager.getVisibleCharacterStates(branchId);
    
    // We only want to return non-null states
    const activeStates = visibleStates.filter(s => s.state_value !== null);

    // Get story characters for this chronicle
    const storyCharacters = db.prepare('SELECT id, name, role, background, personality FROM story_characters WHERE chronicle_id = ? ORDER BY name ASC').all(session.chronicle_id) as any[];

    // Group states by character
    const charMap = new Map();
    
    for (const char of storyCharacters) {
      charMap.set(char.id, {
        characterId: char.id,
        characterName: char.name,
        role: char.role,
        background: char.background,
        personality: char.personality,
        states: []
      });
    }

    for (const state of activeStates) {
      if (charMap.has(state.character_id)) {
        charMap.get(state.character_id).states.push({
          key: state.state_key,
          value: state.state_value,
          sourceMessageId: state.source_message_id,
          updatedAt: state.updated_at
        });
      }
    }

    // Only return characters that actually have some dynamic state or are part of the active canon
    // Requirement says: "The response may combine: STATIC CHARACTER DATA ... with: DYNAMIC CHARACTER STATE"
    // We can return all characters or only those with states. Let's return characters that have states for simplicity, 
    // or maybe all canonical characters. Let's return all canonical characters so the API exposes the full resolved character state 
    // (canonical + dynamic).
    
    // Sort states deterministically by key for each character
    const characters = Array.from(charMap.values()).map(char => {
      char.states.sort((a: any, b: any) => a.key.localeCompare(b.key));
      return char;
    });

    res.json({
      branchId: branch.id,
      sessionId: branch.session_id,
      characters
    });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});
`;

code = code + '\n' + newRoute;

fs.writeFileSync('server/routes/story-branches.ts', code);
console.log("Patched branchesRouter");
