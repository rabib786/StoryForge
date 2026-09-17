import { Router } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../db/database.js';

export const personasRouter = Router();

personasRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const personas = db.prepare('SELECT * FROM personas ORDER BY updated_at DESC').all();
    res.json({ personas });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

personasRouter.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    res.json({ persona });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

personasRouter.post('/', (req, res) => {
  try {
    const db = getDatabase();
    const { name, pronouns = '', appearance = '', personality = '', background = '', traits = '', role = '', instructions = '', avatar_path = '' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO personas (id, name, pronouns, appearance, personality, background, traits, role, instructions, avatar_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), pronouns.trim(), appearance.trim(), personality.trim(), background.trim(), traits.trim(), role.trim(), instructions.trim(), avatar_path.trim(), now, now);

    res.status(201).json({ persona: db.prepare('SELECT * FROM personas WHERE id = ?').get(id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

personasRouter.put('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { name, pronouns, appearance, personality, background, traits, role, instructions, avatar_path } = req.body;
    
    db.prepare(`
      UPDATE personas SET
        name = COALESCE(?, name),
        pronouns = COALESCE(?, pronouns),
        appearance = COALESCE(?, appearance),
        personality = COALESCE(?, personality),
        background = COALESCE(?, background),
        traits = COALESCE(?, traits),
        role = COALESCE(?, role),
        instructions = COALESCE(?, instructions),
        avatar_path = COALESCE(?, avatar_path),
        updated_at = ?
      WHERE id = ?
    `).run(
      name?.trim() || null, pronouns?.trim() || null, appearance?.trim() || null, personality?.trim() || null, 
      background?.trim() || null, traits?.trim() || null, role?.trim() || null, instructions?.trim() || null, avatar_path?.trim() || null,
      new Date().toISOString(), req.params.id
    );

    res.json({ persona: db.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

personasRouter.delete('/:id', (req, res) => {
  try {
    getDatabase().prepare('DELETE FROM personas WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
