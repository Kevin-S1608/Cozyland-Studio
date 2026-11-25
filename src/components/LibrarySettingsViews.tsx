import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  Moon,
  Play,
  Search,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { apiJson } from '../lib/api';
import {
  type Episode,
  PODCAST_DURATIONS,
  PODCAST_STYLES,
  type PodcastDuration,
  type PodcastLanguage,
  type PodcastStyle,
  SUPPORTED_LANGUAGES,
} from '../types/podcast';
import { formatTime } from './AudioPlayerBar';
import { CoverArtwork } from './CoverArtwork';

interface LibraryViewProps {
  episodes: Episode[];
  onOpenEpisode: (ep: Episode, tab?: 'transcript' | '3d') => void;
  onEpisodeUpdated: (ep: Episode) => void;
  onEpisodeDeleted: (id: string) => void;
  onGoCreate: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  episodes,
  onOpenEpisode,
  onEpisodeUpdated,
  onEpisodeDeleted,
  onGoCreate,
}) => {
  const [search, setSearch] = useState('');
  const [filterLang, setFilterLang] = useState<string>('ALL');
  const [filterStyle, setFilterStyle] = useState<string>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return episodes.filter((ep) => {
      if (filterLang !== 'ALL' && ep.plan.language !== filterLang) return false;
      if (filterStyle !== 'ALL' && ep.plan.style !== filterStyle) return false;
      if (!q) return true;
      return (
        ep.plan.title.toLowerCase().includes(q) ||
        ep.topicInput.toLowerCase().includes(q) ||
        ep.plan.topicOverview.toLowerCase().includes(q)
      );
    });
  }, [episodes, search, filterLang, filterStyle]);

  const handleRename = async (ep: Episode) => {
    const nextTitle = editTitle.trim();
    if (!nextTitle) return;
    try {
      const res = await apiJson<{ episode: Episode }>(`/api/episodes/${ep.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: nextTitle }),
      });
      onEpisodeUpdated(res.episode);
      setEditingId(null);
    } catch {
      setEditingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiJson(`/api/episodes/${id}`, { method: 'DELETE' });
      onEpisodeDeleted(id);
      setConfirmDeleteId(null);
    } catch {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#18122B] dark:text-white">
            Podcast Library
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            Search, filter, rename, resume playback, or open any 3D explainer.
          </p>
        </div>

        <button
          type="button"
          onClick={onGoCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#8B5CF6] to-[#EC4899] text-white self-start whitespace-nowrap"
        >
          <Sparkles className="w-4 h-4" />
          New Episode
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search episodes by title or topic..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-white dark:bg-[#111526] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>

        <div className="sm:col-span-3">
          <select
            value={filterLang}
            onChange={(e) => setFilterLang(e.target.value)}
            aria-label="Filter by language"
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-white dark:bg-[#111526] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
          >
            <option value="ALL">All Languages</option>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-3">
          <select
            value={filterStyle}
            onChange={(e) => setFilterStyle(e.target.value)}
            aria-label="Filter by style"
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-white dark:bg-[#111526] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
          >
            <option value="ALL">All Styles</option>
            {PODCAST_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Episodes Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D8CFF2] dark:border-white/15 bg-white dark:bg-[#111526] p-10 text-center space-y-2">
          <p className="font-display font-semibold text-base text-[#18122B] dark:text-white">
            No matching episodes found
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Try clearing your filters or create a brand-new episode from a single line.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((ep) => (
            <div
              key={ep.id}
              className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-4 flex gap-4 items-start"
            >
              <CoverArtwork episode={ep} size="md" />

              <div className="min-w-0 flex-1 space-y-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {ep.plan.language} · {ep.plan.style} · {formatTime(ep.totalDurationSec)}
                </div>

                {editingId === ep.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 px-2.5 py-1 rounded-lg text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#8B5CF6] text-[#18122B] dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(ep)}
                      className="p-1.5 rounded-lg bg-emerald-600 text-white"
                      aria-label="Save title"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded-lg bg-slate-200 dark:bg-white/10"
                      aria-label="Cancel rename"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <h3 className="font-display font-semibold text-base text-[#18122B] dark:text-white line-clamp-2">
                    {ep.plan.title}
                  </h3>
                )}

                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                  {ep.plan.topicOverview}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenEpisode(ep, 'transcript')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#8B5CF6] text-white hover:bg-[#7C3AED] whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Play &amp; Transcript
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEpisode(ep, '3d')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#E5DFF5] dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#22D3EE] whitespace-nowrap"
                  >
                    3D View
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(ep.id);
                      setEditTitle(ep.plan.title);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-[#8B5CF6]"
                    aria-label="Rename episode"
                    title="Rename episode"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  {confirmDeleteId === ep.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(ep.id)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-600 text-white"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded-lg text-xs text-slate-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(ep.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500"
                      aria-label="Delete episode"
                      title="Delete episode"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface SettingsViewProps {
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  defaultLanguage: PodcastLanguage;
  onDefaultLanguageChange: (lang: PodcastLanguage) => void;
  defaultDuration: PodcastDuration;
  onDefaultDurationChange: (dur: PodcastDuration) => void;
  defaultStyle: PodcastStyle;
  onDefaultStyleChange: (style: PodcastStyle) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onThemeChange,
  defaultLanguage,
  onDefaultLanguageChange,
  defaultDuration,
  onDefaultDurationChange,
  defaultStyle,
  onDefaultStyleChange,
}) => {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#18122B] dark:text-white">
          Studio Settings
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Personalize your studio theme and default episode generation preferences.
        </p>
      </div>

      {/* Theme Appearance */}
      <section className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 space-y-4">
        <h2 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
          Appearance
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onThemeChange('light')}
            className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
              theme === 'light'
                ? 'border-[#8B5CF6] bg-[#F3EEFF] text-[#18122B]'
                : 'border-[#E5DFF5] dark:border-white/10 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Sun className="w-5 h-5 text-[#FB923C]" />
            <div>
              <div className="font-semibold text-sm">Light Studio</div>
              <div className="text-xs opacity-75">Soft lavender &amp; bright studio surfaces</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onThemeChange('dark')}
            className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
              theme === 'dark'
                ? 'border-[#8B5CF6] bg-[#1E193E] text-white'
                : 'border-[#E5DFF5] dark:border-white/10 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Moon className="w-5 h-5 text-[#22D3EE]" />
            <div>
              <div className="font-semibold text-sm">Dark Studio</div>
              <div className="text-xs opacity-75">Deep navy canvas with glowing violet &amp; cyan accents</div>
            </div>
          </button>
        </div>
      </section>

      {/* Default Generation Preferences */}
      <section className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 space-y-4">
        <h2 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
          Default Podcast Preferences
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1.5">
              Default Language
            </label>
            <select
              value={defaultLanguage}
              onChange={(e) => onDefaultLanguageChange(e.target.value as PodcastLanguage)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1.5">
              Default Length
            </label>
            <select
              value={defaultDuration}
              onChange={(e) => onDefaultDurationChange(e.target.value as PodcastDuration)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
            >
              {PODCAST_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1.5">
              Default Style
            </label>
            <select
              value={defaultStyle}
              onChange={(e) => onDefaultStyleChange(e.target.value as PodcastStyle)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
            >
              {PODCAST_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
};
