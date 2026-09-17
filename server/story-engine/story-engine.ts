import crypto from 'crypto';
import { getDatabase } from '../db/database.js';
import { contextManager } from './context-manager.js';
import { providerManager } from '../providers/manager.js';
import { memoryEngine } from './memory-engine.js';

export interface GenerateStoryResponseOptions {
  sessionId: string;
  chronicleId?: string;
  userMessage?: string;
  isOoc?: boolean;
  providerId?: string;
  modelId?: string;
}

// Session generation lock
const generationLocks = new Set<string>();

export class StoryEngine {
  async generateResponse(options: GenerateStoryResponseOptions): Promise<{
    success: boolean;
    error?: string;
    statusCode?: number;
    userMessageId?: string | null;
    aiMessage?: any;
    diagnostic?: any;
    memoriesExtracted?: number;
  }> {
    const db = getDatabase();

    // 1. Validate sessionId
    if (!options.sessionId) {
      return {
        success: false,
        error: 'sessionId is required',
        statusCode: 400,
      };
    }

    // 2. Load story_session by sessionId
    const session = db.prepare(`
      SELECT id, chronicle_id, active_persona_id, title
      FROM story_sessions
      WHERE id = ?
    `).get(options.sessionId) as {
      id: string;
      chronicle_id: string;
      active_persona_id: string | null;
      title: string;
    } | undefined;

    if (!session) {
      return {
        success: false,
        error: `Story session not found: ${options.sessionId}`,
        statusCode: 404,
      };
    }

    // 3. Derive chronicleId = session.chronicle_id
    const derivedChronicleId = session.chronicle_id;

    // 4. If client passed chronicleId, verify consistency before ANY database mutation
    if (options.chronicleId && options.chronicleId !== derivedChronicleId) {
      return {
        success: false,
        error: `Chronicle ownership mismatch: session belongs to chronicle ${derivedChronicleId}, not ${options.chronicleId}`,
        statusCode: 400,
      };
    }

    // 5. Load Chronicle to ensure existence
    const chronicle = db.prepare(`
      SELECT id, title FROM chronicles WHERE id = ?
    `).get(derivedChronicleId) as { id: string; title: string } | undefined;

    if (!chronicle) {
      return {
        success: false,
        error: `Chronicle not found: ${derivedChronicleId}`,
        statusCode: 404,
      };
    }

    // 6. Validate active Persona if present
    if (session.active_persona_id) {
      const persona = db.prepare(`SELECT id FROM personas WHERE id = ?`).get(session.active_persona_id);
      if (!persona) {
        console.warn(`[StoryEngine] Session ${options.sessionId} references non-existent persona ${session.active_persona_id}`);
      }
    }

    // 7. Check session concurrency lock
    if (generationLocks.has(options.sessionId)) {
      return {
        success: false,
        error: 'Generation is already in progress for this session.',
        statusCode: 429,
      };
    }

    generationLocks.add(options.sessionId);

    try {
      const now = new Date().toISOString();
      let userMsgId: string | null = null;

      // 8. Persist player message with server-derived Chronicle and Session
      if (options.userMessage && options.userMessage.trim()) {
        userMsgId = crypto.randomUUID();

        // Determine next sequence order
        const maxSeqRow = db.prepare(`
          SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?
        `).get(options.sessionId) as { maxSeq: number | null };

        const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

        db.prepare(`
          INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at)
          VALUES (?, ?, 'user', ?, ?, ?, ?, ?)
        `).run(
          userMsgId,
          options.sessionId,
          options.userMessage.trim(),
          options.isOoc ? 1 : 0,
          nextSeq,
          now,
          now
        );

        db.prepare(`UPDATE story_sessions SET updated_at = ? WHERE id = ?`).run(now, options.sessionId);
        db.prepare(`UPDATE chronicles SET updated_at = ? WHERE id = ?`).run(now, derivedChronicleId);
      }

      // 9. Prepare structured context using server-derived Chronicle
      const preparedContext = contextManager.prepareContext({
        chronicleId: derivedChronicleId,
        sessionId: options.sessionId,
      });

      // 3. Resolve Provider and Model
      const activeConfig = providerManager.getActiveProviderAndModel();
      const selectedProviderId = options.providerId || activeConfig.providerId;
      const selectedModelId = options.modelId || activeConfig.modelId;

      const provider = providerManager.getProvider(selectedProviderId);

      // Read generation preferences from settings
      const tempRow = db.prepare("SELECT value FROM settings WHERE key = 'generation_temperature'").get() as { value: string } | undefined;
      const maxTokRow = db.prepare("SELECT value FROM settings WHERE key = 'generation_max_tokens'").get() as { value: string } | undefined;

      const temperature = tempRow ? parseFloat(tempRow.value) : 0.85;
      const maxOutputTokens = maxTokRow ? parseInt(maxTokRow.value, 10) : 1024;

      // 4. Invoke Narrative Generation Provider
      const result = await provider.generate(selectedModelId, preparedContext.messages, {
        systemInstruction: preparedContext.systemInstruction,
        temperature,
        maxOutputTokens,
      });

      // 5. Persist AI message and generation version in transaction
      const aiMsgId = crypto.randomUUID();
      const genId = crypto.randomUUID();

      const maxSeqRow = db.prepare(`
        SELECT MAX(sequence_order) as maxSeq FROM messages WHERE session_id = ?
      `).get(options.sessionId) as { maxSeq: number | null };
      const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;
      const aiTimestamp = new Date().toISOString();

      db.transaction(() => {
        db.prepare(`
          INSERT INTO messages (id, session_id, sender_type, content, is_ooc, active_generation_id, sequence_order, created_at, updated_at)
          VALUES (?, ?, 'ai', ?, 0, ?, ?, ?, ?)
        `).run(
          aiMsgId,
          options.sessionId,
          result.content,
          genId,
          nextSeq,
          aiTimestamp,
          aiTimestamp
        );

        db.prepare(`
          INSERT INTO message_generations (id, message_id, provider_id, model_id, content, tokens_used, generation_time_ms, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
          genId,
          aiMsgId,
          selectedProviderId,
          selectedModelId,
          result.content,
          result.tokensUsed || 0,
          result.generationTimeMs,
          aiTimestamp
        );

        db.prepare(`UPDATE story_sessions SET updated_at = ? WHERE id = ?`).run(aiTimestamp, options.sessionId);
        db.prepare(`UPDATE chronicles SET updated_at = ? WHERE id = ?`).run(aiTimestamp, derivedChronicleId);
      })();

      // 6. Memory Extraction Stage (Background / Post-generation safe pipeline)
      // Narrative output is already persisted. Memory extraction failure will NEVER fail the story turn.
      let memoriesExtracted = 0;
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
          sender_type: 'ai',
          content: result.content,
          is_ooc: 0,
          sequence_order: nextSeq,
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
        memoriesExtracted,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[StoryEngine Error]', errorMsg);
      return {
        success: false,
        error: `Unable to generate story response: ${errorMsg}. Your input has been saved safely.`,
      };
    } finally {
      generationLocks.delete(options.sessionId);
    }
  }
}

export const storyEngine = new StoryEngine();
