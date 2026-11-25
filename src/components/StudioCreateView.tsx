import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Square,
} from 'lucide-react';
import {
  type DialogueTurn,
  type Episode,
  type EpisodePlan,
  type ExplainerSceneData,
  type PipelineStageId,
  PODCAST_DURATIONS,
  PODCAST_STYLES,
  type PodcastDuration,
  type PodcastLanguage,
  type PodcastStyle,
  type QualityControlReport,
  SUPPORTED_LANGUAGES,
} from '../types/podcast';
import { formatTime } from '../lib/format';
import { CoverArtwork } from './CoverArtwork';
import STUDIO_BACKDROP_WEBP_640 from '../assets/images/studio_hero_backdrop_640.webp';
import STUDIO_BACKDROP_WEBP_1280 from '../assets/images/studio_hero_backdrop_1280.webp';
import RIYA_AVATAR from '../assets/images/host_riya_avatar_160.webp';
import ARJUN_AVATAR from '../assets/images/host_arjun_avatar_160.webp';

const STUDIO_BACKDROP_FALLBACK = '/src/assets/images/studio_hero_backdrop_1795597437143.jpg';

const QUICK_TOPICS = [
  'How does the human brain work?',
  'The role of music in human life',
  'Quantum computing explained simply',
  'Climate change and sustainable development',
  'The future of autonomous vehicles',
  'How the Internet works',
];

const PIPELINE_STEPS: Array<{ id: PipelineStageId; label: string }> = [
  { id: 'understanding', label: 'Understanding topic' },
  { id: 'planning', label: 'Planning episode' },
  { id: 'writing', label: 'Writing dialogue' },
  { id: 'quality_control', label: 'Quality control' },
  { id: 'visualizing', label: '3D explainer & cover' },
  { id: 'audio_hosts', label: 'Generating host audio' },
  { id: 'audio_combining', label: 'Combining audio' },
  { id: 'finalizing', label: 'Ready' },
];

export interface LiveGenerationState {
  isGenerating: boolean;
  stage: PipelineStageId | null;
  statusMessage: string;
  plan: EpisodePlan | null;
  turns: DialogueTurn[];
  qcReport: QualityControlReport | null;
  scene3D: ExplainerSceneData | null;
  audioProgress: { completed: number; total: number } | null;
  partialEpisode: Episode | null;
  error: string | null;
}

interface StudioCreateViewProps {
  defaultLanguage: PodcastLanguage;
  defaultDuration: PodcastDuration;
  defaultStyle: PodcastStyle;
  liveState: LiveGenerationState;
  recentEpisodes: Episode[];
  episodesLoading?: boolean;
  onGenerate: (params: {
    topicInput: string;
    referenceUrl: string;
    language: PodcastLanguage;
    duration: PodcastDuration;
    style: PodcastStyle;
  }) => void;
  onCancelGeneration: () => void;
  onRetryAudio: (episode: Episode) => void;
  onOpenEpisode: (episode: Episode, tab?: 'transcript' | '3d') => void;
}

export const StudioCreateView: React.FC<StudioCreateViewProps> = ({
  defaultLanguage,
  defaultDuration,
  defaultStyle,
  liveState,
  recentEpisodes,
  episodesLoading = false,
  onGenerate,
  onCancelGeneration,
  onRetryAudio,
  onOpenEpisode,
}) => {
  const [topicInput, setTopicInput] = useState<string>('');
  const [referenceUrl, setReferenceUrl] = useState<string>('');
  const [language, setLanguage] = useState<PodcastLanguage>(defaultLanguage);
  const [duration, setDuration] = useState<PodcastDuration>(defaultDuration);
  const [style, setStyle] = useState<PodcastStyle>(defaultStyle);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim() || liveState.isGenerating) return;
    onGenerate({
      topicInput: topicInput.trim(),
      referenceUrl: referenceUrl.trim(),
      language,
      duration,
      style,
    });
  };

  const currentStepIdx = liveState.stage
    ? PIPELINE_STEPS.findIndex((s) => s.id === liveState.stage)
    : -1;

  return (
    <div className="space-y-8">
      {/* Studio Welcome Banner */}
      <section className="relative rounded-2xl overflow-hidden border border-[#E5DFF5] dark:border-white/10 min-h-[210px] flex items-end bg-[#101D2C]">
        <picture>
          <source
            type="image/webp"
            srcSet={`${STUDIO_BACKDROP_WEBP_640} 640w, ${STUDIO_BACKDROP_WEBP_1280} 1280w`}
            sizes="(max-width: 768px) 100vw, 1280px"
          />
          <img
            src={STUDIO_BACKDROP_FALLBACK}
            alt="Cozyland podcast studio interior"
            width={1280}
            height={714}
            fetchPriority="high"
            decoding="async"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-r from-[#090B14] via-[#0F1328]/90 to-[#4C1D95]/65" />

        <div className="relative z-10 w-full p-6 sm:p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="text-xs font-mono-tabular text-[#22D3EE] tracking-wide">
              Cozyland AI Podcast &amp; 3D Studio
            </div>
            <h1 className="font-display font-bold text-2xl sm:text-4xl text-white text-balance leading-tight">
              Turn one line into a two-host podcast and 3D explainer.
            </h1>
            <p className="text-sm text-slate-200 max-w-xl">
              Enter any topic, question, article, or link. Riya and Arjun research, debate, speak in 14 languages, and build an interactive 3D visual guide.
            </p>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2.5 bg-[#090B14]/85 border border-white/15 rounded-xl px-3.5 py-2">
              <img
                src={RIYA_AVATAR}
                alt="Riya"
                width={36}
                height={36}
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover"
              />
              <div>
                <div className="text-xs font-semibold text-white">Riya</div>
                <div className="text-[11px] text-[#F472B6]">Explainer</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 bg-[#090B14]/85 border border-white/15 rounded-xl px-3.5 py-2">
              <img
                src={ARJUN_AVATAR}
                alt="Arjun"
                width={36}
                height={36}
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover"
              />
              <div>
                <div className="text-xs font-semibold text-white">Arjun</div>
                <div className="text-[11px] text-[#22D3EE]">Co-Host</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Creation Workspace */}
      <section className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 sm:p-7 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label
                htmlFor="topic-input"
                className="font-display font-semibold text-base text-[#18122B] dark:text-white"
              >
                What should Riya &amp; Arjun explore today?
              </label>
              <span className="text-xs text-slate-600 dark:text-slate-300">
                Single word, question, pasted text, or website URL
              </span>
            </div>

            <textarea
              id="topic-input"
              rows={3}
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              placeholder="e.g., How does the human brain store memories? — or paste a paragraph or URL"
              className="w-full rounded-xl p-4 text-base bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E2DAF5] dark:border-white/15 text-[#18122B] dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:border-[#8B5CF6] transition-colors resize-y"
            />

            {/* Quick Starter Ideas */}
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              <span className="text-xs text-slate-600 dark:text-slate-300 mr-1">Try:</span>
              {QUICK_TOPICS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setTopicInput(sample)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-[#F5F2FC] dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-[#EAE2FA] dark:hover:bg-white/10 transition-colors"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          {/* Controls Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="ref-url"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
              >
                <Link2 className="w-3.5 h-3.5 text-[#1D4ED8] dark:text-[#60A5FA]" />
                Reference URL (Optional)
              </label>
              <input
                id="ref-url"
                type="url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E2DAF5] dark:border-white/15 text-[#18122B] dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label
                htmlFor="lang-select"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
              >
                <Globe className="w-3.5 h-3.5 text-[#0E7490] dark:text-[#22D3EE]" />
                Podcast Language
              </label>
              <select
                id="lang-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value as PodcastLanguage)}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E2DAF5] dark:border-white/15 text-[#18122B] dark:text-white focus:outline-none focus:border-[#8B5CF6]"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="style-select"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#BE185D] dark:text-[#F472B6]" />
                Podcast Style
              </label>
              <select
                id="style-select"
                value={style}
                onChange={(e) => setStyle(e.target.value as PodcastStyle)}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E2DAF5] dark:border-white/15 text-[#18122B] dark:text-white focus:outline-none focus:border-[#8B5CF6]"
              >
                {PODCAST_STYLES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                <Clock className="w-3.5 h-3.5 text-[#C2410C] dark:text-[#FB923C]" />
                Episode Length
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F5F2FC] dark:bg-[#090B14] border border-[#E2DAF5] dark:border-white/15">
                {PODCAST_DURATIONS.map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    aria-pressed={duration === dur}
                    onClick={() => setDuration(dur)}
                    className={`py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      duration === dur
                        ? 'bg-white dark:bg-[#1E1B3A] text-[#5B21B6] dark:text-white shadow-sm'
                        : 'text-slate-700 dark:text-slate-300 hover:text-[#18122B] dark:hover:text-white'
                    }`}
                  >
                    {dur}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Submit / Cancel Row */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Generates grounded script, quality review, 3D explainer model, 800×800 cover art, and multi-host speech.
            </p>

            <div className="flex items-center gap-3">
              {liveState.isGenerating ? (
                <button
                  type="button"
                  onClick={onCancelGeneration}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border border-rose-400 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors whitespace-nowrap"
                >
                  <Square className="w-4 h-4" />
                  Cancel Generation
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!topicInput.trim()}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#6D28D9] via-[#BE185D] to-[#BE123C] text-white shadow-md hover:opacity-95 disabled:opacity-40 transition-opacity whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate Podcast
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </form>
      </section>

      {/* Live Generation Progress & Error Recovery */}
      {(liveState.isGenerating || liveState.error || liveState.plan) && (
        <section className="animate-studio-enter rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {liveState.isGenerating ? (
                <Loader2 className="w-5 h-5 text-[#6D28D9] dark:text-[#C4B5FD] animate-spin" />
              ) : liveState.error ? (
                <AlertCircle className="w-5 h-5 text-rose-500" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              )}
              <div>
                <h2 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
                  {liveState.plan ? liveState.plan.title : 'Live Studio Pipeline'}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {liveState.statusMessage}
                </p>
              </div>
            </div>

            {liveState.audioProgress && (
              <span className="font-mono-tabular text-xs font-semibold text-[#0E7490] dark:text-[#22D3EE]">
                Segment {liveState.audioProgress.completed} / {liveState.audioProgress.total}
              </span>
            )}
          </div>

          {/* Real Step Tracker */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {PIPELINE_STEPS.map((step, idx) => {
              const isDone =
                !liveState.isGenerating && !liveState.error && liveState.stage === 'finalizing'
                  ? true
                  : currentStepIdx > idx;
              const isActive = liveState.isGenerating && currentStepIdx === idx;
              return (
                <div
                  key={step.id}
                  className={`rounded-xl px-2.5 py-2 border text-xs transition-colors ${
                    isActive
                      ? 'border-[#8B5CF6] bg-[#F3EEFF] dark:bg-[#1E193E] text-[#5B21B6] dark:text-white font-semibold'
                      : isDone
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-[#EEEAF9] dark:border-white/10 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="truncate">{step.label}</div>
                </div>
              );
            })}
          </div>

          {/* Error Banner with Preserved Progress Retry */}
          {liveState.error && (
            <div className="rounded-xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-sm text-rose-700 dark:text-rose-300">{liveState.error}</div>
              <div className="flex items-center gap-2 shrink-0">
                {liveState.partialEpisode && (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenEpisode(liveState.partialEpisode!, 'transcript')}
                      className="px-3.5 py-2 rounded-lg text-xs font-medium border border-rose-300 dark:border-white/20 text-[#18122B] dark:text-white bg-white dark:bg-[#111526]"
                    >
                      Open Saved Script
                    </button>
                    <button
                      type="button"
                      onClick={() => onRetryAudio(liveState.partialEpisode!)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#6D28D9] to-[#BE185D] text-white"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Audio Only
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Live Streamed Dialogue Preview */}
          {liveState.turns.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto pt-2 border-t border-[#EEEAF9] dark:border-white/10">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Live Script Stream ({liveState.turns.length} turns)
              </div>
              {liveState.turns.slice(-6).map((t) => (
                <div key={t.id} className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                  <span
                    className={`font-semibold mr-1.5 ${
                      t.speaker === 'Riya'
                        ? 'text-[#BE185D] dark:text-[#F472B6]'
                        : 'text-[#0E7490] dark:text-[#22D3EE]'
                    }`}
                  >
                    {t.speaker}:
                  </span>
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Recent Episodes */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-xl text-[#18122B] dark:text-white">
            Recent Studio Episodes
          </h2>
          <span className="text-xs font-mono-tabular text-slate-600 dark:text-slate-300">
            {recentEpisodes.length} saved
          </span>
        </div>

        {episodesLoading && recentEpisodes.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-pulse" aria-busy="true" aria-label="Loading saved episodes">
            <div className="h-32 rounded-2xl bg-[#EAE4F7] dark:bg-white/5" />
            <div className="h-32 rounded-2xl bg-[#EAE4F7] dark:bg-white/5 hidden md:block" />
            <div className="h-32 rounded-2xl bg-[#EAE4F7] dark:bg-white/5 hidden xl:block" />
          </div>
        ) : recentEpisodes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D8CFF2] dark:border-white/15 bg-white/60 dark:bg-[#111526]/60 p-8 text-center">
            <p className="text-sm font-medium text-[#18122B] dark:text-white">
              Your studio shelf is ready.
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Enter any one-line topic above to generate your first multilingual two-host podcast and 3D explainer.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recentEpisodes.slice(0, 6).map((ep) => (
              <div
                key={ep.id}
                className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-4 flex items-center gap-4 hover:border-[#8B5CF6] transition-colors"
              >
                <CoverArtwork episode={ep} size="md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                    {ep.plan.language} · {ep.plan.style} · {formatTime(ep.totalDurationSec)}
                  </div>
                  <h3 className="font-display font-semibold text-sm text-[#18122B] dark:text-white line-clamp-2">
                    {ep.plan.title}
                  </h3>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onOpenEpisode(ep, 'transcript')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#6D28D9] text-white hover:bg-[#5B21B6] transition-colors whitespace-nowrap"
                    >
                      <Play className="w-3 h-3" />
                      Listen
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenEpisode(ep, '3d')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[#E5DFF5] dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#22D3EE] transition-colors whitespace-nowrap"
                    >
                      3D Scene
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
