import { Router } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../db/database.js';

export const storyCharactersRouter = Router();

storyCharactersRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const chronicleId = req.query.chronicle_id || req.query.chronicleId;
    if (!chronicleId) return res.status(400).json({ error: 'chronicle_id required' });

    const chronicle = db.prepare('SELECT id FROM chronicles WHERE id = ?').get(chronicleId);
    if (!chronicle) {
      return res.status(404).json({ error: 'Chronicle not found' });
    }

    const storyCharacters = db.prepare('SELECT * FROM story_characters WHERE chronicle_id = ? ORDER BY sort_order ASC, updated_at DESC').all(chronicleId);
    res.json({ storyCharacters });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

storyCharactersRouter.post('/', (req, res) => {
  try {
    const db = getDatabase();
    const { chronicle_id, chronicleId, name, role = 'ai', appearance = '', personality = '', background = '', goals = '', fears = '', relationships = '', speech_style = '', behavior_instructions = '', avatar_path = '', sort_order = 0 } = req.body;
    const targetChronicleId = chronicle_id || chronicleId;

    if (!targetChronicleId || !name || !name.trim()) return res.status(400).json({ error: 'chronicle_id and name required' });

    const chronicle = db.prepare('SELECT id FROM chronicles WHERE id = ?').get(targetChronicleId);
    if (!chronicle) {
      return res.status(404).json({ error: 'Chronicle not found' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO story_characters (id, chronicle_id, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, targetChronicleId, name.trim(), role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order, now, now);

    res.status(201).json({ storyCharacter: db.prepare('SELECT * FROM story_characters WHERE id = ?').get(id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

storyCharactersRouter.put('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { chronicle_id, chronicleId, name, role, appearance, personality, background, goals, fears, relationships, speech_style, behavior_instructions, avatar_path, sort_order } = req.body;
    const expectedChronicleId = chronicle_id || chronicleId || req.query.chronicle_id || req.query.chronicleId;

    const existing = db.prepare('SELECT * FROM story_characters WHERE id = ?').get(req.params.id) as { id: string; chronicle_id: string } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Story character not found' });
    }

    if (expectedChronicleId && existing.chronicle_id !== expectedChronicleId) {
      return res.status(400).json({ error: `Story character does not belong to specified chronicle: character belongs to ${existing.chronicle_id}, not ${expectedChronicleId}` });
    }

    db.prepare(`
      UPDATE story_characters SET
        name = COALESCE(?, name),
        role = COALESCE(?, role),
        appearance = COALESCE(?, appearance),
        personality = COALESCE(?, personality),
        background = COALESCE(?, background),
        goals = COALESCE(?, goals),
        fears = COALESCE(?, fears),
        relationships = COALESCE(?, relationships),
        speech_style = COALESCE(?, speech_style),
        behavior_instructions = COALESCE(?, behavior_instructions),
        avatar_path = COALESCE(?, avatar_path),
        sort_order = COALESCE(?, sort_order),
        updated_at = ?
      WHERE id = ?
    `).run(
      name?.trim() || null, role || null, appearance?.trim() || null, personality?.trim() || null, background?.trim() || null,
      goals?.trim() || null, fears?.trim() || null, relationships?.trim() || null, speech_style?.trim() || null,
      behavior_instructions?.trim() || null, avatar_path?.trim() || null, sort_order !== undefined ? sort_order : null,
      new Date().toISOString(), req.params.id
    );

    res.json({ storyCharacter: db.prepare('SELECT * FROM story_characters WHERE id = ?').get(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

storyCharactersRouter.delete('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const expectedChronicleId = req.body?.chronicle_id || req.body?.chronicleId || req.query.chronicle_id || req.query.chronicleId;

    const existing = db.prepare('SELECT * FROM story_characters WHERE id = ?').get(req.params.id) as { id: string; chronicle_id: string } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Story character not found' });
    }

    if (expectedChronicleId && existing.chronicle_id !== expectedChronicleId) {
      return res.status(400).json({ error: `Story character does not belong to specified chronicle: character belongs to ${existing.chronicle_id}, not ${expectedChronicleId}` });
    }

    db.prepare('DELETE FROM story_characters WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
