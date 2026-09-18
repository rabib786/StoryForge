import { Router } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../db/database.js';
import { storyEngine, generationLocks } from '../story-engine/story-engine.js';
import { providerManager } from '../providers/manager.js';
import { contextManager } from '../story-engine/context-manager.js';
import { characterStateManager } from '../models/character-state.js';
import { characterStateProposalManager } from '../models/character-state-proposal.js';
import { consistencyEngine } from '../story-engine/consistency-engine.js';

export const branchesRouter = Router();

// Fork branch
branchesRouter.post('/:id/fork', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;
    let { messageId, name } = req.body;

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    if (!messageId) {
      messageId = branch.head_message_id;
    } else {
      // Validate message belongs to session
      const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(messageId) as any;
      if (!msg) {
        return res.status(404).json({ error: 'Message not found' });
      }
      if (msg.session_id !== branch.session_id) {
        return res.status(400).json({ error: 'Message does not belong to session' });
      }
    }

    const newBranchId = crypto.randomUUID();
    const now = new Date().toISOString();
    const branchName = (name && name.trim()) ? name.trim() : 'Alternate Timeline';

    db.transaction(() => {
      // Deactivate current active branch
      db.prepare('UPDATE story_branches SET is_active = 0, updated_at = ? WHERE session_id = ? AND is_active = 1').run(now, branch.session_id);
      
      // Create new branch
      db.prepare(`
        INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 0, ?, ?)
      `).run(newBranchId, branch.session_id, branchName, messageId, now, now);
    })();

    const newBranch = db.prepare('SELECT * FROM story_branches WHERE id = ?').get(newBranchId);
    res.status(201).json({ branch: newBranch });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Activate branch
branchesRouter.put('/:id/active', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;

    const branch = db.prepare('SELECT id, session_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare('UPDATE story_branches SET is_active = 0, updated_at = ? WHERE session_id = ? AND is_active = 1').run(now, branch.session_id);
      db.prepare('UPDATE story_branches SET is_active = 1, updated_at = ? WHERE id = ?').run(now, branchId);
    })();

    const updatedBranch = db.prepare('SELECT * FROM story_branches WHERE id = ?').get(branchId);
    res.json({ branch: updatedBranch });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Rename branch
branchesRouter.put('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Valid name is required' });
    }

    const branch = db.prepare('SELECT id FROM story_branches WHERE id = ?').get(branchId);
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE story_branches SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), now, branchId);

    const updatedBranch = db.prepare('SELECT * FROM story_branches WHERE id = ?').get(branchId);
    res.json({ branch: updatedBranch });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete branch
branchesRouter.delete('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;

    const branch = db.prepare('SELECT id, session_id, is_active FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    db.transaction(() => {
      if (branch.is_active) {
        // Try to find another non-archived branch
        const anotherBranch = db.prepare('SELECT id FROM story_branches WHERE session_id = ? AND id != ? AND is_archived = 0 LIMIT 1').get(branch.session_id, branchId) as any;
        if (!anotherBranch) {
          throw new Error('Cannot delete the only active branch in a session');
        }
        const now = new Date().toISOString();
        db.prepare('UPDATE story_branches SET is_active = 1, updated_at = ? WHERE id = ?').run(now, anotherBranch.id);
      }
      db.prepare('DELETE FROM story_branches WHERE id = ?').run(branchId);
    })();

    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot delete the only active branch')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});


// Rewind branch
branchesRouter.post('/:id/rewind', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;
    const { targetMessageId } = req.body;

    if (!targetMessageId) {
      return res.status(400).json({ error: 'targetMessageId is required' });
    }

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const targetMsg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(targetMessageId) as any;
    if (!targetMsg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (targetMsg.session_id !== branch.session_id) {
      return res.status(400).json({ error: 'Message does not belong to session' });
    }

    // Verify targetMessageId is an ancestor of the current branch head
    const path = db.prepare(`
      WITH RECURSIVE path(id, parent_message_id) AS (
        SELECT id, parent_message_id FROM messages WHERE id = ?
        UNION ALL
        SELECT m.id, m.parent_message_id
        FROM messages m
        JOIN path p ON m.id = p.parent_message_id
      )
      SELECT id FROM path WHERE id = ?
    `).get(branch.head_message_id, targetMessageId);

    if (!path && branch.head_message_id !== targetMessageId) {
      return res.status(400).json({ error: 'targetMessageId is not an ancestor of the current branch head' });
    }

    const newBranchId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.transaction(() => {
      // Create snapshot branch
      db.prepare(`
        INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
        VALUES (?, ?, 'Auto-Save: Before Rewind', ?, 0, 1, ?, ?)
      `).run(newBranchId, branch.session_id, branch.head_message_id, now, now);

      // Rewind active branch
      db.prepare('UPDATE story_branches SET head_message_id = ?, updated_at = ? WHERE id = ?').run(targetMessageId, now, branchId);
    })();

    const updatedBranch = db.prepare('SELECT * FROM story_branches WHERE id = ?').get(branchId);
    res.json({ branch: updatedBranch });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Edit message
branchesRouter.post('/:id/messages/:messageId/edit', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;
    const messageId = req.params.messageId;
    const { content } = req.body;

    if (content === undefined || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Valid content is required' });
    }

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const origMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
    if (!origMsg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (origMsg.session_id !== branch.session_id) {
      return res.status(400).json({ error: 'Message does not belong to session' });
    }

    // Check if the message is on the active path
    let pathQuery = null;
    if (branch.head_message_id) {
        pathQuery = db.prepare(`
          WITH RECURSIVE path(id, parent_message_id) AS (
            SELECT id, parent_message_id FROM messages WHERE id = ?
            UNION ALL
            SELECT m.id, m.parent_message_id
            FROM messages m
            JOIN path p ON m.id = p.parent_message_id
          )
          SELECT id FROM path WHERE id = ?
        `).get(branch.head_message_id, messageId);
    }

    if (!pathQuery) {
        // Technically it could still be edited if we want to allow editing disconnected nodes, but the prompt says:
        // "First determine whether messageId is on the branch's active path."
        return res.status(400).json({ error: 'Message is not on the active path of the branch' });
    }

    // Check concurrency lock
    if (generationLocks.has(branchId)) {
      return res.status(429).json({ error: 'Generation is already in progress for this branch.' });
    }

    const newMsgId = crypto.randomUUID();
    const now = new Date().toISOString();

    const maxSeqRow = db.prepare('SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?').get(branch.session_id) as any;
    const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

    db.transaction(() => {
      // Create new sibling node attached to the original message's parent
      db.prepare(`
        INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, active_generation_id, sequence_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newMsgId,
        branch.session_id,
        origMsg.parent_message_id,
        origMsg.sender_type,
        content.trim(),
        origMsg.is_ooc,
        origMsg.active_generation_id, // If AI, preserve generation record association
        nextSeq,
        now,
        now
      );

      // Move branch head
      db.prepare('UPDATE story_branches SET head_message_id = ?, updated_at = ? WHERE id = ?').run(newMsgId, now, branchId);
      db.prepare('UPDATE story_sessions SET updated_at = ? WHERE id = ?').run(now, branch.session_id);
    })();

    const editedMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(newMsgId);
    res.json({ message: editedMsg });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Regenerate message
branchesRouter.post('/:id/messages/:messageId/regenerate', async (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;
    const messageId = req.params.messageId;

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const origMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
    if (!origMsg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (origMsg.session_id !== branch.session_id) {
      return res.status(400).json({ error: 'Message does not belong to session' });
    }

    if (origMsg.sender_type !== 'ai') {
      return res.status(400).json({ error: 'Can only regenerate AI messages' });
    }

    // Determine if message is on active path
    let pathQuery = null;
    if (branch.head_message_id) {
      pathQuery = db.prepare(`
        WITH RECURSIVE path(id, parent_message_id) AS (
          SELECT id, parent_message_id FROM messages WHERE id = ?
          UNION ALL
          SELECT m.id, m.parent_message_id
          FROM messages m
          JOIN path p ON m.id = p.parent_message_id
        )
        SELECT id FROM path WHERE id = ?
      `).get(branch.head_message_id, messageId);
    }

    if (!pathQuery) {
      return res.status(400).json({ error: 'Message is not on the active path of the branch' });
    }

    // Check if it's the current leaf
    const isLeaf = (messageId === branch.head_message_id);

    // Call storyEngine for regeneration? Wait, storyEngine currently has `generateResponse` which takes `GenerateStoryResponseOptions`. 
    // Regeneration requires us to invoke the AI provider but skip adding the user message, or maybe use `contextManager` up to `origMsg.parent_message_id`.
    // Let's implement it here directly or in a helper, using providerManager.

    if (generationLocks.has(branchId)) {
      return res.status(429).json({ error: 'Generation is already in progress for this branch.' });
    }
    generationLocks.add(branchId);

    try {
      const chronicle = db.prepare('SELECT chronicle_id FROM story_sessions WHERE id = ?').get(branch.session_id) as any;
      const derivedChronicleId = chronicle.chronicle_id;

      // Prepare context up to the PARENT of the message we're regenerating
      // So we need a temporary branch pointer or we use a contextManager method if available.
      // Wait, contextManager.prepareContext uses `branchId`. If we temporarily need context up to `origMsg.parent_message_id`, we can just fetch it manually, OR we can use contextManager and modify the result.
      // Actually, we can fetch the context up to the parent.
      
      const sessionData = db.prepare(`
        SELECT c.*, s.opening_message, s.genre 
        FROM story_sessions c
        JOIN chronicles s ON s.id = c.chronicle_id
        WHERE c.id = ?
      `).get(branch.session_id) as any;

      const persona = sessionData.active_persona_id ? db.prepare('SELECT * FROM personas WHERE id = ?').get(sessionData.active_persona_id) as any : null;

      const pathQueryCtx = db.prepare(`
        WITH RECURSIVE path(depth, id, parent_message_id, session_id, sender_type, content, is_ooc, active_generation_id, sequence_order, created_at, updated_at) AS (
            SELECT 0, id, parent_message_id, session_id, sender_type, content, is_ooc, active_generation_id, sequence_order, created_at, updated_at
            FROM messages WHERE id = ?
            UNION ALL
            SELECT p.depth + 1, m.id, m.parent_message_id, m.session_id, m.sender_type, m.content, m.is_ooc, m.active_generation_id, m.sequence_order, m.created_at, m.updated_at
            FROM messages m
            JOIN path p ON m.id = p.parent_message_id
        )
        SELECT * FROM path ORDER BY depth DESC
      `).all(origMsg.parent_message_id);

      const ctxMessages = pathQueryCtx.map((m: any) => ({
        role: m.sender_type === 'user' ? 'user' : 'model',
        content: m.content
      }));

      // Basic system instructions since we're bypassing contextManager's full complexity, or we could just use contextManager.prepareContext by creating a fake branch or using the logic.
      // Let's use contextManager's prepareContext directly, but how? It only accepts `branchId`.
      // The easiest way is to temporarily fork a branch, use it, and delete it! Or just do it.
      // Wait, contextManager's prepareContext doesn't mutate. But it relies on `branch.head_message_id`.
      // Let's mock a branch in the DB inside a transaction? No, can't nest transaction like this easily if we generate asynchronously.
      // Let's insert a temp branch, get context, delete temp branch!
      const tempBranchId = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
        VALUES (?, ?, 'Temp Regen', ?, 0, 1, ?, ?)
      `).run(tempBranchId, branch.session_id, origMsg.parent_message_id, now, now);

      // contextManager imported at top
      const preparedContext = contextManager.prepareContext({
        chronicleId: derivedChronicleId,
        sessionId: branch.session_id,
        branchId: tempBranchId,
      });

      db.prepare('DELETE FROM story_branches WHERE id = ?').run(tempBranchId);

      const activeConfig = providerManager.getActiveProviderAndModel();
      const selectedProviderId = activeConfig.providerId;
      const selectedModelId = activeConfig.modelId;
      const provider = providerManager.getProvider(selectedProviderId);

      const tempRow = db.prepare("SELECT value FROM settings WHERE key = 'generation_temperature'").get() as { value: string } | undefined;
      const maxTokRow = db.prepare("SELECT value FROM settings WHERE key = 'generation_max_tokens'").get() as { value: string } | undefined;
      const temperature = tempRow ? parseFloat(tempRow.value) : 0.85;
      const maxOutputTokens = maxTokRow ? parseInt(maxTokRow.value, 10) : 1024;

      const result = await provider.generate(selectedModelId, preparedContext.messages, {
        systemInstruction: preparedContext.systemInstruction,
        temperature,
        maxOutputTokens,
      });

      const genId = crypto.randomUUID();
      const aiTimestamp = new Date().toISOString();
      let aiMsgId: string = crypto.randomUUID();
      let nextSeqAI = origMsg.sequence_order;

      db.transaction(() => {
        // Stale head check
        const currentBranchState = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(branchId) as any;
        if (currentBranchState.head_message_id !== branch.head_message_id) {
          throw new Error('Stale branch head. Branch advanced concurrently while generating.');
        }

        if (isLeaf) {
          // Case A - leaf AI message
          aiMsgId = messageId;
          
          db.prepare(`
            INSERT INTO message_generations (id, message_id, provider_id, model_id, content, tokens_used, generation_time_ms, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          `).run(genId, aiMsgId, selectedProviderId, selectedModelId, result.content, result.tokensUsed || 0, result.generationTimeMs, aiTimestamp);

          db.prepare(`
            UPDATE messages SET content = ?, active_generation_id = ?, updated_at = ? WHERE id = ?
          `).run(result.content, genId, aiTimestamp, aiMsgId);

        } else {
          // Case B - ancestor AI message
          const maxSeqRowAI = db.prepare('SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?').get(branch.session_id) as any;
          nextSeqAI = (maxSeqRowAI?.maxSeq ?? -1) + 1;

          db.prepare(`
            INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, active_generation_id, sequence_order, created_at, updated_at)
            VALUES (?, ?, ?, 'ai', ?, 0, ?, ?, ?, ?)
          `).run(aiMsgId, branch.session_id, origMsg.parent_message_id, result.content, genId, nextSeqAI, aiTimestamp, aiTimestamp);

          db.prepare(`
            INSERT INTO message_generations (id, message_id, provider_id, model_id, content, tokens_used, generation_time_ms, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          `).run(genId, aiMsgId, selectedProviderId, selectedModelId, result.content, result.tokensUsed || 0, result.generationTimeMs, aiTimestamp);
          
          db.prepare('UPDATE story_branches SET head_message_id = ?, updated_at = ? WHERE id = ?').run(aiMsgId, aiTimestamp, branchId);
        }

        db.prepare('UPDATE story_sessions SET updated_at = ? WHERE id = ?').run(aiTimestamp, branch.session_id);
      })();

      const editedMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(aiMsgId);
      res.json({ message: editedMsg });

    } catch (err: unknown) {
      throw err;
    } finally {
      generationLocks.delete(branchId);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Stale branch head')) {
      return res.status(409).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});


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

// Mutate branch character state (Phase 5.8 canonical mutation path)
branchesRouter.post('/:id/character-states', (req, res) => {
  try {
    const branchId = req.params.id;
    let { characterId, stateKey, value } = req.body;

    if (!characterId || !stateKey || value === undefined) {
      return res.status(400).json({ error: 'Missing characterId, stateKey, or value' });
    }

    const result = characterStateManager.applyBranchStateMutation({
      branchId,
      characterId,
      stateKey,
      value,
    });

    res.status(201).json({ state: result.state });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('forbidden') || msg.includes('Cross-chronicle')) {
      return res.status(403).json({ error: msg });
    }
    if (msg.includes('Missing') || msg.includes('narrative position')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// List proposals for branch (Phase 5.10)
branchesRouter.get('/:id/proposals', (req, res) => {
  try {
    const db = getDatabase();
    const branchId = req.params.id;
    const branch = db.prepare('SELECT id, session_id FROM story_branches WHERE id = ?').get(branchId) as any;
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const { status, characterId } = req.query;
    const proposals = characterStateProposalManager.getProposalsByBranch(branchId, {
      status: status as any,
      characterId: characterId as any,
    });

    res.json({
      branchId,
      sessionId: branch.session_id,
      proposals,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Approve proposal on branch (Phase 5.10)
branchesRouter.post('/:id/proposals/:proposalId/approve', (req, res) => {
  try {
    const branchId = req.params.id;
    const proposalId = req.params.proposalId;

    const result = characterStateProposalManager.approveProposal(proposalId, branchId);
    res.json({
      success: true,
      proposal: result.proposal,
      state: result.state,
      alreadyApproved: result.alreadyApproved || false,
    });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('does not belong') || msg.includes('forbidden')) {
      return res.status(403).json({ error: msg });
    }
    if (msg.includes('stale') || msg.includes('Cannot approve') || msg.includes('Invalid')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// Reject proposal on branch (Phase 5.10)
branchesRouter.post('/:id/proposals/:proposalId/reject', (req, res) => {
  try {
    const branchId = req.params.id;
    const proposalId = req.params.proposalId;

    const updated = characterStateProposalManager.rejectProposal(proposalId, branchId);
    res.json({
      success: true,
      proposal: updated,
    });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('does not belong') || msg.includes('forbidden')) {
      return res.status(403).json({ error: msg });
    }
    if (msg.includes('Cannot reject')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// Analyze consistency on branch (Phase 5.11)
branchesRouter.post('/:id/consistency/analyze', async (req, res) => {
  try {
    const branchId = req.params.id;
    const { atMessageId, narrativeText, chronicleId, providerId, modelId } = req.body || {};
    const userId = (req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId) as string | undefined;

    const result = await consistencyEngine.analyzeConsistency({
      branchId,
      atMessageId,
      narrativeText,
      chronicleId,
      userId,
      providerId,
      modelId,
    });

    res.json(result);
  } catch (err: unknown) {
    const status = (err as any)?.status;
    const msg = String((err as any)?.message || err);
    if (status) {
      return res.status(status).json({ error: msg });
    }
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('forbidden') || msg.includes('Cross-user') || msg.includes('unauthorized')) {
      return res.status(403).json({ error: msg });
    }
    if (msg.includes('Cross-branch') || msg.includes('does not belong') || msg.includes('rejected')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});


