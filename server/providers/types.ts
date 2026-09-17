export interface GenerationMessage {
  role: 'system' | 'user' | 'model';
  content: string;
}

export interface GenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  stopSequences?: string[];
  systemInstruction?: string;
}

export interface GenerationResult {
  content: string;
  tokensUsed?: number;
  finishReason?: string;
  generationTimeMs: number;
}

export interface ProviderModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  modelsFound?: number;
}

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: 'gemini' | 'openai_compatible' | 'local_llama';

  generate(
    modelId: string,
    messages: GenerationMessage[],
    options?: GenerationOptions
  ): Promise<GenerationResult>;

  stream(
    modelId: string,
    messages: GenerationMessage[],
    options?: GenerationOptions,
    onChunk?: (chunk: string) => void
  ): Promise<GenerationResult>;

  testConnection(apiKey?: string, baseUrl?: string): Promise<ConnectionTestResult>;

  listModels(apiKey?: string, baseUrl?: string): Promise<ProviderModelInfo[]>;
}
