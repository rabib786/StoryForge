import crypto from 'crypto';
import { getDatabase } from '../db/database.js';
import { contextManager } from './context-manager.js';
import { providerManager } from '../providers/manager.js';
import { characterStateExtractor } from './character-state-extractor.js';
import { memoryEngine } from './memory-engine.js';

export interface GenerateStoryResponseOptions {
  sessionId: string;
  branchId?: string;
  chronicleId?: string;
  userMessage?: string;
  isOoc?: boolean;
  providerId?: string;
  modelId?: string;
  atMessageId?: string;
  characterId?: string;
  characterIds?: string[];
}

// Branch generation lock (Phase 4.2)
export const generationLocks = new Set<string>();

export class StoryEngine {
  async generateResponse(options: GenerateStoryResponseOptions): Promise<{
    success: boolean;
    error?: string;
    statusCode?: number;
    userMessageId?: string | null;
    aiMessage?: any;
    diagnostic?: any;
    resolvedCharacters?: any;
    memoriesExtracted?: number;
    proposals?: any[];
    proposalsCreated?: number;
    statesExtracted?: number;
  }> {
    const db = getDatabase();

    // 1. Validate sessionId
    if (!options.sessionId) {
      return { success: false, error: 'sessionId is required', statusCode: 400 };
    }

    // 2. Load story_session by sessionId
    const session = db.prepare(`
      SELECT id, chronicle_id, active_persona_id, title
      FROM story_sessions
      WHERE id = ?
    `).get(options.sessionId) as { id: string; chronicle_id: string; active_persona_id: string | null; title: string; } | undefined;

    if (!session) {
      return { success: false, error: `Story session not found: ${options.sessionId}`, statusCode: 404 };
    }

    const derivedChronicleId = session.chronicle_id;
    if (options.chronicleId && options.chronicleId !== derivedChronicleId) {
      return { success: false, error: `Chronicle ownership mismatch`, statusCode: 400 };
    }

    const chronicle = db.prepare('SELECT id, title FROM chronicles WHERE id = ?').get(derivedChronicleId);
    if (!chronicle) {
      return { success: false, error: `Chronicle not found`, statusCode: 404 };
    }

    // Phase 4.2: Resolve active branch
    let resolvedBranchId = options.branchId;
    if (!resolvedBranchId) {
       const activeBranch = db.prepare('SELECT id FROM story_branches WHERE session_id = ? AND is_active = 1').get(options.sessionId) as { id: string } | undefined;
       if (!activeBranch) {
           return { success: false, error: 'No active branch found', statusCode: 404 };
       }
       resolvedBranchId = activeBranch.id;
    }

    const branch = db.prepare('SELECT id, session_id, head_message_id FROM story_branches WHERE id = ?').get(resolvedBranchId) as { id: string, session_id: string, head_message_id: string | null } | undefined;
    if (!branch) {
      return { success: false, error: 'Story branch not found', statusCode: 404 };
    }
    if (branch.session_id !== options.sessionId) {
      return { success: false, error: 'Branch does not belong to session', statusCode: 400 };
    }

    // 7. Check branch concurrency lock
    if (generationLocks.has(resolvedBranchId)) {
      return { success: false, error: 'Generation is already in progress for this branch.', statusCode: 429 };
    }
    generationLocks.add(resolvedBranchId);

    try {
      const now = new Date().toISOString();
      let userMsgId: string | null = null;
      let currentHeadId = branch.head_message_id;

      // 8. Persist player message and advance head
      if (options.userMessage && options.userMessage.trim()) {
        userMsgId = crypto.randomUUID();
        const maxSeqRow = db.prepare('SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?').get(options.sessionId) as { maxSeq: number | null };
        const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

        db.transaction(() => {
           // Stale head check inside transaction
           const currentBranchState = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(resolvedBranchId) as any;
           if (currentBranchState.head_message_id !== currentHeadId) {
               throw new Error('Stale branch head. Branch advanced concurrently.');
           }

           db.prepare(`
             INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at)
             VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)
           `).run(userMsgId, options.sessionId, currentHeadId, options.userMessage!.trim(), options.isOoc ? 1 : 0, nextSeq, now, now);
           
           db.prepare('UPDATE story_branches SET head_message_id = ?, updated_at = ? WHERE id = ?').run(userMsgId, now, resolvedBranchId);
           db.prepare('UPDATE story_sessions SET updated_at = ? WHERE id = ?').run(now, options.sessionId);
           db.prepare('UPDATE chronicles SET updated_at = ? WHERE id = ?').run(now, derivedChronicleId);
        })();
        currentHeadId = userMsgId;
      }

      // 9. Prepare structured context using server-derived Chronicle and branch
      const preparedContext = contextManager.prepareContext({
        chronicleId: derivedChronicleId,
        sessionId: options.sessionId,
        branchId: resolvedBranchId,
        atMessageId: userMsgId || options.atMessageId,
        characterId: options.characterId,
        characterIds: options.characterIds,
      });

      // Invoke Narrative Generation Provider
      const activeConfig = providerManager.getActiveProviderAndModel();
      const selectedProviderId = options.providerId || activeConfig.providerId;
      const selectedModelId = options.modelId || activeConfig.modelId;
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

      // Persist AI message and generation version in transaction
      const aiMsgId = crypto.randomUUID();
      const genId = crypto.randomUUID();
      const aiTimestamp = new Date().toISOString();

      const maxSeqRowAI = db.prepare('SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?').get(options.sessionId) as { maxSeq: number | null };
      const nextSeqAI = (maxSeqRowAI?.maxSeq ?? -1) + 1;

      db.transaction(() => {
        // Stale head check inside transaction before AI message commit
        const currentBranchState = db.prepare('SELECT head_message_id FROM story_branches WHERE id = ?').get(resolvedBranchId) as any;
        if (currentBranchState.head_message_id !== currentHeadId) {
            throw new Error('Stale branch head. Branch advanced concurrently while generating.');
        }

        db.prepare(`
          INSERT INTO messages (id, session_id, parent_message_id, sender_type, content, is_ooc, active_generation_id, sequence_order, created_at, updated_at)
          VALUES (?, ?, ?, 'ai', ?, 0, ?, ?, ?, ?)
        `).run(aiMsgId, options.sessionId, currentHeadId, result.content, genId, nextSeqAI, aiTimestamp, aiTimestamp);

        db.prepare(`
          INSERT INTO message_generations (id, message_id, provider_id, model_id, content, tokens_used, generation_time_ms, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(genId, aiMsgId, selectedProviderId, selectedModelId, result.content, result.tokensUsed || 0, result.generationTimeMs, aiTimestamp);

        db.prepare('UPDATE story_branches SET head_message_id = ?, updated_at = ? WHERE id = ?').run(aiMsgId, aiTimestamp, resolvedBranchId);
        db.prepare('UPDATE story_sessions SET updated_at = ? WHERE id = ?').run(aiTimestamp, options.sessionId);
        db.prepare('UPDATE chronicles SET updated_at = ? WHERE id = ?').run(aiTimestamp, derivedChronicleId);
      })();

      let memoriesExtracted = 0;
      let proposalsExtracted: any[] = [];
      
      try {
        const stateResult = await characterStateExtractor.extractProposals({
          chronicleId: derivedChronicleId,
          sessionId: options.sessionId,
          branchId: resolvedBranchId,
          sourceMessageId: aiMsgId,
          aiResponse: result.content,
          providerId: selectedProviderId,
          modelId: selectedModelId,
        });
        if (stateResult.success) {
          proposalsExtracted = stateResult.proposals || [];
        }
      } catch (stErr) {
        console.warn('[StoryEngine] State extraction caught error safely:', stErr);
      }
      
      try {
        const memResult = await memoryEngine.extractAndPersistMemories({
          chronicleId: derivedChronicleId,
          sessionId: options.sessionId,
          userMessage: options.userMessage,
          aiResponse: result.content,
          sourceMessageId: aiMsgId,
          providerId: selectedProviderId,
          modelId: selectedModelId,
        });
        if (memResult.success) {
          memoriesExtracted = memResult.memoriesCreated;
        }
      } catch (memErr) {
        console.warn('[StoryEngine] Memory extraction caught error safely:', memErr);
      }

      return {
        success: true,
        userMessageId: userMsgId,
        aiMessage: {
          id: aiMsgId,
          session_id: options.sessionId,
          parent_message_id: currentHeadId,
          sender_type: 'ai',
          content: result.content,
          is_ooc: 0,
          sequence_order: nextSeqAI,
          created_at: aiTimestamp,
          updated_at: aiTimestamp,
          generation: {
            id: genId,
            provider_id: selectedProviderId,
            model_id: selectedModelId,
            tokens_used: result.tokensUsed,
            generation_time_ms: result.generationTimeMs,
          },
        },
        diagnostic: preparedContext.diagnostic,
        resolvedCharacters: preparedContext.resolvedCharacters,
        memoriesExtracted,
        proposals: proposalsExtracted,
        proposalsCreated: proposalsExtracted.length,
        statesExtracted: 0, // No direct canonical state mutation in Phase 5.10!
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[StoryEngine Error]', errorMsg);
      return {
        success: false,
        error: `Unable to generate story response: ${errorMsg}. Your input has been saved safely.`,
      };
    } finally {
      generationLocks.delete(resolvedBranchId);
    }
  }
}
export const storyEngine = new StoryEngine();
