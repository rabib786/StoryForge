const fs = require('fs');
let code = fs.readFileSync('test/character-state-extraction.test.ts', 'utf8');

const oldCheck = `        const bigString = 'a'.repeat(300);
        res = await testExtraction({ states: [{ characterId: charA, stateKey: 'mood', stateValue: bigString }] });
        assert(res.success && res.statesExtracted === 1, 'Value extracted');
        states = characterStateManager.getVisibleCharacterStates(branchId);
        assert(states.find(s => s.state_key === 'mood')!.state_value!.length <= 255, 'Oversized value truncated/rejected (enforced 255 max)');`;

const newCheck = `        const bigString = 'a'.repeat(300);
        res = await testExtraction({ states: [{ characterId: charA, stateKey: 'mood', stateValue: bigString }] });
        assert(res.success && res.statesExtracted === 0, 'Oversized value rejected');`;

code = code.replace(oldCheck, newCheck);

const oldConflict = `        res = await testExtraction({ states: [
            { characterId: charA, stateKey: 'mood', stateValue: 'happy' },
            { characterId: charA, stateKey: 'mood', stateValue: 'sad' }
        ]});
        assert(res.success && res.statesExtracted === 0, 'Conflicting duplicate state entries rejected');`;

const newConflict = `        res = await testExtraction({ states: [
            { characterId: charA, stateKey: 'mood', stateValue: 'happy' },
            { characterId: charA, stateKey: 'mood', stateValue: 'sad' }
        ]});
        assert(!res.success && res.error === 'Conflicting batch states', 'Conflicting duplicate state entries rejected');`;

code = code.replace(oldConflict, newConflict);

fs.writeFileSync('test/character-state-extraction.test.ts', code);
console.log("Patched test");
