import { Router } from 'express';
import { storyCardEngine } from '../story-engine/story-card-engine.js';

export const storyCardsRouter = Router();

// Get cards for a chronicle
storyCardsRouter.get('/chronicle/:chronicleId', (req, res) => {
  try {
    const cards = storyCardEngine.getChronicleStoryCards(req.params.chronicleId);
    res.json({ storyCards: cards });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg.includes('not found') ? 404 : 500;
    res.status(status).json({ error: errorMsg });
  }
});

// Get individual card by ID
storyCardsRouter.get('/:id', (req, res) => {
  try {
    const card = storyCardEngine.getCardById(req.params.id);
    if (!card) {
      return res.status(404).json({ error: `Story Card not found: ${req.params.id}` });
    }

    const { chronicle_id, chronicleId } = req.query;
    const expectedChronicleId = (chronicle_id || chronicleId) ? String(chronicle_id || chronicleId) : undefined;
    if (expectedChronicleId && card.chronicle_id !== expectedChronicleId) {
      return res.status(400).json({
        error: `Story Card does not belong to specified chronicle: card belongs to ${card.chronicle_id}, not ${expectedChronicleId}`
      });
    }

    res.json({ storyCard: card });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: errorMsg });
  }
});

// Create a new card
storyCardsRouter.post('/', (req, res) => {
  try {
    const { chronicle_id, chronicleId, title, content, category, is_pinned, is_active, triggers } = req.body;
    const targetChronicleId = chronicle_id || chronicleId;

    if (!targetChronicleId || !title || !content) {
      return res.status(400).json({ error: 'chronicle_id, title, and content are required' });
    }

    const card = storyCardEngine.createCard({
      chronicleId: targetChronicleId,
      title,
      content,
      category,
      is_pinned: !!is_pinned,
      is_active: is_active !== undefined ? !!is_active : true,
      triggers: Array.isArray(triggers) ? triggers : [],
    });

    res.status(201).json({ storyCard: card });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg.includes('not found') ? 404 : 500;
    res.status(status).json({ error: errorMsg });
  }
});

// Update card
storyCardsRouter.put('/:id', (req, res) => {
  try {
    const { title, content, category, is_pinned, is_active, triggers, chronicle_id, chronicleId } = req.body;
    const expectedChronicleId = chronicle_id || chronicleId || req.query.chronicle_id || req.query.chronicleId;

    const updated = storyCardEngine.updateCard(
      req.params.id,
      {
        title,
        content,
        category,
        is_pinned,
        is_active,
        triggers,
      },
      expectedChronicleId ? String(expectedChronicleId) : undefined
    );
    res.json({ storyCard: updated });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('does not belong')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});

// Toggle pinned
storyCardsRouter.post('/:id/toggle-pinned', (req, res) => {
  try {
    const expectedChronicleId = req.body?.chronicle_id || req.body?.chronicleId || req.query.chronicle_id || req.query.chronicleId;
    const updated = storyCardEngine.togglePinned(req.params.id, expectedChronicleId ? String(expectedChronicleId) : undefined);
    res.json({ storyCard: updated });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('does not belong')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});

// Delete card
storyCardsRouter.delete('/:id', (req, res) => {
  try {
    const expectedChronicleId = req.body?.chronicle_id || req.body?.chronicleId || req.query.chronicle_id || req.query.chronicleId;
    const success = storyCardEngine.deleteCard(req.params.id, expectedChronicleId ? String(expectedChronicleId) : undefined);
    res.json({ success });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('does not belong')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});
