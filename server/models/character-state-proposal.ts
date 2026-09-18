import { getDatabase } from '../db/database.js';
import crypto from 'crypto';
import { CharacterStateProposal } from '../../src/types/index.js';
import { ALLOWED_STATE_KEYS, validateAndNormalizeStateValue } from './character-state-schema.js';
import { characterStateManager } from './character-state.js';

export interface CreateProposalInput {
  chronicleId: string;
  sessionId: string;
  branchId: string;
  characterId: string;
  sourceMessageId: string;
  stateKey: string;
  proposedValue: string | null;
  reason?: string | null;
}

export const characterStateProposalManager = {
  createProposal(input: CreateProposalInput): CharacterStateProposal {
    const db = getDatabase();

    // 1. Validate stateKey
    if (!ALLOWED_STATE_KEYS.includes(input.stateKey)) {
      throw new Error(`Invalid state key '${input.stateKey}'. Must be one of: ${ALLOWED_STATE_KEYS.join(', ')}`);
    }

    // 2. Validate proposed value
    const validation = validateAndNormalizeStateValue(input.stateKey, input.proposedValue);
    if (!validation.isValid) {
      throw new Error(`Invalid proposed value for key '${input.stateKey}': ${validation.error || 'Value validation failed'}`);
    }
    const normalizedValue = validation.normalizedValue === undefined ? null : validation.normalizedValue;

    // 3. Validate branch and session
    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(input.branchId) as any;
    if (!branch) {
      throw new Error(`Branch ${input.branchId} not found`);
    }
    if (branch.session_id !== input.sessionId) {
      throw new Error(`Branch ${input.branchId} does not belong to session ${input.sessionId}`);
    }

    // 4. Validate chronicle and character
    const session = db.prepare('SELECT id, chronicle_id FROM story_sessions WHERE id = ?').get(input.sessionId) as any;
    if (!session || session.chronicle_id !== input.chronicleId) {
      throw new Error(`Session ${input.sessionId} does not belong to chronicle ${input.chronicleId}`);
    }

    const char = db.prepare('SELECT id, chronicle_id FROM story_characters WHERE id = ?').get(input.characterId) as any;
    if (!char) {
      throw new Error(`Character ${input.characterId} not found`);
    }
    if (char.chronicle_id !== input.chronicleId) {
      throw new Error('Cross-chronicle character state relationship is forbidden');
    }

    // 5. Validate source message
    const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(input.sourceMessageId) as any;
    if (!msg) {
      throw new Error(`Source message ${input.sourceMessageId} not found`);
    }
    if (msg.session_id !== input.sessionId) {
      throw new Error('Source message does not belong to session');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO character_state_proposals (
        id, chronicle_id, session_id, branch_id, character_id,
        source_message_id, state_key, proposed_value, reason,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.chronicleId,
      input.sessionId,
      input.branchId,
      input.characterId,
      input.sourceMessageId,
      input.stateKey,
      normalizedValue,
      input.reason || null,
      now,
      now
    );

    return this.getProposalById(id);
  },

  getProposalById(id: string): CharacterStateProposal {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT p.*, c.name as character_name
      FROM character_state_proposals p
      JOIN story_characters c ON p.character_id = c.id
      WHERE p.id = ?
    `).get(id) as CharacterStateProposal;

    if (!row) throw new Error('Character state proposal not found');
    return row;
  },

  getProposalsByBranch(branchId: string, options?: { status?: 'pending' | 'approved' | 'rejected'; characterId?: string }): CharacterStateProposal[] {
    const db = getDatabase();
    let query = `
      SELECT p.*, c.name as character_name
      FROM character_state_proposals p
      JOIN story_characters c ON p.character_id = c.id
      WHERE p.branch_id = ?
    `;
    const params: any[] = [branchId];

    if (options?.status) {
      query += ` AND p.status = ?`;
      params.push(options.status);
    }
    if (options?.characterId) {
      query += ` AND p.character_id = ?`;
      params.push(options.characterId);
    }

    query += ` ORDER BY p.created_at ASC`;
    return db.prepare(query).all(...params) as CharacterStateProposal[];
  },

  getProposalsBySourceMessage(sourceMessageId: string): CharacterStateProposal[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT p.*, c.name as character_name
      FROM character_state_proposals p
      JOIN story_characters c ON p.character_id = c.id
      WHERE p.source_message_id = ?
      ORDER BY p.created_at ASC
    `).all(sourceMessageId) as CharacterStateProposal[];
  },

  approveProposal(proposalId: string, expectedBranchId?: string): { proposal: CharacterStateProposal; state: any; alreadyApproved?: boolean } {
    const db = getDatabase();
    const proposal = this.getProposalById(proposalId);

    // 1. Branch mismatch check (Section 29)
    if (expectedBranchId && proposal.branch_id !== expectedBranchId) {
      throw new Error(`Proposal ${proposalId} does not belong to branch ${expectedBranchId}`);
    }

    // 2. Idempotent check (Section 27)
    if (proposal.status === 'approved') {
      let existingState = null;
      if (proposal.applied_state_id) {
        try {
          existingState = characterStateManager.getCharacterStateById(proposal.applied_state_id);
        } catch (_) {
          // If state was pruned or removed
        }
      }
      return { proposal, state: existingState, alreadyApproved: true };
    }

    if (proposal.status === 'rejected') {
      throw new Error('Cannot approve a rejected proposal');
    }

    // 3. Validate branch existence and session/chronicle binding
    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(proposal.branch_id) as any;
    if (!branch) {
      throw new Error('Branch associated with proposal no longer exists');
    }

    // 4. Verify source message is in branch ancestry
    const isAncestor = db.prepare(`
      WITH RECURSIVE message_path(id, parent_message_id) AS (
        SELECT id, parent_message_id FROM messages WHERE id = ?
        UNION ALL
        SELECT m.id, m.parent_message_id FROM messages m JOIN message_path mp ON m.id = mp.parent_message_id
      )
      SELECT 1 FROM message_path WHERE id = ? LIMIT 1
    `).get(branch.head_message_id, proposal.source_message_id);

    if (!isAncestor) {
      throw new Error('Proposal source message is no longer in the active branch ancestry');
    }

    // 5. Stale check (Section 21)
    // Check if a newer canonical state mutation for this character and state key already exists on this branch after source_message
    const newerMutations = db.prepare(`
      WITH RECURSIVE message_path(id, parent_message_id, sequence_order) AS (
        SELECT id, parent_message_id, sequence_order FROM messages WHERE id = ?
        UNION ALL
        SELECT m.id, m.parent_message_id, m.sequence_order FROM messages m JOIN message_path mp ON m.id = mp.parent_message_id
      )
      SELECT cs.id, cs.state_value, cs.created_at, mp.sequence_order
      FROM character_states cs
      JOIN message_path mp ON cs.source_message_id = mp.id
      WHERE cs.character_id = ?
        AND cs.state_key = ?
        AND (
          mp.sequence_order > (SELECT sequence_order FROM messages WHERE id = ?)
          OR cs.created_at > proposal_time
        )
      ORDER BY mp.sequence_order DESC, cs.created_at DESC
      LIMIT 1
    `.replace('proposal_time', '?')).get(
      branch.head_message_id,
      proposal.character_id,
      proposal.state_key,
      proposal.source_message_id,
      proposal.created_at
    ) as any;

    if (newerMutations) {
      throw new Error('Proposal is stale: a newer state mutation already exists for this character and state key');
    }

    // 6. Commit through Phase 5.8 canonical mutation path
    const now = new Date().toISOString();
    let appliedState: any;

    db.transaction(() => {
      const mutationResult = characterStateManager.applyBranchStateMutation({
        branchId: proposal.branch_id,
        characterId: proposal.character_id,
        stateKey: proposal.state_key,
        value: proposal.proposed_value,
        reason: proposal.reason || undefined,
      });

      appliedState = mutationResult.state;

      db.prepare(`
        UPDATE character_state_proposals
        SET status = 'approved', applied_state_id = ?, updated_at = ?
        WHERE id = ?
      `).run(appliedState.id, now, proposalId);
    })();

    const updatedProposal = this.getProposalById(proposalId);
    return { proposal: updatedProposal, state: appliedState };
  },

  rejectProposal(proposalId: string, expectedBranchId?: string): CharacterStateProposal {
    const db = getDatabase();
    const proposal = this.getProposalById(proposalId);

    if (expectedBranchId && proposal.branch_id !== expectedBranchId) {
      throw new Error(`Proposal ${proposalId} does not belong to branch ${expectedBranchId}`);
    }

    if (proposal.status === 'rejected') {
      return proposal; // idempotent
    }

    if (proposal.status === 'approved') {
      throw new Error('Cannot reject an already approved proposal');
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE character_state_proposals
      SET status = 'rejected', updated_at = ?
      WHERE id = ?
    `).run(now, proposalId);

    return this.getProposalById(proposalId);
  }
};
