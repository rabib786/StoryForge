const fs = require('fs');
let code = fs.readFileSync('test/character-state-behavioral-context.test.ts', 'utf8');

code = code.replace(
  `  providerManager.getProvider = () => ({
    generate: async (modelId: string, messages: any[], opts: any) => {
      generatedSystemInstruction = opts.systemInstruction || '';
      return { content: 'Mock response generating a new state', tokensUsed: 10, generationTimeMs: 100 };
    }
  } as any);`,
  `  providerManager.getProvider = () => ({
    generate: async (modelId: string, messages: any[], opts: any) => {
      if (!opts.systemInstruction?.includes('CHARACTER STATE EXTRACTION')) {
        generatedSystemInstruction = opts.systemInstruction || '';
      }
      return { content: '{"states": []}', tokensUsed: 10, generationTimeMs: 100 };
    }
  } as any);`
);

code = code.replace(
  `  providerManager.getProvider = (providerId) => {
    if (providerId === 'mock') {
        return {
            generate: async (modelId: string, messages: any[], opts: any) => {
              if (opts.systemInstruction && opts.systemInstruction.includes('CHARACTER STATE EXTRACTION')) {
                  // This is the extraction call
                  return { content: \`{"states": [{"characterId": "\${charMiraId}", "stateKey": "mood", "stateValue": "happy"}]}\`, tokensUsed: 10, generationTimeMs: 100 };
              }
              // This is the main story generation
              return { content: 'Mock response generating a new state', tokensUsed: 10, generationTimeMs: 100 };
            }
        } as any;
    }
    return null;
  };`,
  `  providerManager.getProvider = () => ({
    generate: async (modelId: string, messages: any[], opts: any) => {
      if (opts.systemInstruction && opts.systemInstruction.includes('CHARACTER STATE EXTRACTION')) {
          return { content: \`{"states": [{"characterId": "\${charMiraId}", "stateKey": "mood", "stateValue": "happy"}]}\`, tokensUsed: 10, generationTimeMs: 100 };
      }
      return { content: 'Mock response generating a new state', tokensUsed: 10, generationTimeMs: 100 };
    }
  } as any);`
);

fs.writeFileSync('test/character-state-behavioral-context.test.ts', code);
console.log("Patched mock");
