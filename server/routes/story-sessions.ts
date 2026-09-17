import { Router } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../db/database.js';

export const sessionsRouter = Router();

// Get session details and ordered messages
sessionsRouter.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const session = db.prepare(`
      SELECT c.*, s.title as chronicle_title, s.opening_message, s.genre, s.cover_url
      FROM story_sessions c
      JOIN chronicles s ON s.id = c.chronicle_id
      WHERE c.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined;

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const expectedChronicleId = req.query.chronicleId || req.query.chronicle_id;
    if (expectedChronicleId && session.chronicle_id !== expectedChronicleId) {
      return res.status(400).json({
        error: `Session does not belong to specified chronicle: session belongs to ${session.chronicle_id}, not ${expectedChronicleId}`
      });
    }

    // Get messages
    const messages = db.prepare(`
      SELECT m.*, mg.tokens_used, mg.generation_time_ms, mg.model_id
      FROM messages m
      LEFT JOIN message_generations mg ON mg.id = m.active_generation_id
      WHERE m.session_id = ?
      ORDER BY m.sequence_order ASC, m.created_at ASC
    `).all(req.params.id);

    // Get chronicle characters
    const storyCharacters = db.prepare(`
      SELECT *
      FROM story_characters
      WHERE chronicle_id = ?
    `).all(session.chronicle_id);

    res.json({ session, messages, storyCharacters });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Create new session
sessionsRouter.post('/', (req, res) => {
  try {
    const db = getDatabase();
    const { chronicle_id, title, active_persona_id } = req.body;

    if (!chronicle_id) {
      return res.status(400).json({ error: 'chronicle_id is required' });
    }

    const chronicle = db.prepare('SELECT title, opening_message FROM chronicles WHERE id = ?').get(chronicle_id) as {
      title: string;
      opening_message: string;
    } | undefined;

    if (!chronicle) {
      return res.status(404).json({ error: 'Chronicle not found' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const chatTitle = title?.trim() || `${chronicle.title} - Session`;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO story_sessions (id, chronicle_id, title, active_persona_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, chronicle_id, chatTitle, active_persona_id || null, now, now);

      if (chronicle.opening_message && chronicle.opening_message.trim()) {
        const msgId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO messages (id, session_id, sender_type, content, is_ooc, sequence_order, created_at, updated_at)
          VALUES (?, ?, 'ai', ?, 0, 0, ?, ?)
        `).run(msgId, id, chronicle.opening_message.trim(), now, now);
      }
    })();

    const created = db.prepare('SELECT * FROM story_sessions WHERE id = ?').get(id);
    res.status(201).json({ session: created });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Edit message
sessionsRouter.put('/:id/messages/:messageId', (req, res) => {
  try {
    const db = getDatabase();
    const { content } = req.body;

    if (content === undefined || typeof content !== 'string') {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(req.params.messageId) as { id: string; session_id: string } | undefined;
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (msg.session_id !== req.params.id) {
      return res.status(400).json({ error: 'Message does not belong to specified session' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE messages SET content = ?, updated_at = ?
      WHERE id = ? AND session_id = ?
    `).run(content.trim(), now, req.params.messageId, req.params.id);

    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    res.json({ message: updated });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete message
sessionsRouter.delete('/:id/messages/:messageId', (req, res) => {
  try {
    const db = getDatabase();
    const msg = db.prepare('SELECT id, session_id FROM messages WHERE id = ?').get(req.params.messageId) as { id: string; session_id: string } | undefined;
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (msg.session_id !== req.params.id) {
      return res.status(400).json({ error: 'Message does not belong to specified session' });
    }

    db.prepare('DELETE FROM messages WHERE id = ? AND session_id = ?').run(req.params.messageId, req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});
