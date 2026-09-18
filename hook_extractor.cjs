const fs = require('fs');
let code = fs.readFileSync('server/story-engine/story-engine.ts', 'utf8');

const importTarget = `import { memoryEngine } from './memory-engine.js';`;
const newImport = `import { characterStateExtractor } from './character-state-extractor.js';\n` + importTarget;

code = code.replace(importTarget, newImport);

const extractionTarget = `      let memoriesExtracted = 0;
      try {
        const memResult = await memoryEngine.extractAndPersistMemories({`;

const newExtraction = `      let memoriesExtracted = 0;
      let statesExtracted = 0;
      
      try {
        const stateResult = await characterStateExtractor.extractAndPersistStates({
          chronicleId: derivedChronicleId,
          sessionId: options.sessionId,
          branchId: resolvedBranchId,
          sourceMessageId: aiMsgId,
          aiResponse: result.content,
          providerId: selectedProviderId,
          modelId: selectedModelId,
        });
        if (stateResult.success) {
           statesExtracted = stateResult.statesExtracted || 0;
        }
      } catch (stErr) {
        console.warn('[StoryEngine] State extraction caught error safely:', stErr);
      }
      
      try {
        const memResult = await memoryEngine.extractAndPersistMemories({`;

code = code.replace(extractionTarget, newExtraction);

fs.writeFileSync('server/story-engine/story-engine.ts', code);
console.log("Hooked extractor");
