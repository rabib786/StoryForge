import { GoogleGenAI } from '@google/genai';
import {
  LLMProvider,
  GenerationMessage,
  GenerationOptions,
  GenerationResult,
  ProviderModelInfo,
  ConnectionTestResult,
} from './types.js';

export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly type = 'gemini' as const;

  private getClient(customKey?: string): GoogleGenAI {
    const apiKey = customKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key is not configured. Please add your key in Settings or environment secrets.');
    }
    return new GoogleGenAI({ apiKey });
  }

  async generate(
    modelId: string,
    messages: GenerationMessage[],
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const ai = this.getClient();

    const formattedContents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // System instruction is supplied via config
    const systemInstruction = options?.systemInstruction ||
      messages.find((m) => m.role === 'system')?.content;

    const response = await ai.models.generateContent({
      model: modelId || 'gemini-3.6-flash',
      contents: formattedContents,
      config: {
        systemInstruction: systemInstruction ? systemInstruction : undefined,
        temperature: options?.temperature ?? 0.8,
        maxOutputTokens: options?.maxOutputTokens ?? 1024,
      },
    });

    const elapsed = Date.now() - startTime;
    const content = response.text || '';
    const tokensUsed = response.usageMetadata?.totalTokenCount || 0;

    return {
      content,
      tokensUsed,
      generationTimeMs: elapsed,
    };
  }

  async stream(
    modelId: string,
    messages: GenerationMessage[],
    options?: GenerationOptions,
    onChunk?: (chunk: string) => void
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const ai = this.getClient();

    const formattedContents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemInstruction = options?.systemInstruction ||
      messages.find((m) => m.role === 'system')?.content;

    const responseStream = await ai.models.generateContentStream({
      model: modelId || 'gemini-3.6-flash',
      contents: formattedContents,
      config: {
        systemInstruction: systemInstruction ? systemInstruction : undefined,
        temperature: options?.temperature ?? 0.8,
        maxOutputTokens: options?.maxOutputTokens ?? 1024,
      },
    });

    let fullText = '';
    for await (const chunk of responseStream) {
      const text = chunk.text || '';
      fullText += text;
      if (onChunk) {
        onChunk(text);
      }
    }

    const elapsed = Date.now() - startTime;
    return {
      content: fullText,
      generationTimeMs: elapsed,
    };
  }

  async testConnection(apiKey?: string): Promise<ConnectionTestResult> {
    try {
      const client = this.getClient(apiKey);
      const res = await client.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: 'Ping',
        config: { maxOutputTokens: 5 },
      });
      if (res.text) {
        return { success: true, message: 'Connected to Google Gemini successfully!' };
      }
      return { success: false, message: 'No response from Gemini API.' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Connection failed: ${msg}` };
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    return [
      {
        id: 'gemini-3.6-flash',
        displayName: 'Gemini 3.6 Flash (Fast, Vivid, 1M Context)',
        contextWindow: 1048576,
      },
      {
        id: 'gemini-3.7-flash',
        displayName: 'Gemini 3.7 Flash (Hybrid Reasoning)',
        contextWindow: 1048576,
      },
      {
        id: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash (Latest Architecture)',
        contextWindow: 1048576,
      },
    ];
  }
}
