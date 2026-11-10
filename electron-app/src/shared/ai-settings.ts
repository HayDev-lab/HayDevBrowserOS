export type AiProviderId = 'gemini' | 'openrouter' | 'openai';
export type GeminiReasoning = 'adaptive' | 'default' | 'low' | 'medium' | 'high';
export interface AiSettings {
  activeProvider: AiProviderId | 'environment';
  geminiLiveModel: string;
  geminiReasoning?: GeminiReasoning;
  providers: { id: AiProviderId; model: string; configured: boolean; keySource: 'saved' | 'environment' | 'none' }[];
}
export interface AiSettingsPatch {
  activeProvider: AiSettings['activeProvider'];
  geminiLiveModel: string;
  geminiReasoning?: GeminiReasoning;
  providers: { id: AiProviderId; model: string; apiKey?: string; removeKey?: boolean }[];
}
export interface AiModel { id: string; live: boolean }
export interface AiSettingsApi {
  get(): Promise<AiSettings>;
  save(patch: AiSettingsPatch): Promise<AiSettings>;
  models(provider: AiProviderId): Promise<{ models: AiModel[] }>;
}
