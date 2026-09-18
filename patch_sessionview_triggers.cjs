const fs = require('fs');
let code = fs.readFileSync('src/components/SessionView.tsx', 'utf8');

// Refresh on generation completion
code = code.replace(
  "setMessages((prev) => [...prev, created.message]);",
  "setMessages((prev) => [...prev, created.message]);\n      setCharacterStatesRefreshTrigger(prev => prev + 1);"
);

code = code.replace(
  "setGenerating(false);",
  "setGenerating(false);\n      setCharacterStatesRefreshTrigger(prev => prev + 1);"
);

// Refresh on edit
code = code.replace(
  "setMessages(updated);",
  "setMessages(updated);\n      setCharacterStatesRefreshTrigger(prev => prev + 1);"
);

// Refresh on rewind
code = code.replace(
  "await fetchBranchMessages(activeBranchId);",
  "await fetchBranchMessages(activeBranchId);\n      setCharacterStatesRefreshTrigger(prev => prev + 1);"
);

// Branch change
// find handleBranchSelect
if (code.includes('const handleBranchSelect = async (branchId: string) => {') && !code.includes('setCharacterStatesRefreshTrigger(prev => prev + 1);', code.indexOf('handleBranchSelect'))) {
  code = code.replace(
    "setActiveBranchId(branchId);",
    "setActiveBranchId(branchId);\n    setCharacterStatesRefreshTrigger(prev => prev + 1);"
  );
}

fs.writeFileSync('src/components/SessionView.tsx', code);
console.log("Patched SessionView.tsx triggers");
