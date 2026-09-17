import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Send,
  Sparkles,
  Edit2,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Sliders,
  ChevronDown,
  Clock,
  Zap,
  Info,
  User,
  Brain,
  BookOpen,
  Pin,
  Tag,
  Plus,
  X,
  Layers,
  Eye,
} from 'lucide-react';
import { Chronicle, StorySession, Message, Persona, StoryCharacter, Memory, ContextDiagnostic } from '../types';
import { api } from '../services/api';

interface SessionViewProps {
  chronicleId: string;
  sessionId?: string;
  personas: Persona[];
  onBack: () => void;
}

export const SessionView: React.FC<SessionViewProps> = ({
  chronicleId,
  sessionId: initialSessionId,
  personas,
  onBack,
}) => {
  const [session, setSession] = useState<StorySession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chronicle, setChronicle] = useState<Chronicle | null>(null);
  const [chronicleCharacters, setChronicleCharacters] = useState<StoryCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memories & Diagnostic State
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'memories' | 'cards' | 'budget'>('memories');
  const [diagnostic, setDiagnostic] = useState<ContextDiagnostic | null>(null);
  const [loadingDiagnostic, setLoadingDiagnostic] = useState(false);

  // Manual memory creation
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryType, setMemoryType] = useState<Memory['type']>('discovery');
  const [memoryImportance, setMemoryImportance] = useState(3);
  const [memorySaving, setMemorySaving] = useState(false);

  // Input state
  const [inputMessage, setInputMessage] = useState('');
  const [isOoc, setIsOoc] = useState(false);

  // Edit message state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load memories for session
  const loadMemories = async (targetSessionId: string, targetChronicleId: string) => {
    try {
      const memRes = await api.getSessionMemories(targetSessionId, targetChronicleId);
      setMemories(memRes.memories || []);
    } catch (e) {
      console.warn('Could not load session memories:', e);
    }
  };

  // Load chat and messages
  const loadChatData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load chronicle first
      const scData = await api.getChronicle(chronicleId);
      setChronicle(scData.chronicle);
      setChronicleCharacters(scData.storyCharacters || []);

      let targetSessionId = initialSessionId;
      if (!targetSessionId) {
        if (scData.sessions.length > 0) {
          targetSessionId = scData.sessions[0].id;
        } else {
          // Create new chat
          const newChatRes = await api.createSession(chronicleId, `${scData.chronicle.title} - Session 1`);
          targetSessionId = newChatRes.session.id;
        }
      }

      if (targetSessionId) {
        const sessionData = await api.getSession(targetSessionId);
        setSession(sessionData.session);
        setMessages(sessionData.messages);
        loadMemories(targetSessionId, chronicleId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChatData();
  }, [chronicleId, initialSessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, generating]);

  // Fetch live context diagnostic
  const handleOpenInspector = async () => {
    setShowInspector(true);
    if (!session || !chronicle) return;
    setLoadingDiagnostic(true);
    try {
      const res = await api.inspectContext(session.id, chronicle.id, inputMessage || undefined);
      setDiagnostic(res.diagnostic);
    } catch (e) {
      console.warn('Failed to inspect context:', e);
    } finally {
      setLoadingDiagnostic(false);
    }
  };

  // Send message & generate response
  const handleSend = async (customPrompt?: string) => {
    if (!session || !chronicle) return;
    const textToSend = customPrompt !== undefined ? customPrompt : inputMessage;
    const finalPrompt = textToSend.trim() ? textToSend.trim() : 'Continue.';
    if (!finalPrompt && messages.length === 0) return;

    setError(null);
    setGenerating(true);
    setInputMessage('');

    // Optimistically show user message
    const tempUserMsgId = `temp-${Date.now()}`;
    if (finalPrompt) {
      const optimisticMsg: Message = {
        id: tempUserMsgId,
        session_id: session.id,
        sender_type: 'user',
        content: finalPrompt,
        is_ooc: isOoc ? 1 : 0,
        sequence_order: messages.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);
    }

    try {
      const res = await api.generateStory({
        sessionId: session.id,
        chronicleId: chronicle.id,
        userMessage: finalPrompt,
        isOoc,
      });

      if (!res.success) {
        throw new Error(res.error || 'Generation failed');
      }

      if (res.diagnostic) {
        setDiagnostic(res.diagnostic);
      }

      // Reload fresh messages and memories from DB
      const updatedChat = await api.getSession(session.id);
      setMessages(updatedChat.messages);
      loadMemories(session.id, chronicle.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
      setIsOoc(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStartEdit = (msg: Message) => {
    setEditingMessage(msg);
    setEditContent(msg.content);
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || !session) return;
    try {
      await api.editMessage(session.id, editingMessage.id, editContent);
      setMessages((prev) =>
        prev.map((m) => (m.id === editingMessage.id ? { ...m, content: editContent } : m))
      );
      setEditingMessage(null);
    } catch (err: unknown) {
      alert(`Error saving edit: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!session || !confirm('Delete this message passage?')) return;
    try {
      await api.deleteMessage(session.id, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err: unknown) {
      alert(`Error deleting message: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Memory management
  const handleSaveMemory = async () => {
    if (!session || !chronicle || !memoryContent.trim()) return;
    setMemorySaving(true);
    try {
      const res = await api.createMemory({
        chronicle_id: chronicle.id,
        session_id: session.id,
        content: memoryContent.trim(),
        type: memoryType,
        importance: memoryImportance,
      });
      setMemories((prev) => [res.memory, ...prev]);
      setMemoryContent('');
      setIsAddingMemory(false);
    } catch (e) {
      alert(`Failed to save memory: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMemorySaving(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await api.deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      alert(`Failed to delete memory: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0b0f19]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
          <span className="text-xs text-slate-400 font-medium">Entering Chronicle...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto relative bg-[#0b0f19]">
      {/* Top Reading Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800/90 bg-[#0b0f19]/95 backdrop-blur-md px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-white truncate tracking-wide">
              {chronicle?.title}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="text-amber-400/90 font-medium">{chronicle?.genre}</span>
              {chronicleCharacters.length > 0 && (
                <>
                  <span>&bull;</span>
                  <span className="truncate max-w-[120px]">
                    {chronicleCharacters.map((c) => c.name).join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Context & Memory Inspector Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenInspector}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 text-slate-300 hover:text-amber-300 text-xs font-semibold transition shadow-sm"
          >
            <Brain className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Context & Memories</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-amber-400">
              {memories.length}
            </span>
          </button>
        </div>
      </header>

      {/* Error Alert Bar */}
      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <span className="line-clamp-2">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white text-sm font-bold ml-2">
            &times;
          </button>
        </div>
      )}

      {/* Scrollable Story Stream */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* Chronicle Setting Prologue Card */}
        {chronicle && (chronicle.world_info || chronicle.system_instructions) && (
          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-amber-400/80 font-semibold uppercase tracking-wider text-[10px]">
              <Info className="w-3.5 h-3.5" />
              <span>Chronicle Prologue & Setting</span>
            </div>
            {chronicle.world_info && (
              <p className="line-clamp-2 italic text-slate-300">{chronicle.world_info}</p>
            )}
          </div>
        )}

        {messages.map((msg, index) => {
          const isUser = msg.sender_type === 'user';
          const isAi = msg.sender_type === 'ai';

          return (
            <div
              key={msg.id || index}
              className={`group relative flex flex-col ${
                isUser ? 'items-end' : 'items-start'
              }`}
            >
              {/* Sender label / metadata */}
              <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-slate-400 font-medium">
                {isUser ? (
                  <>
                    <span>You</span>
                    {msg.is_ooc === 1 && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                        OOC
                      </span>
                    )}
                  </>
                ) : (
                  <span className="flex items-center gap-1 text-amber-400/90 font-semibold">
                    <Sparkles className="w-3 h-3" />
                    <span>Storyteller</span>
                  </span>
                )}
              </div>

              {/* Passage Bubble */}
              <div
                className={`w-full max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 leading-relaxed text-sm ${
                  isUser
                    ? msg.is_ooc
                      ? 'bg-amber-950/20 border border-amber-500/30 text-amber-100 font-sans'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 font-prose'
                    : 'bg-slate-900/60 border border-slate-800/90 text-slate-100 font-prose'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* Tokens & Generation Time Badge for AI */}
                {isAi && (msg.tokens_used || msg.generation_time_ms) && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center gap-3 text-[10px] text-slate-500">
                    {msg.tokens_used ? <span>{msg.tokens_used} tokens</span> : null}
                    {msg.generation_time_ms ? <span>{(msg.generation_time_ms / 1000).toFixed(1)}s</span> : null}
                  </div>
                )}
              </div>

              {/* Message Hover Actions */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-1 px-1">
                <button
                  onClick={() => handleCopy(msg.id, msg.content)}
                  title="Copy passage"
                  className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
                >
                  {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => handleStartEdit(msg)}
                  title="Edit passage"
                  className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleDeleteMessage(msg.id)}
                  title="Delete passage"
                  className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}

        {generating && (
          <div className="flex items-center gap-2 text-xs text-amber-400 font-medium py-2 px-3 rounded-xl bg-amber-500/10 border border-amber-500/20 w-fit animate-pulse">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>Storyteller is weaving the next passage...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <footer className="p-4 border-t border-slate-800/90 bg-[#0b0f19] space-y-2">
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsOoc(!isOoc)}
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition ${
                isOoc
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800'
              }`}
            >
              {isOoc ? 'Out of Character (Active)' : 'OOC Mode'}
            </button>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Ctrl+Enter to send
            </span>
          </div>

          <button
            type="button"
            onClick={() => handleSend('Continue.')}
            disabled={generating}
            className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-40"
          >
            Ask Storyteller to Continue &rarr;
          </button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              rows={2}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isOoc
                  ? 'Speak Out Of Character (( e.g. What does Eleanor know about this relic? ))'
                  : 'Narrate your action, thought, or dialogue in quotes...'
              }
              className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border text-sm text-white placeholder-slate-500 focus:outline-none resize-none min-h-[44px] max-h-36 ${
                isOoc
                  ? 'border-amber-500/50 font-sans'
                  : 'border-slate-800 focus:border-amber-500/70 font-prose'
              }`}
            />
          </div>

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={generating || (!inputMessage.trim() && messages.length === 0)}
            className="h-11 w-11 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 flex items-center justify-center shrink-0 transition active:scale-95 shadow-md"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* Edit Message Modal */}
      {editingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#0e1320] border border-slate-700 p-5 shadow-2xl space-y-3">
            <h3 className="font-display text-sm font-bold text-white">Edit Chronicle Passage</h3>
            <textarea
              rows={6}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-sm font-prose text-slate-200 focus:outline-none focus:border-amber-500 resize-y leading-relaxed"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingMessage(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition"
              >
                Save Passage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context & Memory Inspector Drawer/Modal */}
      {showInspector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-[#0e1320] border border-slate-800 shadow-2xl overflow-hidden">
            {/* Inspector Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Context & Memory Inspector</h3>
              </div>
              <button
                onClick={() => setShowInspector(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspector Navigation */}
            <div className="flex items-center gap-2 px-5 pt-3 border-b border-slate-800 text-xs">
              <button
                onClick={() => setInspectorTab('memories')}
                className={`pb-2.5 font-semibold transition border-b-2 ${
                  inspectorTab === 'memories'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Timeline Memories ({memories.length})
              </button>
              <button
                onClick={() => setInspectorTab('cards')}
                className={`pb-2.5 font-semibold transition border-b-2 ${
                  inspectorTab === 'cards'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Active Story Cards ({diagnostic?.selectedStoryCards?.length ?? 0})
              </button>
              <button
                onClick={() => setInspectorTab('budget')}
                className={`pb-2.5 font-semibold transition border-b-2 ${
                  inspectorTab === 'budget'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Context Budget & Priority
              </button>
            </div>

            {/* Inspector Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {loadingDiagnostic && (
                <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
                  <span>Inspecting prompt token budget...</span>
                </div>
              )}

              {/* Tab: Memories */}
              {inspectorTab === 'memories' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-slate-400 text-[11px]">
                      Durable consequences derived from this session's events. Survives context trimming across long-running stories.
                    </p>
                    {!isAddingMemory && (
                      <button
                        onClick={() => setIsAddingMemory(true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-[11px]"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Memory</span>
                      </button>
                    )}
                  </div>

                  {/* Add memory form */}
                  {isAddingMemory && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-amber-500/30 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                        <span>Record Manual Fact or Event</span>
                        <button onClick={() => setIsAddingMemory(false)} className="text-slate-400 hover:text-white">
                          &times;
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase text-slate-400 font-semibold block mb-0.5">Type</label>
                          <select
                            value={memoryType}
                            onChange={(e) => setMemoryType(e.target.value as Memory['type'])}
                            className="w-full p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                          >
                            <option value="discovery">Discovery</option>
                            <option value="event">Event</option>
                            <option value="relationship">Relationship</option>
                            <option value="decision">Decision</option>
                            <option value="fact">Fact</option>
                            <option value="character_state">Character State</option>
                            <option value="item">Item</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-slate-400 font-semibold block mb-0.5">Importance (1-5)</label>
                          <select
                            value={memoryImportance}
                            onChange={(e) => setMemoryImportance(Number(e.target.value))}
                            className="w-full p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                          >
                            <option value={5}>5 - Critical Consequence</option>
                            <option value={4}>4 - Important Fact</option>
                            <option value={3}>3 - Meaningful Event</option>
                            <option value={2}>2 - Minor Detail</option>
                            <option value={1}>1 - Trivial</option>
                          </select>
                        </div>
                      </div>

                      <textarea
                        rows={2}
                        value={memoryContent}
                        onChange={(e) => setMemoryContent(e.target.value)}
                        placeholder="e.g. Alex recovered the encryption key from Sector 4..."
                        className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                      />

                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setIsAddingMemory(false)}
                          className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveMemory}
                          disabled={memorySaving || !memoryContent.trim()}
                          className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px]"
                        >
                          {memorySaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}

                  {memories.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 border border-slate-800/80 rounded-xl">
                      No memories recorded yet for this timeline. As story turns unfold, the conservative memory extraction engine will record durable consequences here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {memories.map((mem) => (
                        <div
                          key={mem.id}
                          className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-start justify-between gap-2"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.2 rounded text-[9px] uppercase font-bold tracking-wider bg-slate-800 text-amber-300">
                                {mem.type}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Importance: {mem.importance}/5
                              </span>
                              {mem.status === 'superseded' && (
                                <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-500">
                                  Superseded
                                </span>
                              )}
                            </div>
                            <p className="text-slate-200 text-xs">{mem.content}</p>
                          </div>

                          <button
                            onClick={() => handleDeleteMemory(mem.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Story Cards */}
              {inspectorTab === 'cards' && (
                <div className="space-y-3">
                  <p className="text-slate-400 text-[11px]">
                    Chronicle lore cards retrieved for this scene based on trigger keywords, scene context, or pinned status.
                  </p>

                  {!diagnostic?.selectedStoryCards || diagnostic.selectedStoryCards.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 border border-slate-800/80 rounded-xl">
                      No story cards activated for this prompt. Cards activate when keywords match the player's message or recent story, or when pinned in Chronicle Studio.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {diagnostic.selectedStoryCards.map((sc) => (
                        <div
                          key={sc.id}
                          className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white text-xs">{sc.title}</span>
                              <span className="px-1.5 py-0.2 rounded text-[9px] uppercase font-bold bg-slate-800 text-slate-300">
                                {sc.category}
                              </span>
                              {sc.isPinned && (
                                <span className="flex items-center gap-0.5 text-[9px] text-amber-400">
                                  <Pin className="w-2.5 h-2.5" />
                                  Pinned
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-amber-300 font-mono">
                              Score: {sc.relevanceScore} (~{sc.estimatedTokens} tok)
                            </span>
                          </div>

                          {sc.matchedReasons && sc.matchedReasons.length > 0 && (
                            <div className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                              <span className="text-slate-500">Triggered by:</span>
                              {sc.matchedReasons.map((r, i) => (
                                <span key={i} className="px-1.5 py-0.2 rounded bg-slate-800 text-amber-400/90">
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Budget */}
              {inspectorTab === 'budget' && diagnostic && (
                <div className="space-y-4">
                  {/* Gauge */}
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-300">Estimated Context Consumption</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {diagnostic.estimatedTotalTokens} / {diagnostic.maxContextBudget} tokens
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (diagnostic.estimatedTotalTokens / diagnostic.maxContextBudget) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Priority Breakdown Table */}
                  <div className="rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800">
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-900/80 font-semibold text-[11px] text-slate-300">
                      <span>Priority Layer</span>
                      <span>Content / Tokens</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>1. System Narrative Directive</span>
                      <span className="text-slate-400 font-mono">Protected</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>2. Chronicle Canon & World Info</span>
                      <span className="text-slate-400 font-mono">{diagnostic.canonLength} chars</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>3. Active Player Persona</span>
                      <span className="text-slate-400 font-mono">{diagnostic.activePersonaName || 'None'}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>4. Story Cast (NPCs)</span>
                      <span className="text-slate-400 font-mono">{diagnostic.storyCastCount} characters</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>5. Active Story Cards (Lore)</span>
                      <span className="text-slate-400 font-mono">{diagnostic.selectedStoryCards.length} cards</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>6. Session Memories</span>
                      <span className="text-slate-400 font-mono">{diagnostic.selectedMemories.length} active</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-slate-300 text-[11px]">
                      <span>7. Recent Conversation History</span>
                      <span className="text-slate-400 font-mono">{diagnostic.historyMessagesCount} messages</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
