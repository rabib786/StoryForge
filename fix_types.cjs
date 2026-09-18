const fs = require('fs');
let code = fs.readFileSync('src/types/index.ts', 'utf8');

const charStateType = `
export interface CharacterState {
  id: string;
  character_id: string;
  source_message_id: string;
  state_key: string;
  state_value: string | null;
  created_at: string;
  updated_at: string;
}
`;

code += charStateType;

fs.writeFileSync('src/types/index.ts', code);
console.log("Types updated");
