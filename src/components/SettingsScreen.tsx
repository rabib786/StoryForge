import React, { useState, useEffect } from 'react';
import {
  Palette,
  Cpu,
  Sliders,
  Database,
  Info,
  Check,
  RefreshCw,
  Download,
  ShieldCheck,
  Zap,
  Server,
  Terminal,
} from 'lucide-react';
import { LLMProviderData, AppSettings, DatabaseStats } from '../types';
import { api } from '../services/api';

export const SettingsScreen: React.FC = () => {
  const [activeSection, setActiveSection] = useState<'appearance' | 'providers' | 'generation' | 'data' | 'about'>('providers');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Settings & Providers state
  const [settings, setSettings] = useState<AppSettings>({});
  const [stats, setStats] = useState<DatabaseStats>({ chronicles: 0, characters: 0, chats: 0, messages: 0 });
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [providers, setProviders] = useState<LLMProviderData[]>([]);
  const [activeProviderId, setActiveProviderId] = useState('gemini');
  const [activeModelId, setActiveModelId] = useState('gemini-2.5-flash');

  // Test connection state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Local endpoint URL
  const [localUrl, setLocalUrl] = useState('http://127.0.0.1:11434/v1');

  useEffect(() => {
    loadAllSettings();
  }, []);

  const loadAllSettings = async () => {
    setLoading(true);
    try {
      const [settingsRes, providersRes] = await Promise.all([
        api.getSettings(),
        api.getProviders(),
      ]);

      setSettings(settingsRes.settings);
      setStats(settingsRes.stats);
      setHasGeminiKey(settingsRes.hasGeminiApiKey);
      setProviders(providersRes.providers);
      setActiveProviderId(providersRes.activeProviderId || 'gemini');
      setActiveModelId(providersRes.activeModelId || 'gemini-2.5-flash');

      const localProv = providersRes.providers.find((p) => p.id === 'local_llm');
      if (localProv?.baseUrl) {
        setLocalUrl(localProv.baseUrl);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSetting = async (key: string, value: string) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      await api.updateSettings({ [key]: value });
      triggerSaveToast();
    } catch (err) {
      alert(`Failed to save setting: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSelectProvider = async (pId: string, mId?: string) => {
    setActiveProviderId(pId);
    const prov = providers.find((p) => p.id === pId);
    const modelToSet = mId || prov?.models[0]?.id || 'default';
    setActiveModelId(modelToSet);

    try {
      await api.updateSettings({
        active_provider_id: pId,
        active_model_id: modelToSet,
      });
      triggerSaveToast();
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestConnection = async (pId: string) => {
    setTestingId(pId);
    try {
      const res = await api.testProvider(pId, { baseUrl: pId === 'local_llm' ? localUrl : undefined });
      setTestResults((prev) => ({ ...prev, [pId]: res }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [pId]: { success: false, message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const triggerSaveToast = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-white tracking-wide">
            Settings & Architecture
          </h1>
          <p className="text-xs text-slate-400">Configure AI models, storytelling parameters & local data</p>
        </div>

        {saveSuccess && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
            <Check className="w-3.5 h-3.5" />
            <span>Saved</span>
          </span>
        )}
      </div>

      {/* Navigation Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-slate-800">
        {[
          { id: 'providers', label: 'AI Providers', icon: Cpu },
          { id: 'generation', label: 'Generation', icon: Sliders },
          { id: 'appearance', label: 'Appearance', icon: Palette },
          { id: 'data', label: 'Data & Storage', icon: Database },
          { id: 'about', label: 'About', icon: Info },
        ].map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id as any)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition ${
                isActive
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION: AI Providers */}
      {activeSection === 'providers' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Server-Side Provider Security</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              All LLM connections and API tokens are handled exclusively by the StoryForge backend. The frontend never touches credentials.
            </p>
          </div>

          <div className="space-y-3">
            {providers.map((p) => {
              const isSelected = activeProviderId === p.id;
              const testResult = testResults[p.id];

              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-xl border transition ${
                    isSelected
                      ? 'bg-slate-900/90 border-amber-500/50 shadow-md'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        id={`provider-${p.id}`}
                        name="activeProvider"
                        checked={isSelected}
                        onChange={() => handleSelectProvider(p.id)}
                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                      />
                      <div>
                        <label
                          htmlFor={`provider-${p.id}`}
                          className="font-semibold text-sm text-slate-100 cursor-pointer flex items-center gap-2"
                        >
                          {p.name}
                          {p.id === 'gemini' && hasGeminiKey && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              Configured
                            </span>
                          )}
                          {p.id === 'local_llm' && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                              Local Offline
                            </span>
                          )}
                        </label>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {p.id === 'gemini'
                            ? 'Powered by Gemini 2.5 models with server credentials'
                            : p.id === 'local_llm'
                            ? 'Connects to your local llama.cpp / Ollama server via standard endpoint'
                            : 'OpenRouter aggregation endpoint for diverse open-weights models'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleTestConnection(p.id)}
                      disabled={testingId === p.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition shrink-0"
                    >
                      <RefreshCw className={`w-3 h-3 ${testingId === p.id ? 'animate-spin' : ''}`} />
                      <span>{testingId === p.id ? 'Testing...' : 'Test'}</span>
                    </button>
                  </div>

                  {/* Local URL config if local */}
                  {p.id === 'local_llm' && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Local Base URL:
                      </label>
                      <input
                        type="text"
                        value={localUrl}
                        onChange={(e) => setLocalUrl(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                        placeholder="http://127.0.0.1:11434/v1"
                      />
                    </div>
                  )}

                  {/* Model selection if selected */}
                  {isSelected && p.models.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-400">Active Model:</span>
                      <select
                        value={activeModelId}
                        onChange={(e) => handleSelectProvider(p.id, e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-amber-300 font-medium focus:outline-none"
                      >
                        {p.models.map((m) => (
                          <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                            {m.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Test Connection Output */}
                  {testResult && (
                    <div
                      className={`mt-2.5 p-2 rounded-lg text-xs ${
                        testResult.success
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {testResult.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION: Generation Settings */}
      {activeSection === 'generation' && (
        <div className="space-y-4 bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Creativity & Temperature
              </label>
              <span className="text-xs font-mono font-bold text-amber-400">
                {settings.generation_temperature || '0.85'}
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1.2"
              step="0.05"
              value={settings.generation_temperature || '0.85'}
              onChange={(e) => handleUpdateSetting('generation_temperature', e.target.value)}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>0.2 (Focused & Literal)</span>
              <span>0.85 (Immersive & Vivid)</span>
              <span>1.2 (Wild & Surprising)</span>
            </div>
          </div>

          {/* Max Output Tokens */}
          <div className="pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Max Response Tokens
              </label>
              <span className="text-xs font-mono font-bold text-amber-400">
                {settings.generation_max_tokens || '1024'}
              </span>
            </div>
            <input
              type="range"
              min="256"
              max="2048"
              step="128"
              value={settings.generation_max_tokens || '1024'}
              onChange={(e) => handleUpdateSetting('generation_max_tokens', e.target.value)}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>256 (Quick Dialogue)</span>
              <span>1024 (Balanced Chapters)</span>
              <span>2048 (Long-form Epics)</span>
            </div>
          </div>

          {/* Pacing Preference */}
          <div className="pt-3 border-t border-slate-800">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Narrative Pacing
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'rapid', label: 'Rapid Dialogue', desc: 'Short back-and-forth exchanges' },
                { id: 'balanced', label: 'Balanced Story', desc: 'Equal dialogue and sensory prose' },
                { id: 'novelistic', label: 'Novelistic', desc: 'Deep descriptions and introspection' },
              ].map((pace) => {
                const isCurrent = (settings.story_length_preference || 'balanced') === pace.id;
                return (
                  <button
                    key={pace.id}
                    onClick={() => handleUpdateSetting('story_length_preference', pace.id)}
                    className={`p-3 rounded-xl text-left border transition ${
                      isCurrent
                        ? 'bg-amber-500/15 border-amber-500/50 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-200">{pace.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{pace.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SECTION: Appearance */}
      {activeSection === 'appearance' && (
        <div className="space-y-4 bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Reading Typography
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'Newsreader', label: 'Newsreader Serif', desc: 'Traditional book printing aesthetic' },
                { id: 'Plus Jakarta Sans', label: 'Modern Sans', desc: 'Clean, contemporary UI readability' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleUpdateSetting('reading_font', f.id)}
                  className={`p-3 rounded-xl border text-left transition ${
                    (settings.reading_font || 'Newsreader') === f.id
                      ? 'bg-amber-500/15 border-amber-500/50 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-200">{f.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{f.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Color Atmosphere
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'cinematic_dark', label: 'Cinematic Dark', bg: 'bg-[#0b0f19]' },
                { id: 'midnight_obsidian', label: 'Midnight Obsidian', bg: 'bg-[#06080d]' },
                { id: 'twilight_noir', label: 'Twilight Amber', bg: 'bg-[#121017]' },
              ].map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => handleUpdateSetting('appearance_theme', theme.id)}
                  className={`p-2.5 rounded-xl border text-center transition ${
                    (settings.appearance_theme || 'cinematic_dark') === theme.id
                      ? 'border-amber-500 text-white bg-slate-900'
                      : 'border-slate-800 text-slate-400 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className={`w-full h-8 rounded-lg ${theme.bg} border border-white/10 mb-1.5`} />
                  <span className="text-[11px] font-medium">{theme.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION: Data & Storage */}
      {activeSection === 'data' && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              SQLite Database Health & Metrics
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Chronicles', value: stats.chronicles },
                { label: 'Characters', value: stats.characters },
                { label: 'Chats', value: stats.chats },
                { label: 'Messages', value: stats.messages },
              ].map((st) => (
                <div key={st.label} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                  <div className="font-display text-xl font-bold text-amber-400">{st.value}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{st.label}</div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-slate-200">Chronicle Snapshot Backup</h4>
                <p className="text-[11px] text-slate-500">Download a complete JSON export of all your stories and characters.</p>
              </div>

              <button
                onClick={() => api.downloadBackup()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition shadow shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: About */}
      {activeSection === 'about' && (
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div>
            <h2 className="font-display text-lg font-bold text-white tracking-wide">StoryForge</h2>
            <p className="text-xs text-amber-400 font-medium">v1.0.0 &bull; Private AI Storytelling Platform</p>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed font-prose text-[14px]">
            StoryForge is an independent, mobile-first storytelling and roleplay platform built for intimate single-user immersion. Powered by SQLite and modular LLM providers with zero third-party telemetry, your chronicles remain strictly private on your own system.
          </p>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
            <div className="text-slate-200 font-semibold">Architectural Foundation:</div>
            <div>&bull; SQLite relational database with WAL journal mode</div>
            <div>&bull; Server-side LLM provider abstraction (Gemini + Local llama.cpp / Ollama)</div>
            <div>&bull; ContextManager & StoryEngine prompt assembling</div>
            <div>&bull; Progressive Web App (PWA) with installable Android shell</div>
          </div>
        </div>
      )}
    </div>
  );
};
