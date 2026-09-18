import { getDatabase } from '../db/database.js';
import crypto from 'crypto';
import { CharacterState } from '../../src/types/index.js';

export const characterStateManager = {
  createCharacterState(characterId: string, sourceMessageId: string, stateKey: string, stateValue: any): CharacterState {
    const db = getDatabase();
    
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const normalizedValue = stateValue === null || stateValue === undefined ? null : String(stateValue);
    
    db.prepare(`
      INSERT INTO character_states (id, character_id, source_message_id, state_key, state_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, characterId, sourceMessageId, stateKey, normalizedValue, now, now);
    
    return this.getCharacterStateById(id);
  },
  
  getCharacterStateById(id: string): CharacterState {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM character_states WHERE id = ?').get(id) as CharacterState;
    if (!row) throw new Error('Character state not found');
    return row;
  },
  
  getVisibleCharacterStates(branchId: string, characterId?: string, atMessageId?: string): CharacterState[] {
    const db = getDatabase();
    
    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) throw new Error('Branch not found');
    
    const startMessageId = atMessageId || branch.head_message_id;
    if (!startMessageId) {
        return [];
    }

    if (atMessageId && atMessageId !== branch.head_message_id) {
        const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(atMessageId) as any;
        if (!msg || msg.session_id !== branch.session_id) {
            throw new Error(`Message ${atMessageId} does not belong to branch session`);
        }
    }

    let query = `
      WITH RECURSIVE message_path(depth, id, parent_message_id, sequence_order) AS (
        SELECT 0, id, parent_message_id, sequence_order
        FROM messages
        WHERE id = ?
        
        UNION ALL
        
        SELECT mp.depth + 1, m.id, m.parent_message_id, m.sequence_order
        FROM messages m
        JOIN message_path mp ON m.id = mp.parent_message_id
      )
      SELECT cs.*, mp.depth
      FROM character_states cs
      JOIN message_path mp ON cs.source_message_id = mp.id
    `;
    
    const params: any[] = [startMessageId];
    
    if (characterId) {
       query += ` WHERE cs.character_id = ?`;
       params.push(characterId);
    }
    
    query += ` ORDER BY mp.depth ASC, mp.sequence_order DESC, cs.created_at DESC`;
    
    const allStates = db.prepare(query).all(...params) as CharacterState[];
    
    const resolved = new Map<string, CharacterState>();
    
    for (const state of allStates) {
        const hash = `${state.character_id}:${state.state_key}`;
        if (!resolved.has(hash)) {
            resolved.set(hash, {
              id: state.id,
              character_id: state.character_id,
              source_message_id: state.source_message_id,
              state_key: state.state_key,
              state_value: state.state_value,
              created_at: state.created_at,
              updated_at: state.updated_at,
            });
        }
    }
    
    return Array.from(resolved.values());
  },

  applyBranchStateMutation(options: {
    branchId: string;
    characterId: string;
    stateKey: string;
    value: string | null;
    reason?: string;
  }): { state: CharacterState; messageId: string } {
    const db = getDatabase();
    const { branchId, characterId, stateKey, value } = options;

    if (!characterId || !stateKey || value === undefined) {
      throw new Error('Missing characterId, stateKey, or value');
    }

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      throw new Error('Branch not found');
    }

    if (!branch.head_message_id) {
      throw new Error('Branch has no narrative position (head message)');
    }

    // Verify character belongs to the same chronicle as the session
    const session = db.prepare('SELECT id, chronicle_id FROM story_sessions WHERE id = ?').get(branch.session_id) as any;
    const char = db.prepare('SELECT id, chronicle_id FROM story_characters WHERE id = ?').get(characterId) as any;
    if (!char) {
      throw new Error('Character not found');
    }
    if (char.chronicle_id !== session.chronicle_id) {
      throw new Error('Cross-chronicle character state relationship is forbidden');
    }

    const now = new Date().toISOString();
    let resultState: CharacterState;
    let newMsgId: string;

    db.transaction(() => {
      // Create a new narrative position to isolate this mutation
      const maxSeqRow = db.prepare('SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?').get(branch.session_id) as any;
      const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

      newMsgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at)
        VALUES (?, ?, ?, 'system', '[Character State Mutation]', 1, ?, ?, ?)
      `).run(newMsgId, branch.session_id, branch.head_message_id, nextSeq, now, now);

      db.prepare('UPDATE story_branches SET head_message_id = ?, updated_at = ? WHERE id = ?').run(newMsgId, now, branchId);

      resultState = this.createCharacterState(characterId, newMsgId, stateKey, value);
    })();

    return { state: resultState!, messageId: newMsgId! };
  }
};
