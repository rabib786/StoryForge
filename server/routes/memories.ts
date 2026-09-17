import { Router } from 'express';
import { memoryEngine } from '../story-engine/memory-engine.js';

export const memoriesRouter = Router();

// Get memories for a session
memoriesRouter.get('/session/:sessionId', (req, res) => {
  try {
    const chronicleId = req.query.chronicleId || req.query.chronicle_id;
    const memories = memoryEngine.getSessionMemories(
      req.params.sessionId,
      chronicleId ? String(chronicleId) : undefined
    );
    res.json({ memories });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('mismatch') || errorMsg.includes('ownership')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});

// Create memory
memoriesRouter.post('/', (req, res) => {
  try {
    const { chronicle_id, chronicleId, session_id, sessionId, type, content, importance, is_pinned, source_message_id, sourceMessageId } = req.body;
    const targetSessionId = session_id || sessionId;
    const targetChronicleId = chronicle_id || chronicleId;

    if (!targetSessionId || !content || !content.trim()) {
      return res.status(400).json({ error: 'session_id and content are required' });
    }

    const memory = memoryEngine.createMemory({
      sessionId: String(targetSessionId),
      chronicleId: targetChronicleId ? String(targetChronicleId) : undefined,
      type,
      content,
      importance,
      is_pinned,
      sourceMessageId: source_message_id || sourceMessageId,
    });

    res.status(201).json({ memory });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('mismatch') || errorMsg.includes('ownership')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});

// Delete memory
memoriesRouter.delete('/:id', (req, res) => {
  try {
    const targetSessionId = req.query.sessionId || req.query.session_id || req.body?.sessionId || req.body?.session_id;
    const targetChronicleId = req.query.chronicleId || req.query.chronicle_id || req.body?.chronicleId || req.body?.chronicle_id;

    const success = memoryEngine.deleteMemory(req.params.id, {
      sessionId: targetSessionId ? String(targetSessionId) : undefined,
      chronicleId: targetChronicleId ? String(targetChronicleId) : undefined,
    });
    res.json({ success });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found')) {
      return res.status(404).json({ error: errorMsg });
    }
    if (errorMsg.includes('does not belong') || errorMsg.includes('mismatch')) {
      return res.status(400).json({ error: errorMsg });
    }
    res.status(500).json({ error: errorMsg });
  }
});
