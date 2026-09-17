import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { runMigrations } from './server/db/migrations.js';
import { chroniclesRouter } from './server/routes/chronicles.js';
import { personasRouter } from './server/routes/personas.js';
import { storyCharactersRouter } from './server/routes/story-characters.js';
import { sessionsRouter } from './server/routes/story-sessions.js';
import { storyRouter } from './server/routes/story.js';
import { settingsRouter } from './server/routes/settings.js';
import { providersRouter } from './server/routes/providers.js';
import { storyCardsRouter } from './server/routes/story-cards.js';
import { memoriesRouter } from './server/routes/memories.js';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();

  // Basic middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Run SQLite migrations and seed tables
  try {
    runMigrations();
    console.log('[StoryForge] SQLite migrations verified successfully.');
  } catch (err) {
    console.error('[StoryForge Error] Failed to run database migrations:', err);
  }

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'StoryForge Backend',
      timestamp: new Date().toISOString(),
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
    });
  });

  app.use('/api/chronicles', chroniclesRouter);
  app.use('/api/personas', personasRouter);
  app.use('/api/story-characters', storyCharactersRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/story', storyRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/story-cards', storyCardsRouter);
  app.use('/api/memories', memoriesRouter);

  // Serve Vite in development or static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[StoryForge] Server running on http://localhost:${PORT}`);
  });
}

startServer();
