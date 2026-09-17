import crypto from 'crypto';
import { getDatabase } from '../db/database.js';

export interface StoryCardTrigger {
  id: string;
  story_card_id: string;
  keyword: string;
  match_type: 'contains' | 'exact';
  created_at: string;
}

export interface StoryCardRecord {
  id: string;
  chronicle_id: string;
  title: string;
  content: string;
  category: 'lore' | 'location' | 'faction' | 'item' | 'rule';
  is_pinned: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  triggers?: string[];
}

export interface ScoredStoryCard {
  card: StoryCardRecord;
  relevanceScore: number;
  matchedReasons: string[];
  estimatedTokens: number;
}

export class StoryCardEngine {
  /**
   * Retrieves all Story Cards belonging strictly to the specified Chronicle,
   * including their trigger keywords.
   */
  getChronicleStoryCards(chronicleId: string): StoryCardRecord[] {
    const db = getDatabase();
    const chronicle = db.prepare('SELECT id FROM chronicles WHERE id = ?').get(chronicleId);
    if (!chronicle) {
      throw new Error(`Chronicle not found: ${chronicleId}`);
    }

    const cards = db.prepare(`
      SELECT * FROM story_cards
      WHERE chronicle_id = ?
      ORDER BY is_pinned DESC, category ASC, title ASC
    `).all(chronicleId) as StoryCardRecord[];

    if (cards.length === 0) {
      return [];
    }

    const cardIds = cards.map((c) => c.id);
    const placeholders = cardIds.map(() => '?').join(',');
    const triggers = db.prepare(`
      SELECT story_card_id, keyword
      FROM story_card_triggers
      WHERE story_card_id IN (${placeholders})
    `).all(...cardIds) as Array<{ story_card_id: string; keyword: string }>;

    const triggerMap = new Map<string, string[]>();
    for (const t of triggers) {
      const list = triggerMap.get(t.story_card_id) || [];
      list.push(t.keyword);
      triggerMap.set(t.story_card_id, list);
    }

    return cards.map((c) => ({
      ...c,
      triggers: triggerMap.get(c.id) || [],
    }));
  }

  /**
   * Deterministically retrieves and ranks active Story Cards for a Chronicle
   * based on the player's current input and recent session history.
   * Strictly respects Chronicle boundaries and token budget.
   */
  retrieveRelevantCards(options: {
    chronicleId: string;
    userMessage?: string;
    recentHistoryText?: string;
    maxTokenBudget?: number;
  }): {
    selectedCards: ScoredStoryCard[];
    allScoredCards: ScoredStoryCard[];
  } {
    const db = getDatabase();
    const maxBudget = options.maxTokenBudget ?? 1500;

    // 1. Fetch only ACTIVE cards belonging to this Chronicle
    const activeCards = db.prepare(`
      SELECT * FROM story_cards
      WHERE chronicle_id = ? AND is_active = 1
      ORDER BY is_pinned DESC, created_at ASC
    `).all(options.chronicleId) as StoryCardRecord[];

    if (activeCards.length === 0) {
      return { selectedCards: [], allScoredCards: [] };
    }

    // 2. Fetch triggers in batch
    const cardIds = activeCards.map((c) => c.id);
    const placeholders = cardIds.map(() => '?').join(',');
    const allTriggers = db.prepare(`
      SELECT story_card_id, keyword, match_type
      FROM story_card_triggers
      WHERE story_card_id IN (${placeholders})
    `).all(...cardIds) as Array<{ story_card_id: string; keyword: string; match_type: string }>;

    const triggerMap = new Map<string, Array<{ keyword: string; match_type: string }>>();
    for (const t of allTriggers) {
      const list = triggerMap.get(t.story_card_id) || [];
      list.push({ keyword: t.keyword.trim().toLowerCase(), match_type: t.match_type });
      triggerMap.set(t.story_card_id, list);
    }

    const userText = (options.userMessage || '').toLowerCase();
    const historyText = (options.recentHistoryText || '').toLowerCase();

    // 3. Score each card deterministically
    const scored: ScoredStoryCard[] = [];

    for (const card of activeCards) {
      let score = 0;
      const reasons: string[] = [];
      const cardTitleLower = card.title.toLowerCase();
      const triggers = triggerMap.get(card.id) || [];

      // Base pinned bonus
      if (card.is_pinned) {
        score += 100;
        reasons.push('pinned');
      }

      // Title match in user message
      if (userText && userText.includes(cardTitleLower)) {
        score += 40;
        reasons.push(`title match in user prompt ("${card.title}")`);
      } else if (historyText && historyText.includes(cardTitleLower)) {
        score += 20;
        reasons.push(`title match in recent history ("${card.title}")`);
      }

      // Trigger keywords match
      for (const t of triggers) {
        if (!t.keyword) continue;

        let userMatched = false;
        let historyMatched = false;

        if (t.match_type === 'exact') {
          const regex = new RegExp(`\\b${escapeRegExp(t.keyword)}\\b`, 'i');
          userMatched = regex.test(userText);
          historyMatched = regex.test(historyText);
        } else {
          userMatched = userText.includes(t.keyword);
          historyMatched = historyText.includes(t.keyword);
        }

        if (userMatched) {
          score += 50;
          reasons.push(`trigger keyword "${t.keyword}" matched user prompt`);
        } else if (historyMatched) {
          score += 20;
          reasons.push(`trigger keyword "${t.keyword}" matched recent history`);
        }
      }

      const cardWithTriggers: StoryCardRecord = {
        ...card,
        triggers: triggers.map((t) => t.keyword),
      };

      // Rough token estimation: (title + content) characters / 4
      const tokenEst = Math.ceil((card.title.length + card.content.length + 30) / 4);

      scored.push({
        card: cardWithTriggers,
        relevanceScore: score,
        matchedReasons: reasons,
        estimatedTokens: tokenEst,
      });
    }

    // 4. Sort strictly by relevanceScore DESC, then pinned DESC, then updated_at DESC
    scored.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      if (b.card.is_pinned !== a.card.is_pinned) {
        return b.card.is_pinned - a.card.is_pinned;
      }
      return b.card.updated_at.localeCompare(a.card.updated_at);
    });

    // 5. Select cards that are relevant (score > 0) within token budget
    const selected: ScoredStoryCard[] = [];
    let currentTokens = 0;

    for (const sc of scored) {
      if (sc.relevanceScore <= 0) continue;

      if (currentTokens + sc.estimatedTokens <= maxBudget) {
        selected.push(sc);
        currentTokens += sc.estimatedTokens;
      }
    }

    return {
      selectedCards: selected,
      allScoredCards: scored,
    };
  }

  /**
   * Create a new Story Card with optional triggers.
   */
  createCard(data: {
    chronicleId: string;
    title: string;
    content: string;
    category?: 'lore' | 'location' | 'faction' | 'item' | 'rule';
    is_pinned?: boolean;
    is_active?: boolean;
    triggers?: string[];
  }): StoryCardRecord {
    const db = getDatabase();
    const chronicle = db.prepare('SELECT id FROM chronicles WHERE id = ?').get(data.chronicleId);
    if (!chronicle) {
      throw new Error(`Chronicle not found: ${data.chronicleId}`);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO story_cards (id, chronicle_id, title, content, category, is_pinned, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.chronicleId,
        data.title.trim(),
        data.content.trim(),
        data.category || 'lore',
        data.is_pinned ? 1 : 0,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
        now,
        now
      );

      if (Array.isArray(data.triggers) && data.triggers.length > 0) {
        const insertTrigger = db.prepare(`
          INSERT INTO story_card_triggers (id, story_card_id, keyword, match_type, created_at)
          VALUES (?, ?, ?, 'contains', ?)
        `);
        for (const trig of data.triggers) {
          const clean = trig.trim();
          if (clean) {
            insertTrigger.run(crypto.randomUUID(), id, clean, now);
          }
        }
      }
    })();

    const created = this.getCardById(id);
    if (!created) throw new Error('Failed to create Story Card');
    return created;
  }

  /**
   * Update an existing Story Card and its triggers.
   * Derives ownership from the Story Card itself and verifies parent Chronicle existence.
   */
  updateCard(
    id: string,
    data: {
      title?: string;
      content?: string;
      category?: 'lore' | 'location' | 'faction' | 'item' | 'rule';
      is_pinned?: boolean;
      is_active?: boolean;
      triggers?: string[];
    },
    expectedChronicleId?: string
  ): StoryCardRecord {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM story_cards WHERE id = ?').get(id) as StoryCardRecord | undefined;
    if (!existing) throw new Error(`Story Card not found: ${id}`);

    // Verify parent chronicle relationship
    const cardChronicleId = existing.chronicle_id;
    if (expectedChronicleId && expectedChronicleId !== cardChronicleId) {
      throw new Error(`Story Card does not belong to specified chronicle: card belongs to ${cardChronicleId}, not ${expectedChronicleId}`);
    }

    const chronicle = db.prepare('SELECT id FROM chronicles WHERE id = ?').get(cardChronicleId);
    if (!chronicle) {
      throw new Error(`Parent chronicle not found: ${cardChronicleId}`);
    }

    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(`
        UPDATE story_cards SET
          title = COALESCE(?, title),
          content = COALESCE(?, content),
          category = COALESCE(?, category),
          is_pinned = COALESCE(?, is_pinned),
          is_active = COALESCE(?, is_active),
          updated_at = ?
        WHERE id = ?
      `).run(
        data.title?.trim() ?? null,
        data.content?.trim() ?? null,
        data.category ?? null,
        data.is_pinned !== undefined ? (data.is_pinned ? 1 : 0) : null,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : null,
        now,
        id
      );

      if (Array.isArray(data.triggers)) {
        db.prepare('DELETE FROM story_card_triggers WHERE story_card_id = ?').run(id);
        const insertTrigger = db.prepare(`
          INSERT INTO story_card_triggers (id, story_card_id, keyword, match_type, created_at)
          VALUES (?, ?, ?, 'contains', ?)
        `);
        for (const trig of data.triggers) {
          const clean = trig.trim();
          if (clean) {
            insertTrigger.run(crypto.randomUUID(), id, clean, now);
          }
        }
      }
    })();

    const updated = this.getCardById(id);
    if (!updated) throw new Error('Failed to update Story Card');
    return updated;
  }

  /**
   * Delete Story Card (triggers cascade delete automatically via FK).
   * Verifies that the card exists and belongs to expectedChronicleId if provided.
   */
  deleteCard(id: string, expectedChronicleId?: string): boolean {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM story_cards WHERE id = ?').get(id) as StoryCardRecord | undefined;
    if (!existing) {
      throw new Error(`Story Card not found: ${id}`);
    }

    const cardChronicleId = existing.chronicle_id;
    if (expectedChronicleId && expectedChronicleId !== cardChronicleId) {
      throw new Error(`Story Card does not belong to specified chronicle: card belongs to ${cardChronicleId}, not ${expectedChronicleId}`);
    }

    const res = db.prepare('DELETE FROM story_cards WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Toggle pinned status.
   * Verifies that the card exists and belongs to expectedChronicleId if provided.
   */
  togglePinned(id: string, expectedChronicleId?: string): StoryCardRecord {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM story_cards WHERE id = ?').get(id) as StoryCardRecord | undefined;
    if (!existing) throw new Error(`Story Card not found: ${id}`);

    const cardChronicleId = existing.chronicle_id;
    if (expectedChronicleId && expectedChronicleId !== cardChronicleId) {
      throw new Error(`Story Card does not belong to specified chronicle: card belongs to ${cardChronicleId}, not ${expectedChronicleId}`);
    }

    const nextState = existing.is_pinned ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE story_cards SET is_pinned = ?, updated_at = ? WHERE id = ?').run(nextState, now, id);

    const updated = this.getCardById(id);
    if (!updated) throw new Error('Failed to update Story Card');
    return updated;
  }

  getCardById(id: string): StoryCardRecord | undefined {
    const db = getDatabase();
    const card = db.prepare('SELECT * FROM story_cards WHERE id = ?').get(id) as StoryCardRecord | undefined;
    if (!card) return undefined;

    const triggers = db.prepare(`
      SELECT keyword FROM story_card_triggers WHERE story_card_id = ?
    `).all(id) as Array<{ keyword: string }>;

    return {
      ...card,
      triggers: triggers.map((t) => t.keyword),
    };
  }
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const storyCardEngine = new StoryCardEngine();
