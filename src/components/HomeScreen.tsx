import React from 'react';
import {
  Sparkles,
  Play,
  PlusCircle,
  UserPlus,
  Sliders,
  Star,
  BookOpen,
  ArrowRight,
  Clock,
  Flame,
} from 'lucide-react';
import { Chronicle, StorySession } from '../types';

interface HomeScreenProps {
  chronicles: Chronicle[];
  recentSessions: StorySession[];
  onOpenStory: (chronicleId: string, chatId?: string) => void;
  onNewStory: () => void;
  onNewPersona: () => void;
  onOpenSettings: () => void;
  onToggleFavorite: (chronicleId: string) => void;
  onViewAllStories: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  chronicles,
  recentSessions,
  onOpenStory,
  onNewStory,
  onNewPersona,
  onOpenSettings,
  onToggleFavorite,
  onViewAllStories,
}) => {
  const favoriteChronicles = chronicles.filter((s) => s.is_favorite === 1);
  const recentChronicles = chronicles.slice(0, 4);

  // Most recent continue target (either first chat or first chronicle)
  const continueChronicle = chronicles[0];
  const continueChat = recentSessions[0];

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-5 space-y-6">
      {/* Hero Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-[#131926] to-[#0d121d] border border-slate-800/80 p-5 sm:p-6 shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-amber-400 mb-1 text-xs font-semibold uppercase tracking-wider">
            <Flame className="w-3.5 h-3.5" />
            <span>Private Storytelling Sanctuary</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-wide">
            StoryForge
          </h1>
          <p className="mt-1 text-sm text-slate-400 max-w-lg leading-relaxed">
            Craft deep interactive chronicles, define rich characters and lore, and weave continuous AI-assisted narratives.
          </p>

          {/* Quick Actions Row */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <button
              onClick={onNewStory}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 transition active:scale-95 group"
            >
              <PlusCircle className="w-5 h-5 mb-1.5 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-semibold">New Story</span>
            </button>
            <button
              onClick={onNewPersona}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition active:scale-95 group"
            >
              <UserPlus className="w-5 h-5 mb-1.5 text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-medium">New Persona</span>
            </button>
            <button
              onClick={onOpenSettings}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition active:scale-95 group"
            >
              <Sliders className="w-5 h-5 mb-1.5 text-slate-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-medium">Settings</span>
            </button>
          </div>
        </div>
      </section>

      {/* Continue Reading Section */}
      {continueChronicle ? (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span>Continue Chronicle</span>
            </h2>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(continueChronicle.updated_at).toLocaleDateString()}
            </span>
          </div>

          <div
            onClick={() => onOpenStory(continueChronicle.id, continueChat?.id)}
            className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-slate-900/90 to-slate-800/70 border border-slate-700/60 p-4 sm:p-5 hover:border-amber-500/50 transition duration-200 cursor-pointer shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {continueChronicle.genre}
                  </span>
                  {continueChronicle.is_favorite === 1 && (
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  )}
                </div>
                <h3 className="font-display text-lg font-bold text-white truncate group-hover:text-amber-300 transition">
                  {continueChronicle.title}
                </h3>
                <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed font-prose text-[14px]">
                  {continueChronicle.opening_message || continueChronicle.description || 'Step into the tale...'}
                </p>
              </div>

              <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-300 group-hover:scale-110 group-hover:bg-amber-500 group-hover:text-slate-950 transition duration-200">
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          </div>
        </section>
      ) : (
        /* Empty State */
        <section className="p-8 rounded-2xl bg-slate-900/50 border border-dashed border-slate-800 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">No Chronicles Yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Your private storytelling canvas is ready. Create a chronicle with an opening scene to begin roleplaying.
          </p>
          <button
            onClick={onNewStory}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition shadow-lg"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Your First Story</span>
          </button>
        </section>
      )}

      {/* Recent Stories Section */}
      {recentChronicles.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Recent Stories
            </h2>
            <button
              onClick={onViewAllStories}
              className="text-xs text-amber-400 hover:text-amber-300 transition flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentChronicles.map((sc) => (
              <div
                key={sc.id}
                onClick={() => onOpenStory(sc.id)}
                className="group p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 hover:bg-slate-900 transition duration-150 cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase tracking-wider">
                      {sc.genre}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(sc.id);
                      }}
                      className="text-slate-500 hover:text-amber-400 p-1"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          sc.is_favorite ? 'text-amber-400 fill-amber-400' : ''
                        }`}
                      />
                    </button>
                  </div>
                  <h4 className="font-semibold text-slate-100 group-hover:text-amber-300 transition truncate text-sm">
                    {sc.title}
                  </h4>
                  <p className="text-xs text-slate-400 line-clamp-2 mt-1 font-prose text-[13px] leading-relaxed">
                    {sc.description || sc.opening_message || 'No description added.'}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{new Date(sc.updated_at).toLocaleDateString()}</span>
                  <span className="text-amber-400/90 font-medium group-hover:translate-x-0.5 transition-transform">
                    Enter &rarr;
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Favorites Section */}
      {favoriteChronicles.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>Favorites</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {favoriteChronicles.map((sc) => (
              <div
                key={sc.id}
                onClick={() => onOpenStory(sc.id)}
                className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/30 hover:border-amber-700/50 transition cursor-pointer flex items-center justify-between group"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-amber-400 font-semibold uppercase">{sc.genre}</div>
                  <div className="text-sm font-semibold text-slate-200 group-hover:text-amber-300 truncate">
                    {sc.title}
                  </div>
                </div>
                <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
