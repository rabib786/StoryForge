const fs = require('fs');
let code = fs.readFileSync('server/story-engine/character-state-extractor.ts', 'utf8');

const conflictTarget = `             const existing = validCandidates.get(hash);
             if (existing.stateValue !== val) {
                 validCandidates.delete(hash); // Reject conflicting
                 // We could mark it as explicitly invalid, but deleting it simply ignores it.
             }`;

const newConflict = `             const existing = validCandidates.get(hash);
             if (existing.stateValue !== val) {
                 return { success: false, error: 'Conflicting batch states', statesExtracted: 0 };
             }`;

code = code.replace(conflictTarget, newConflict);

fs.writeFileSync('server/story-engine/character-state-extractor.ts', code);
console.log("Patched conflict");
