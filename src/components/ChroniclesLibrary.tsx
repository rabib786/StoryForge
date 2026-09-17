import React, { useState, useMemo } from 'react';
import {
  Search,
  Star,
  Plus,
  BookOpen,
  Calendar,
  Filter,
  ArrowRight,
  Edit3,
} from 'lucide-react';
import { Chronicle } from '../types';

interface ChroniclesLibraryProps {
  chronicles: Chronicle[];
  onOpenStory: (chronicleId: string) => void;
  onEditChronicle: (chronicleId: string) => void;
  onNewStory: () => void;
  onToggleFavorite: (chronicleId: string) => void;
}

const GENRES = ['All', 'Fantasy', 'Sci-Fi', 'Dark Mystery', 'Cyberpunk', 'Gothic', 'Adventure', 'Romance'];

export const ChroniclesLibrary: React.FC<ChroniclesLibraryProps> = ({
  chronicles,
  onOpenStory,
  onEditChronicle,
  onNewStory,
  onToggleFavorite,
}) => {
  const [search, setSearch] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const filteredChronicles = useMemo(() => {
    return chronicles.filter((s) => {
      const matchSearch =
        search.trim() === '' ||
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase());

      const matchGenre = selectedGenre === 'All' || s.genre.toLowerCase() === selectedGenre.toLowerCase();
      const matchFav = !onlyFavorites || s.is_favorite === 1;

      return matchSearch && matchGenre && matchFav;
    });
  }, [chronicles, search, selectedGenre, onlyFavorites]);

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-5 space-y-4">
      {/* Top action row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-white tracking-wide">
            Story Library
          </h1>
          <p className="text-xs text-slate-400">
            {chronicles.length} {chronicles.length === 1 ? 'chronicle' : 'chronicles'} forged
          </p>
        </div>

        <button
          onClick={onNewStory}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition shadow active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>New Story</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chronicles by title or themes..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>

        {/* Filters Carousel */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setOnlyFavorites(!onlyFavorites)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition ${
              onlyFavorites
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Star className={`w-3 h-3 ${onlyFavorites ? 'fill-amber-400 text-amber-400' : ''}`} />
            <span>Favorites</span>
          </button>

          {GENRES.map((genre) => (
            <button
              key={genre}
              onClick={() => setSelectedGenre(genre)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition ${
                selectedGenre === genre
                  ? 'bg-slate-700 text-white border border-slate-600'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-300'
              }`}
            >
              {genre}
            </button>
          ))}
        </div>
      </div>

      {/* Story Cards List / Grid */}
      {filteredChronicles.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {filteredChronicles.map((sc) => {
            let tagsArray: string[] = [];
            try {
              tagsArray = JSON.parse(sc.tags || '[]');
            } catch {
              tagsArray = [];
            }

            return (
              <div
                key={sc.id}
                onClick={() => onOpenStory(sc.id)}
                className="group relative overflow-hidden rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/95 transition duration-150 cursor-pointer flex flex-col justify-between p-4 shadow-sm"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-800 text-amber-400/90 border border-slate-700/60">
                      {sc.genre}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        title="Edit Chronicle Configuration"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditChronicle(sc.id);
                        }}
                        className="p-1 text-slate-500 hover:text-slate-300 rounded hover:bg-slate-800 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        title="Toggle Favorite"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(sc.id);
                        }}
                        className="p-1 text-slate-500 hover:text-amber-400 rounded hover:bg-slate-800 transition"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            sc.is_favorite === 1 ? 'text-amber-400 fill-amber-400' : ''
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="font-display text-base font-bold text-slate-100 group-hover:text-amber-300 transition truncate">
                    {sc.title}
                  </h3>

                  <p className="text-xs text-slate-400 line-clamp-3 mt-1.5 font-prose text-[14px] leading-relaxed">
                    {sc.description || sc.opening_message || 'An unfolding journey in the world of StoryForge.'}
                  </p>

                  {/* Tags */}
                  {tagsArray.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {tagsArray.slice(0, 3).map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer with date and launch */}
                <div className="mt-4 pt-2.5 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1 text-[11px]">
                    <Calendar className="w-3 h-3 text-slate-500" />
                    {new Date(sc.updated_at).toLocaleDateString()}
                  </span>

                  <span className="text-amber-400 font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform text-xs">
                    <span>Enter Story</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-300">No matching chronicles found</h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Try adjusting your search terms or genre filter, or craft a brand new tale.
          </p>
          <button
            onClick={onNewStory}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Story</span>
          </button>
        </div>
      )}
    </div>
  );
};
