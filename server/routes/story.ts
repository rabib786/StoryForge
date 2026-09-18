import { Router } from 'express';
import { storyEngine } from '../story-engine/story-engine.js';
import { contextManager } from '../story-engine/context-manager.js';

export const storyRouter = Router();

storyRouter.post('/generate', async (req, res) => {
  try {
    const {
      sessionId,
      session_id,
      chronicleId,
      chronicle_id,
      branchId,
      branch_id,
      atMessageId,
      at_message_id,
      characterId,
      character_id,
      characterIds,
      character_ids,
      userMessage,
      isOoc,
      providerId,
      modelId
    } = req.body;
    const targetSessionId = sessionId || session_id;
    const targetChronicleId = chronicleId || chronicle_id;
    const targetBranchId = branchId || branch_id;
    const targetAtMessageId = atMessageId || at_message_id;
    const targetCharacterId = characterId || character_id;
    const targetCharacterIds = characterIds || character_ids;

    if (!targetSessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await storyEngine.generateResponse({
      sessionId: String(targetSessionId),
      chronicleId: targetChronicleId ? String(targetChronicleId) : undefined,
      branchId: targetBranchId ? String(targetBranchId) : undefined,
      atMessageId: targetAtMessageId ? String(targetAtMessageId) : undefined,
      characterId: targetCharacterId ? String(targetCharacterId) : undefined,
      characterIds: Array.isArray(targetCharacterIds) ? targetCharacterIds.map(String) : undefined,
      userMessage,
      isOoc: !!isOoc,
      providerId,
      modelId,
    });

    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }

    res.json(result);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('mismatch') || errorMsg.includes('ownership') || errorMsg.includes('Unauthorized') || errorMsg.includes('belong')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});

// Development Diagnostic: Inspect Context without generating
storyRouter.get('/inspect-context', (req, res) => {
  try {
    const {
      sessionId,
      session_id,
      chronicleId,
      chronicle_id,
      branchId,
      branch_id,
      atMessageId,
      at_message_id,
      characterId,
      character_id,
      characterIds,
      character_ids,
      userMessage
    } = req.query;
    const targetSessionId = sessionId || session_id;
    const targetChronicleId = chronicleId || chronicle_id;
    const targetBranchId = branchId || branch_id;
    const targetAtMessageId = atMessageId || at_message_id;
    const targetCharacterId = characterId || character_id;
    let targetCharacterIds: string[] | undefined;
    if (characterIds) {
      targetCharacterIds = Array.isArray(characterIds) ? (characterIds as string[]) : [String(characterIds)];
    } else if (character_ids) {
      targetCharacterIds = Array.isArray(character_ids) ? (character_ids as string[]) : [String(character_ids)];
    }

    if (!targetSessionId) {
      return res.status(400).json({ error: 'sessionId query parameter is required' });
    }

    const prepared = contextManager.buildGenerationContext({
      sessionId: String(targetSessionId),
      chronicleId: targetChronicleId ? String(targetChronicleId) : undefined,
      branchId: targetBranchId ? String(targetBranchId) : undefined,
      atMessageId: targetAtMessageId ? String(targetAtMessageId) : undefined,
      characterId: targetCharacterId ? String(targetCharacterId) : undefined,
      characterIds: targetCharacterIds,
      userMessage: userMessage ? String(userMessage) : undefined,
    });

    res.json({
      diagnostic: prepared.diagnostic,
      systemInstruction: prepared.systemInstruction,
      messagesCount: prepared.messages.length,
      messages: prepared.messages,
      resolvedCharacters: prepared.resolvedCharacters,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('mismatch') || errorMsg.includes('ownership') || errorMsg.includes('Unauthorized') || errorMsg.includes('belong')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});
