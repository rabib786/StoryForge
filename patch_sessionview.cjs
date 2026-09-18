const fs = require('fs');
let code = fs.readFileSync('src/components/SessionView.tsx', 'utf8');

// 1. Add import
if (!code.includes("import { CharacterStatePanel }")) {
  code = code.replace(
    "import { BranchNavigator } from './BranchNavigator';",
    "import { BranchNavigator } from './BranchNavigator';\nimport { CharacterStatePanel } from './CharacterStatePanel';"
  );
}

// 2. Add refresh state
if (!code.includes("const [characterStatesRefreshTrigger")) {
  code = code.replace(
    "const [showInspector, setShowInspector] = useState(false);",
    "const [showInspector, setShowInspector] = useState(false);\n  const [characterStatesRefreshTrigger, setCharacterStatesRefreshTrigger] = useState(0);"
  );
}

// 3. Update refresh triggers
const triggersToUpdate = [
  "setMemories((prev) => [...prev, created.memory]);", 
  "setGenerating(false);", 
  "setMessages((prev) => [...prev, created.message]);", 
  "const result = await api.createBranch",
  "const result = await api.rewindBranch",
  "await api.updateMessage"
];

let modifiedCode = code;
// To make it easy, any time we refresh branch or messages, we also increment trigger
// Let's find handleBranchSelect
modifiedCode = modifiedCode.replace(
  /const handleBranchSelect = async \(branchId: string\) => \{([^}]+)\};/,
  (match, p1) => {
     if (match.includes('setCharacterStatesRefreshTrigger')) return match;
     return match.replace(/setActiveBranchId\(branchId\);/, "setActiveBranchId(branchId);\n    setCharacterStatesRefreshTrigger(prev => prev + 1);");
  }
);

// We'll just hook into fetchBranchMessages (which runs on branch load/switch/generation)
// Wait, character state only changes when a NEW message arrives or a branch switch occurs.
// So we can increment the trigger inside the dependency array of branch change, 
// and inside handleGenerate, handleFork, handleRewind.

// 4. Update inspector tab types
modifiedCode = modifiedCode.replace(
  "const [inspectorTab, setInspectorTab] = useState<'memories' | 'cards' | 'budget'>('memories');",
  "const [inspectorTab, setInspectorTab] = useState<'memories' | 'cards' | 'budget' | 'characters'>('memories');"
);

// 5. Add tab button
const tabButtons = `
              <button
                onClick={() => setInspectorTab('characters')}
                className={\`pb-2.5 font-semibold transition border-b-2 \${
                  inspectorTab === 'characters'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }\`}
              >
                Character States
              </button>
`;

modifiedCode = modifiedCode.replace(
  /<button\s+onClick=\{\(\) => setInspectorTab\('cards'\)\}[^>]+>\s*Active Story Cards[^\n]+\n\s*<\/button>/,
  match => match + tabButtons
);

// 6. Add tab content
const tabContent = `
              {inspectorTab === 'characters' && (
                <div className="h-full overflow-y-auto custom-scrollbar p-1">
                  <CharacterStatePanel activeBranchId={activeBranchId} refreshTrigger={characterStatesRefreshTrigger} />
                </div>
              )}
`;

modifiedCode = modifiedCode.replace(
  /\{inspectorTab === 'budget' && diagnostic && \([\s\S]*?\}\)\n\s*<\/div>\n\s*<\/div>\n\s*<\/div>\n\s*\)\}/,
  match => match.replace("          </div>\n          </div>\n        </div>\n      )}", "          </div>\n" + tabContent + "          </div>\n        </div>\n      )}")
);

fs.writeFileSync('src/components/SessionView.tsx', modifiedCode);
console.log("Patched SessionView.tsx");
