import { Router } from 'express';
import { providerManager } from '../providers/manager.js';
import { getDatabase } from '../db/database.js';

export const providersRouter = Router();

providersRouter.get('/', async (req, res) => {
  try {
    const db = getDatabase();
    const providers = providerManager.getAllProviders();
    const active = providerManager.getActiveProviderAndModel();

    const providerList = await Promise.all(
      providers.map(async (p) => {
        const models = await p.listModels();
        const row = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(p.id) as {
          is_enabled: number;
          base_url: string;
          api_key_configured: number;
        } | undefined;

        // Check if provider has active key/credentials
        let hasKey = false;
        if (p.id === 'gemini') {
          hasKey = !!process.env.GEMINI_API_KEY;
        } else if (row?.api_key_configured) {
          hasKey = true;
        }

        return {
          id: p.id,
          name: p.name,
          type: p.type,
          baseUrl: row?.base_url || '',
          hasKey,
          isEnabled: row?.is_enabled ?? 1,
          models,
        };
      })
    );

    res.json({
      providers: providerList,
      activeProviderId: active.providerId,
      activeModelId: active.modelId,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

providersRouter.post('/:id/test', async (req, res) => {
  try {
    const provider = providerManager.getProvider(req.params.id);
    const { apiKey, baseUrl } = req.body;
    const testResult = await provider.testConnection(apiKey, baseUrl);
    res.json(testResult);
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: String(err) });
  }
});
