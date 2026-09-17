import {
  LLMProvider,
  GenerationMessage,
  GenerationOptions,
  GenerationResult,
  ProviderModelInfo,
  ConnectionTestResult,
} from './types.js';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: 'openai_compatible' | 'local_llama';
  private defaultBaseUrl: string;

  constructor(
    id: string,
    name: string,
    defaultBaseUrl: string = 'http://127.0.0.1:11434/v1',
    type: 'openai_compatible' | 'local_llama' = 'openai_compatible'
  ) {
    this.id = id;
    this.name = name;
    this.defaultBaseUrl = defaultBaseUrl;
    this.type = type;
  }

  async generate(
    modelId: string,
    messages: GenerationMessage[],
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const endpoint = `${this.defaultBaseUrl.replace(/\/+$/, '')}/chat/completions`;

    const openAiMessages = messages.map((m) => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
    }));

    if (options?.systemInstruction) {
      openAiMessages.unshift({
        role: 'system',
        content: options.systemInstruction,
      });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId || 'default',
        messages: openAiMessages,
        temperature: options?.temperature ?? 0.8,
        max_tokens: options?.maxOutputTokens ?? 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Provider (${this.name}) HTTP error ${response.status}: ${errText}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content || '';
    const elapsed = Date.now() - startTime;

    return {
      content,
      tokensUsed: json.usage?.total_tokens,
      generationTimeMs: elapsed,
    };
  }

  async stream(
    modelId: string,
    messages: GenerationMessage[],
    options?: GenerationOptions,
    onChunk?: (chunk: string) => void
  ): Promise<GenerationResult> {
    // Non-streaming fallback for now
    const res = await this.generate(modelId, messages, options);
    if (onChunk) onChunk(res.content);
    return res;
  }

  async testConnection(apiKey?: string, baseUrl?: string): Promise<ConnectionTestResult> {
    try {
      const url = baseUrl || this.defaultBaseUrl;
      const endpoint = `${url.replace(/\/+$/, '')}/models`;
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(endpoint, { method: 'GET', headers });
      if (res.ok) {
        return { success: true, message: `Connected to ${this.name} successfully!` };
      }
      return { success: false, message: `Failed with status ${res.status}: ${res.statusText}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Could not reach ${this.name} (${msg})` };
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    return [
      {
        id: 'default',
        displayName: `${this.name} Default Model`,
        contextWindow: 32768,
      },
    ];
  }
}
