import { Router } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../db/database.js';
import { storyCardEngine } from '../story-engine/story-card-engine.js';

export const chroniclesRouter = Router();

// List all chronicles
chroniclesRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const { favorite, search, genre } = req.query;

    let query = 'SELECT * FROM chronicles WHERE 1=1';
    const params: (string | number)[] = [];

    if (favorite === 'true' || favorite === '1') {
      query += ' AND is_favorite = 1';
    }
    if (genre && typeof genre === 'string' && genre !== 'All') {
      query += ' AND genre = ?';
      params.push(genre);
    }
    if (search && typeof search === 'string' && search.trim()) {
      query += ' AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY updated_at DESC';
    const chronicles = db.prepare(query).all(...params);
    res.json({ chronicles });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single chronicle with story_characters and active sessions
chroniclesRouter.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const chronicle = db.prepare('SELECT * FROM chronicles WHERE id = ?').get(req.params.id);
    if (!chronicle) {
      return res.status(404).json({ error: 'Chronicle not found' });
    }

    const personas = db.prepare(`SELECT * FROM personas`).all();

    // Associated story_characters
    const storyCharacters = db.prepare(`
      SELECT * FROM story_characters WHERE chronicle_id = ?
    `).all(req.params.id);

    // Existing sessions
    const sessions = db.prepare(`
      SELECT * FROM story_sessions WHERE chronicle_id = ? ORDER BY updated_at DESC
    `).all(req.params.id);

    // Story cards / lore with triggers
    const storyCards = storyCardEngine.getChronicleStoryCards(req.params.id);

    res.json({ chronicle, personas, storyCharacters, sessions, storyCards });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Create chronicle
chroniclesRouter.post('/', (req, res) => {
  try {
    const db = getDatabase();
    const {
      title,
      description = '',
      genre = 'Fantasy',
      tags = [],
      cover_url = '',
      system_instructions = '',
      opening_message = '',
      world_info = '',
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Chronicle title is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO chronicles (
          id, title, description, genre, tags, cover_url,
          system_instructions, opening_message, world_info, is_favorite,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id,
        title.trim(),
        description.trim(),
        genre,
        tagsJson,
        cover_url,
        system_instructions.trim(),
        opening_message.trim(),
        world_info.trim(),
        now,
        now
      );
    })();

    const created = db.prepare('SELECT * FROM chronicles WHERE id = ?').get(id);
    res.status(201).json({ chronicle: created });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Update chronicle
chroniclesRouter.put('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const {
      title,
      description,
      genre,
      tags,
      cover_url,
      system_instructions,
      opening_message,
      world_info,
    } = req.body;

    const existing = db.prepare('SELECT id FROM chronicles WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Chronicle not found' });
    }

    const now = new Date().toISOString();
    const tagsJson = tags !== undefined ? JSON.stringify(Array.isArray(tags) ? tags : []) : undefined;

    db.transaction(() => {
      db.prepare(`
        UPDATE chronicles SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          genre = COALESCE(?, genre),
          tags = COALESCE(?, tags),
          cover_url = COALESCE(?, cover_url),
          system_instructions = COALESCE(?, system_instructions),
          opening_message = COALESCE(?, opening_message),
          world_info = COALESCE(?, world_info),
          updated_at = ?
        WHERE id = ?
      `).run(
        title?.trim() || null,
        description?.trim() || null,
        genre || null,
        tagsJson || null,
        cover_url || null,
        system_instructions?.trim() || null,
        opening_message?.trim() || null,
        world_info?.trim() || null,
        now,
        req.params.id
      );
    })();

    const updated = db.prepare('SELECT * FROM chronicles WHERE id = ?').get(req.params.id);
    res.json({ chronicle: updated });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Toggle Favorite
chroniclesRouter.post('/:id/favorite', (req, res) => {
  try {
    const db = getDatabase();
    const chronicle = db.prepare('SELECT is_favorite FROM chronicles WHERE id = ?').get(req.params.id) as { is_favorite: number } | undefined;
    if (!chronicle) {
      return res.status(404).json({ error: 'Chronicle not found' });
    }
    const nextState = chronicle.is_favorite ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE chronicles SET is_favorite = ?, updated_at = ? WHERE id = ?').run(nextState, now, req.params.id);
    res.json({ is_favorite: nextState });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete chronicle
chroniclesRouter.delete('/:id', (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM chronicles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});
