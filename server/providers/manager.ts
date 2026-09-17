import { LLMProvider } from './types.js';
import { GeminiProvider } from './gemini.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { getDatabase } from '../db/database.js';

class ProviderManager {
  private providers = new Map<string, LLMProvider>();

  constructor() {
    this.registerProvider(new GeminiProvider());
    this.registerProvider(
      new OpenAICompatibleProvider('local_llm', 'Local LLM (llama.cpp / Ollama)', 'http://127.0.0.1:11434/v1', 'local_llama')
    );
    this.registerProvider(
      new OpenAICompatibleProvider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'openai_compatible')
    );
  }

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId: string): LLMProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      // Fallback to Gemini if requested provider not found
      const gemini = this.providers.get('gemini');
      if (gemini) return gemini;
      throw new Error(`LLM Provider '${providerId}' not registered.`);
    }
    return provider;
  }

  getAllProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getActiveProviderAndModel(): { providerId: string; modelId: string } {
    try {
      const db = getDatabase();
      const pRow = db.prepare("SELECT value FROM settings WHERE key = 'active_provider_id'").get() as { value: string } | undefined;
      const mRow = db.prepare("SELECT value FROM settings WHERE key = 'active_model_id'").get() as { value: string } | undefined;
      return {
        providerId: pRow?.value || 'gemini',
        modelId: mRow?.value || 'gemini-2.5-flash',
      };
    } catch {
      return { providerId: 'gemini', modelId: 'gemini-2.5-flash' };
    }
  }
}

export const providerManager = new ProviderManager();
