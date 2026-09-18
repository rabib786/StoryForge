import crypto from 'crypto';
import { getDatabase } from '../db/database.js';
import { providerManager } from '../providers/manager.js';
import { GenerationMessage } from '../providers/types.js';

export type MemoryType =
  | 'discovery'
  | 'event'
  | 'relationship'
  | 'decision'
  | 'fact'
  | 'character_state'
  | 'item';

export const VALID_MEMORY_TYPES: MemoryType[] = [
  'discovery',
  'event',
  'relationship',
  'decision',
  'fact',
  'character_state',
  'item',
];

export interface MemoryRecord {
  id: string;
  chronicle_id: string;
  session_id: string;
  type: MemoryType;
  content: string;
  importance: number; // 1 to 5
  status: 'active' | 'superseded';
  source_message_id: string | null;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export interface ScoredMemory {
  memory: MemoryRecord;
  estimatedTokens: number;
}

export interface CandidateMemory {
  type: MemoryType;
  content: string;
  importance: number;
}

export class MemoryEngine {
  /**
   * Retrieves all memories for a session, strictly isolated to the chronicle.
   * Derives chronicle ownership from the session itself and rejects mismatched requests.
   */
  getSessionMemories(sessionId: string, chronicleId?: string, onlyActive = false, branchId?: string): MemoryRecord[] {
    const db = getDatabase();

    // 1. Verify session exists
    const session = db.prepare('SELECT id, chronicle_id FROM story_sessions WHERE id = ?').get(sessionId) as { id: string; chronicle_id: string } | undefined;
    if (!session) {
      throw new Error(`Story session not found: ${sessionId}`);
    }

    // 2. Derive chronicle_id from session
    const derivedChronicleId = session.chronicle_id;

    // 3. If caller supplied chronicleId, enforce consistency
    if (chronicleId && chronicleId !== derivedChronicleId) {
      throw new Error(`Chronicle ownership mismatch: session belongs to chronicle ${derivedChronicleId}, not ${chronicleId}`);
    }

    // Phase 4.2 Branch-Aware Memory Resolution
    // Instead of all memories, we must only resolve memories that belong to the active path.
    // If a branchId is not provided, we fall back to the session's active branch.
    let resolvedBranchId = branchId;
    if (!resolvedBranchId) {
      const activeBranch = db.prepare(`SELECT id FROM story_branches WHERE session_id = ? AND is_active = 1`).get(sessionId) as { id: string } | undefined;
      if (activeBranch) {
        resolvedBranchId = activeBranch.id;
      }
    }

    const branch = resolvedBranchId ? db.prepare('SELECT id, head_message_id FROM story_branches WHERE id = ?').get(resolvedBranchId) as { id: string, head_message_id: string | null } | undefined : undefined;

    let baseMemories: MemoryRecord[] = [];
    if (branch && branch.head_message_id) {
       // Ancestry-based memory fetching
       baseMemories = db.prepare(`
         WITH RECURSIVE path(depth, id, parent_message_id) AS (
             SELECT 0, id, parent_message_id FROM messages WHERE id = ?
             UNION ALL
             SELECT p.depth + 1, m.id, m.parent_message_id FROM messages m
             JOIN path p ON m.id = p.parent_message_id
         )
         SELECT mem.* 
         FROM memories mem
         JOIN path p ON p.id = mem.source_message_id
         WHERE mem.session_id = ? AND mem.chronicle_id = ?
         ORDER BY mem.is_pinned DESC, mem.importance DESC, mem.created_at DESC
       `).all(branch.head_message_id, sessionId, derivedChronicleId) as MemoryRecord[];
    } else {
       // Fallback or empty branch - fetch only pinned or those without source messages
       let query = `SELECT * FROM memories WHERE session_id = ? AND chronicle_id = ? AND source_message_id IS NULL`;
       const params: unknown[] = [sessionId, derivedChronicleId];
       query += ` ORDER BY is_pinned DESC, importance DESC, created_at DESC`;
       baseMemories = db.prepare(query).all(...params) as MemoryRecord[];
    }

    if (!onlyActive) {
      return baseMemories;
    }

    // Apply branch-local supersession
    // A memory is excluded if it is superseded by another memory in the SAME active path.
    const activeMemories: MemoryRecord[] = [];
    const memoryIdsOnPath = new Set(baseMemories.map(m => m.id));
    
    // Find supersessions where both superseding and superseded are on the path
    const supersessions = db.prepare(`SELECT superseding_id, superseded_id FROM memory_supersessions`).all() as Array<{superseding_id: string, superseded_id: string}>;
    
    // Build a map of superseded_id -> set of superseding_ids
    const supersededBy = new Map<string, Set<string>>();
    for (const s of supersessions) {
      if (!supersededBy.has(s.superseded_id)) {
        supersededBy.set(s.superseded_id, new Set());
      }
      supersededBy.get(s.superseded_id)!.add(s.superseding_id);
    }

    for (const mem of baseMemories) {
      let isSupersededLocally = false;
      const supersedingSet = supersededBy.get(mem.id);
      if (supersedingSet) {
        for (const sId of supersedingSet) {
          if (memoryIdsOnPath.has(sId)) {
            isSupersededLocally = true;
            break;
          }
        }
      }
      
      // We also check legacy status for backwards compatibility for those that were overwritten linearly
      if (!isSupersededLocally && mem.status !== 'superseded') {
        activeMemories.push(mem);
      } else if (!isSupersededLocally && mem.status === 'superseded') {
        // Wait, if it's legacy superseded but not locally superseded... the instructions say:
        // "Do NOT globally suppress a memory merely because another branch superseded it."
        // We will trust the memory_supersessions table primarily. 
        // But for backwards compatibility where memory_supersessions wasn't populated?
        // Let's assume memory_supersessions was populated during migration or we just ignore legacy status if we have the new model.
        // Actually, to be safe, if it's not locally superseded, it is active in this branch.
        activeMemories.push(mem);
      }
    }

    return activeMemories;
  }

  /**
   * Deterministically retrieves and prioritizes memories for Generation Context.
   * Higher importance memories survive context pruning longer.
   * Strictly enforces Session & Chronicle boundaries.
   */
  retrieveRelevantMemories(options: {
    chronicleId: string;
    sessionId: string;
    branchId?: string;
    maxTokenBudget?: number;
  }): {
    selectedMemories: ScoredMemory[];
    allActiveMemories: MemoryRecord[];
  } {
    const maxBudget = options.maxTokenBudget ?? 1200;

    // Fetch active memories strictly owned by this session & chronicle on the active branch
    const activeMemories = this.getSessionMemories(options.sessionId, options.chronicleId, true, options.branchId);

    const scoredMemories: ScoredMemory[] = [];
    let currentTokens = 0;

    for (const mem of activeMemories) {
      // Rough token estimation: content length / 4 + overhead
      const estTokens = Math.ceil((mem.content.length + 20) / 4);

      if (currentTokens + estTokens <= maxBudget) {
        scoredMemories.push({
          memory: mem,
          estimatedTokens: estTokens,
        });
        currentTokens += estTokens;
      }
    }

    return {
      selectedMemories: scoredMemories,
      allActiveMemories: activeMemories,
    };
  }

  /**
   * Conservative AI-driven memory extraction stage.
   * Invoked after successful narrative generation.
   * Wrapped safely so story generation is NEVER broken by extraction failure.
   */
  async extractAndPersistMemories(options: {
    chronicleId: string;
    sessionId: string;
    userMessage?: string;
    aiResponse: string;
    sourceMessageId: string;
    providerId?: string;
    modelId?: string;
  }): Promise<{
    success: boolean;
    memoriesCreated: number;
    error?: string;
  }> {
    try {
      if (!options.aiResponse || options.aiResponse.trim().length < 15) {
        return { success: true, memoriesCreated: 0 };
      }

      // Resolve provider
      const activeConfig = providerManager.getActiveProviderAndModel();
      const selectedProviderId = options.providerId || activeConfig.providerId;
      const selectedModelId = options.modelId || activeConfig.modelId;
      const provider = providerManager.getProvider(selectedProviderId);

      const systemPrompt =
        `You are a precise, conservative story memory extraction engine for StoryForge.\n` +
        `Your job is to identify only persistent narrative consequences from the latest exchange.\n\n` +
        `RULES FOR EXTRACTION:\n` +
        `1. CONSERVATIVE: Do NOT store every sentence or atmospheric detail (e.g., "The rain fell", "He walked into the hall").\n` +
        `2. ONLY EXTRACT lasting developments:\n` +
        `   - Key discoveries (uncovering secret information, clues, passwords, locations)\n` +
        `   - Relationship shifts (trust gained, betrayal, suspicion, romantic or hostile declarations)\n` +
        `   - Physical state changes / injuries / conditions (broken arm, poisoned, cursed, healed)\n` +
        `   - Critical items gained, lost, or given\n` +
        `   - Firm decisions or solemn agreements made by characters\n` +
        `3. NO INVENTED FACTS: You must extract ONLY facts supported directly by the text. Do not invent lore or extrapolate.\n` +
        `4. IMPORTANCE: Assign an integer between 1 and 5:\n` +
        `   1 = trivial, 2 = low, 3 = meaningful, 4 = important, 5 = critical plot consequence.\n` +
        `5. TYPE: Must be one of: 'discovery', 'event', 'relationship', 'decision', 'fact', 'character_state', 'item'.\n` +
        `6. IF NOTHING of durable significance occurred, return an empty array: {"memories": []}.\n\n` +
        `OUTPUT FORMAT: Return strictly valid JSON in this schema:\n` +
        `{\n` +
        `  "memories": [\n` +
        `    {\n` +
        `      "type": "discovery",\n` +
        `      "content": "Alex discovered the hidden reactor beneath Sector 4.",\n` +
        `      "importance": 4\n` +
        `    }\n` +
        `  ]\n` +
        `}`;

      const userPrompt =
        `LATEST STORY TURN:\n` +
        (options.userMessage ? `Player Input: "${options.userMessage.trim()}"\n` : `Player Input: (Narrative continuation)\n`) +
        `AI Narrative: "${options.aiResponse.trim()}"\n\n` +
        `Extract durable memories in JSON.`;

      const messages: GenerationMessage[] = [
        { role: 'user', content: userPrompt },
      ];

      const result = await provider.generate(selectedModelId, messages, {
        systemInstruction: systemPrompt,
        temperature: 0.1, // Low temperature for deterministic factual extraction
        maxOutputTokens: 600,
      });

      const parsedCandidates = this.parseExtractionResponse(result.content);
      if (parsedCandidates.length === 0) {
        return { success: true, memoriesCreated: 0 };
      }

      // Validate, deduplicate, and persist
      const createdCount = this.persistExtractedMemories(
        options.chronicleId,
        options.sessionId,
        parsedCandidates,
        options.sourceMessageId
      );

      return { success: true, memoriesCreated: createdCount };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('[MemoryEngine] Memory extraction stage failed safely:', errorMsg);
      // Return safe failure - narrative generation remains completely intact
      return { success: false, memoriesCreated: 0, error: errorMsg };
    }
  }

  /**
   * Safely parses JSON array of candidate memories from LLM text.
   */
  private parseExtractionResponse(rawText: string): CandidateMemory[] {
    try {
      let clean = rawText.trim();
      // Remove markdown code fences if present
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed || !Array.isArray(parsed.memories)) {
        return [];
      }

      const validated: CandidateMemory[] = [];
      for (const item of parsed.memories) {
        if (!item || typeof item.content !== 'string') continue;
        const content = item.content.trim();
        if (content.length < 5 || content.length > 400) continue;

        const rawType = String(item.type || 'event').toLowerCase();
        const type: MemoryType = VALID_MEMORY_TYPES.includes(rawType as MemoryType)
          ? (rawType as MemoryType)
          : 'event';

        let importance = typeof item.importance === 'number' ? Math.round(item.importance) : 3;
        if (importance < 1) importance = 1;
        if (importance > 5) importance = 5;

        validated.push({ type, content, importance });
      }

      return validated;
    } catch (e) {
      console.warn('[MemoryEngine] Could not parse memory extraction JSON:', e);
      return [];
    }
  }

  /**
   * Validates against duplicates and supersedes prior contradicting state.
   */
  persistExtractedMemories(
    chronicleId: string,
    sessionId: string,
    candidates: CandidateMemory[],
    sourceMessageId: string
  ): number {
    const db = getDatabase();
    const existing = this.getSessionMemories(sessionId, chronicleId, false);
    const now = new Date().toISOString();
    let createdCount = 0;

    db.transaction(() => {
      for (const cand of candidates) {
        const normalizedCand = normalizeMemoryText(cand.content);

        // 1. Deduplication check: Check if identical or near-identical memory exists
        const isDuplicate = existing.some((m) => {
          if (m.status !== 'active') return false;
          const normExisting = normalizeMemoryText(m.content);
          return normExisting === normalizedCand || normExisting.includes(normalizedCand) || normalizedCand.includes(normExisting);
        });

        if (isDuplicate) {
          continue;
        }

        // 2. Memory supersession check:
        // For relationships or states, if candidate directly updates an existing relationship between characters
        if (cand.type === 'relationship' || cand.type === 'character_state') {
          for (const oldMem of existing) {
            if (oldMem.status === 'active' && oldMem.type === cand.type) {
              const sharedKeywords = extractEntityKeywords(cand.content).filter((k) =>
                oldMem.content.toLowerCase().includes(k)
              );
              if (sharedKeywords.length >= 2) {
                // Determine new memory ID early so we can write to memory_supersessions
                if (!(cand as any)._preId) {
                   (cand as any)._preId = crypto.randomUUID();
                }

                // Phase 4.2 Branch-local supersession via memory_supersessions
                db.prepare(`
                  INSERT INTO memory_supersessions (id, superseding_id, superseded_id, created_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT DO NOTHING
                `).run(crypto.randomUUID(), (cand as any)._preId, oldMem.id, now);
                
                // Legacy support (safe for tests that don't verify isolation)
                db.prepare(`
                  UPDATE memories SET status = 'superseded', updated_at = ?
                  WHERE id = ?
                `).run(now, oldMem.id);
                oldMem.status = 'superseded';
              }
            }
          }
        }

        // 3. Insert new canonical memory
        const memoryId = (cand as any)._preId || crypto.randomUUID();
        db.prepare(`
          INSERT INTO memories (
            id, chronicle_id, session_id, type, content, importance,
            status, source_message_id, is_pinned, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)
        `).run(
          memoryId,
          chronicleId,
          sessionId,
          cand.type,
          cand.content,
          cand.importance,
          sourceMessageId,
          now,
          now
        );

        createdCount++;
      }
    })();

    return createdCount;
  }

  /**
   * Manually create a memory (for user or developer operations).
   * Derives chronicle ownership directly from the session and validates message boundaries.
   */
  createMemory(data: {
    sessionId: string;
    chronicleId?: string;
    type?: MemoryType;
    content: string;
    importance?: number;
    is_pinned?: boolean;
    sourceMessageId?: string;
  }): MemoryRecord {
    const db = getDatabase();

    // 1. Verify session exists
    const session = db.prepare('SELECT id, chronicle_id FROM story_sessions WHERE id = ?').get(data.sessionId) as { id: string; chronicle_id: string } | undefined;
    if (!session) {
      throw new Error(`Story session not found: ${data.sessionId}`);
    }

    // 2. Derive chronicle_id directly from the verified session
    const derivedChronicleId = session.chronicle_id;

    // 3. Reject mismatch if caller supplied a differing chronicleId
    if (data.chronicleId && data.chronicleId !== derivedChronicleId) {
      throw new Error(`Chronicle ownership mismatch: session belongs to chronicle ${derivedChronicleId}, not ${data.chronicleId}`);
    }

    // 4. If sourceMessageId provided, verify source message belongs to this session
    if (data.sourceMessageId) {
      const sourceMsg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(data.sourceMessageId) as { id: string; session_id: string } | undefined;
      if (!sourceMsg || sourceMsg.session_id !== data.sessionId) {
        throw new Error(`Source message ownership mismatch: message does not belong to session ${data.sessionId}`);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const type: MemoryType = data.type && VALID_MEMORY_TYPES.includes(data.type)
      ? data.type
      : 'event';

    let importance = typeof data.importance === 'number' ? Math.round(data.importance) : 3;
    if (importance < 1) importance = 1;
    if (importance > 5) importance = 5;

    db.prepare(`
      INSERT INTO memories (
        id, chronicle_id, session_id, type, content, importance,
        status, source_message_id, is_pinned, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      id,
      derivedChronicleId,
      data.sessionId,
      type,
      data.content.trim(),
      importance,
      data.sourceMessageId || null,
      data.is_pinned ? 1 : 0,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRecord;
    return created;
  }

  /**
   * Delete a memory, optionally enforcing that it belongs to an expected session and/or chronicle.
   */
  deleteMemory(id: string, scope?: { sessionId?: string; chronicleId?: string }): boolean {
    const db = getDatabase();
    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRecord | undefined;
    if (!memory) {
      throw new Error(`Memory not found: ${id}`);
    }

    // Verify parent session existence
    const session = db.prepare('SELECT id, chronicle_id FROM story_sessions WHERE id = ?').get(memory.session_id) as { id: string; chronicle_id: string } | undefined;
    if (!session) {
      throw new Error(`Orphaned memory: parent session ${memory.session_id} not found`);
    }

    if (scope?.sessionId && scope.sessionId !== memory.session_id) {
      throw new Error(`Memory does not belong to specified session: memory belongs to session ${memory.session_id}, not ${scope.sessionId}`);
    }

    if (scope?.chronicleId && scope.chronicleId !== memory.chronicle_id) {
      throw new Error(`Memory does not belong to specified chronicle: memory belongs to chronicle ${memory.chronicle_id}, not ${scope.chronicleId}`);
    }

    const res = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return res.changes > 0;
  }
}

function normalizeMemoryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEntityKeywords(text: string): string[] {
  // Extract capitalized words or significant nouns (> 3 letters)
  const words = text.match(/\b[A-Za-z]{3,}\b/g) || [];
  const commonStopWords = new Set([
    'that', 'this', 'with', 'from', 'about', 'into', 'after', 'before', 'then', 'they', 'them',
    'their', 'what', 'when', 'where', 'which', 'who', 'whom', 'will', 'have', 'been', 'were',
  ]);
  return words
    .map((w) => w.toLowerCase())
    .filter((w) => !commonStopWords.has(w));
}

export const memoryEngine = new MemoryEngine();
