import { Router } from 'express';
import { getDatabase } from '../db/database.js';

export const settingsRouter = Router();

// Get settings and stats
settingsRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value, updated_at FROM settings').all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;

    const settingsMap: Record<string, string> = {};
    rows.forEach((r) => {
      settingsMap[r.key] = r.value;
    });

    // Database statistics
    const chronicleCount = (db.prepare('SELECT COUNT(*) as c FROM chronicles').get() as { c: number }).c;
    const characterCount = (db.prepare('SELECT COUNT(*) as c FROM story_characters').get() as { c: number }).c;
    const chatCount = (db.prepare('SELECT COUNT(*) as c FROM story_sessions').get() as { c: number }).c;
    const messageCount = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;

    res.json({
      settings: settingsMap,
      stats: {
        chronicles: chronicleCount,
        characters: characterCount,
        chats: chatCount,
        messages: messageCount,
      },
      hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Update settings
settingsRouter.post('/', (req, res) => {
  try {
    const db = getDatabase();
    const updates = req.body; // e.g. { appearance_theme: '...', active_provider_id: '...' }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }

    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    db.transaction(() => {
      for (const [k, v] of Object.entries(updates)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          stmt.run(k, String(v), now);
        }
      }
    })();

    res.json({ success: true, updated_at: now });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

// Export and backup database snapshot
settingsRouter.post('/backup', (req, res) => {
  try {
    const db = getDatabase();
    const backupData = {
      version: 'StoryForge-Backup-v2',
      exported_at: new Date().toISOString(),
      chronicles: db.prepare('SELECT * FROM chronicles').all(),
      personas: db.prepare('SELECT * FROM personas').all(),
      story_characters: db.prepare('SELECT * FROM story_characters').all(),
      story_sessions: db.prepare('SELECT * FROM story_sessions').all(),
      messages: db.prepare('SELECT * FROM messages').all(),
      message_generations: db.prepare('SELECT * FROM message_generations').all(),
      settings: db.prepare('SELECT * FROM settings').all(),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="storyforge-backup-${Date.now()}.json"`);
    res.json(backupData);
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});
