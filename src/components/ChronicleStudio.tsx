import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Save,
  Sparkles,
  Trash2,
  BookOpen,
  Pin,
  Tag,
  Plus,
  Edit2,
  Check,
  X,
  Layers,
} from 'lucide-react';
import { Chronicle, StoryCard } from '../types';
import { api } from '../services/api';

interface ChronicleStudioProps {
  chronicleId?: string | null;
  onBack: () => void;
  onSaved: (savedChronicle: Chronicle) => void;
}

const GENRES = [
  'Fantasy',
  'Dark Fantasy',
  'Sci-Fi',
  'Cyberpunk',
  'Gothic Horror',
  'Mystery',
  'Adventure',
  'Post-Apocalyptic',
  'Slice of Life',
  'Romance',
];

const CARD_CATEGORIES: Array<StoryCard['category']> = [
  'lore',
  'location',
  'faction',
  'item',
  'rule',
];

export const ChronicleStudio: React.FC<ChronicleStudioProps> = ({
  chronicleId,
  onBack,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'cards'>('details');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chronicle Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('Fantasy');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [systemInstructions, setSystemInstructions] = useState('');
  const [openingMessage, setOpeningMessage] = useState('');
  const [worldInfo, setWorldInfo] = useState('');

  // Story Cards state
  const [storyCards, setStoryCards] = useState<StoryCard[]>([]);
  const [editingCard, setEditingCard] = useState<StoryCard | null>(null);
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const [cardTitle, setCardTitle] = useState('');
  const [cardContent, setCardContent] = useState('');
  const [cardCategory, setCardCategory] = useState<StoryCard['category']>('lore');
  const [cardPinned, setCardPinned] = useState(false);
  const [cardActive, setCardActive] = useState(true);
  const [cardTriggersInput, setCardTriggersInput] = useState('');
  const [cardSaving, setCardSaving] = useState(false);

  // Load existing chronicle if chronicleId passed
  const loadChronicleData = () => {
    if (!chronicleId) return;
    setLoading(true);
    api
      .getChronicle(chronicleId)
      .then((data) => {
        const sc = data.chronicle;
        setTitle(sc.title);
        setDescription(sc.description || '');
        setGenre(sc.genre || 'Fantasy');
        setSystemInstructions(sc.system_instructions || '');
        setOpeningMessage(sc.opening_message || '');
        setWorldInfo(sc.world_info || '');
        if (sc.tags) {
          try {
            setTags(JSON.parse(sc.tags));
          } catch {
            setTags([]);
          }
        }
        setStoryCards(data.storyCards || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadChronicleData();
  }, [chronicleId]);

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Chronicle title is required');
      return;
    }
    setError(null);
    setSaving(true);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        genre,
        tags: tags,
        system_instructions: systemInstructions.trim(),
        opening_message: openingMessage.trim(),
        world_info: worldInfo.trim(),
      };

      if (chronicleId) {
        const res = await api.updateChronicle(chronicleId, payload);
        onSaved(res.chronicle);
      } else {
        const res = await api.createChronicle(payload);
        onSaved(res.chronicle);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!chronicleId) return;
    if (!confirm('Are you sure you want to delete this chronicle? All related chats and messages will be removed.')) return;
    try {
      await api.deleteChronicle(chronicleId);
      onBack();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Story Cards handlers
  const handleOpenCreateCard = () => {
    setEditingCard(null);
    setCardTitle('');
    setCardContent('');
    setCardCategory('lore');
    setCardPinned(false);
    setCardActive(true);
    setCardTriggersInput('');
    setIsCreatingCard(true);
  };

  const handleOpenEditCard = (card: StoryCard) => {
    setEditingCard(card);
    setCardTitle(card.title);
    setCardContent(card.content);
    setCardCategory(card.category);
    setCardPinned(!!card.is_pinned);
    setCardActive(!!card.is_active);
    setCardTriggersInput(card.triggers ? card.triggers.join(', ') : '');
    setIsCreatingCard(true);
  };

  const handleSaveCard = async () => {
    if (!chronicleId) {
      setError('Please save the chronicle first before creating story cards.');
      return;
    }
    if (!cardTitle.trim() || !cardContent.trim()) {
      setError('Card title and content are required.');
      return;
    }

    setCardSaving(true);
    try {
      const triggers = cardTriggersInput
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (editingCard) {
        const res = await api.updateStoryCard(editingCard.id, {
          title: cardTitle.trim(),
          content: cardContent.trim(),
          category: cardCategory,
          is_pinned: cardPinned ? 1 : 0,
          is_active: cardActive ? 1 : 0,
          triggers,
        });
        setStoryCards((prev) =>
          prev.map((c) => (c.id === editingCard.id ? res.storyCard : c))
        );
      } else {
        const res = await api.createStoryCard({
          chronicle_id: chronicleId,
          title: cardTitle.trim(),
          content: cardContent.trim(),
          category: cardCategory,
          is_pinned: cardPinned,
          is_active: cardActive,
          triggers,
        });
        setStoryCards((prev) => [...prev, res.storyCard]);
      }
      setIsCreatingCard(false);
      setEditingCard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCardSaving(false);
    }
  };

  const handleToggleCardPinned = async (card: StoryCard) => {
    try {
      const res = await api.toggleStoryCardPinned(card.id);
      setStoryCards((prev) =>
        prev.map((c) => (c.id === card.id ? res.storyCard : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Are you sure you want to delete this story card?')) return;
    try {
      await api.deleteStoryCard(cardId);
      setStoryCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-5 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 py-1 px-2 rounded-lg hover:bg-slate-800/80 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <h2 className="font-display text-base font-bold text-white tracking-wide">
          {chronicleId ? 'Edit Chronicle' : 'Forge New Chronicle'}
        </h2>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-bold transition shadow active:scale-95"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save'}</span>
        </button>
      </div>

      {/* Tabs Navigation (if editing existing chronicle) */}
      {chronicleId && (
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'details'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Chronicle Details
          </button>
          <button
            onClick={() => setActiveTab('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'cards'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Story Cards & Lore</span>
            <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-slate-800 text-slate-300 rounded-full">
              {storyCards.length}
            </span>
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs leading-relaxed flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">
            &times;
          </button>
        </div>
      )}

      {/* Tab: Chronicle Details */}
      {activeTab === 'details' && (
        <div className="space-y-5 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Chronicle Title <span className="text-amber-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ashen Station, Outpost 79, The Glass Frontier"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/70"
            />
          </div>

          {/* Genre & Tags Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Genre */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Genre & Atmosphere
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:border-amber-500/70"
              >
                {GENRES.map((g) => (
                  <option key={g} value={g} className="bg-slate-900 text-slate-200">
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Themes / Tags
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleAddTag}
                  placeholder="Type tag & press Enter"
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/70"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium"
                >
                  Add
                </button>
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md"
                    >
                      #{t}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t)}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Description / Pitch */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Premise & Synopsis
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short hook summarizing the story context for your library..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/70 resize-y"
            />
          </div>

          {/* Opening Message (Starting seed) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Opening Scene (First AI Message)</span>
              </label>
              <span className="text-[11px] text-slate-500">Seeds the opening timeline</span>
            </div>
            <textarea
              rows={4}
              value={openingMessage}
              onChange={(e) => setOpeningMessage(e.target.value)}
              placeholder="Write the initial atmospheric scene where your story begins. Set the location, immediate sensory tension, or greeting from a companion..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-prose text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/70 resize-y leading-relaxed"
            />
          </div>

          {/* Chronicle Instructions (AI Guidelines) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              AI Storyteller Directives (Instructions)
            </label>
            <textarea
              rows={3}
              value={systemInstructions}
              onChange={(e) => setSystemInstructions(e.target.value)}
              placeholder="Specific pacing rules, narrative perspective (e.g. 2nd person 'you', or 3rd person), dialogue quirks, forbidden tropes, or tension curves..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/70 resize-y"
            />
          </div>

          {/* World Info & Setting */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              World Setting & Canon Rules
            </label>
            <textarea
              rows={3}
              value={worldInfo}
              onChange={(e) => setWorldInfo(e.target.value)}
              placeholder="Geography, magical laws, technology tier, historical events, factions in conflict..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/70 resize-y"
            />
          </div>
        </div>
      )}

      {/* Tab: Story Cards & Lore */}
      {activeTab === 'cards' && chronicleId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <span>Story Cards (Context Lore Engine)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Contextual lore retrieved dynamically based on scene trigger keywords or pinned to always remain active.
              </p>
            </div>

            {!isCreatingCard && (
              <button
                onClick={handleOpenCreateCard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition shadow"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Story Card</span>
              </button>
            )}
          </div>

          {/* Card Creation / Editing Form */}
          {isCreatingCard && (
            <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  {editingCard ? 'Edit Story Card' : 'Create New Story Card'}
                </h4>
                <button
                  onClick={() => setIsCreatingCard(false)}
                  className="text-slate-400 hover:text-slate-200 text-xs"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Title <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={cardTitle}
                    onChange={(e) => setCardTitle(e.target.value)}
                    placeholder="e.g. Reactor Core, The Obsidian Order, Hyperlane Rule"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={cardCategory}
                    onChange={(e) => setCardCategory(e.target.value as StoryCard['category'])}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    {CARD_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-slate-900">
                        {cat.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Trigger Keywords (comma-separated)
                </label>
                <input
                  type="text"
                  value={cardTriggersInput}
                  onChange={(e) => setCardTriggersInput(e.target.value)}
                  placeholder="e.g. reactor, radiation, core, blackout, engineer"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  When any of these keywords appear in the player's message or recent story, this card is dynamically injected into LLM context.
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Lore / Card Content <span className="text-amber-400">*</span>
                </label>
                <textarea
                  rows={3}
                  value={cardContent}
                  onChange={(e) => setCardContent(e.target.value)}
                  placeholder="Write the specific contextual lore, secrets, operational rules, or environmental details that the narrative engine should know when this card activates..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={cardPinned}
                    onChange={(e) => setCardPinned(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-0"
                  />
                  <span>Always Pinned (Always included in context)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={cardActive}
                    onChange={(e) => setCardActive(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-0"
                  />
                  <span>Active</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsCreatingCard(false)}
                  className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCard}
                  disabled={cardSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{cardSaving ? 'Saving...' : 'Save Card'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Cards List */}
          {storyCards.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl text-slate-500 text-xs">
              No story cards yet for this chronicle. Create cards for factions, locations, items, or secrets with trigger keywords to activate them when mentioned.
            </div>
          ) : (
            <div className="space-y-2.5">
              {storyCards.map((card) => (
                <div
                  key={card.id}
                  className={`p-3.5 rounded-xl border transition ${
                    card.is_pinned
                      ? 'bg-amber-950/10 border-amber-500/30'
                      : card.is_active
                      ? 'bg-slate-900/60 border-slate-800'
                      : 'bg-slate-950/40 border-slate-900 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-white tracking-wide">
                          {card.title}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-slate-800 text-slate-300">
                          {card.category}
                        </span>
                        {card.is_pinned ? (
                          <span className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                            <Pin className="w-2.5 h-2.5" />
                            Pinned
                          </span>
                        ) : null}
                        {!card.is_active && (
                          <span className="text-[10px] text-slate-500">Inactive</span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                        {card.content}
                      </p>

                      {card.triggers && card.triggers.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <Tag className="w-3 h-3 text-slate-500" />
                          {card.triggers.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-amber-300/80"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleCardPinned(card)}
                        title={card.is_pinned ? 'Unpin card' : 'Pin card to context'}
                        className={`p-1.5 rounded-lg transition ${
                          card.is_pinned
                            ? 'text-amber-400 hover:bg-amber-500/20'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleOpenEditCard(card)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        className="p-1.5 rounded-lg text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete button if editing */}
      {chronicleId && (
        <div className="pt-2 flex justify-end">
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-semibold transition"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Chronicle</span>
          </button>
        </div>
      )}
    </div>
  );
};
