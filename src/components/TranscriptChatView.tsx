import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { apiJson } from '../lib/api';
import type { ChatMessage, CoverArtSpec, Episode } from '../types/podcast';
import { formatTime } from './AudioPlayerBar';
import { CoverArtwork } from './CoverArtwork';

const RIYA_AVATAR = '/src/assets/images/host_riya_avatar_1795597436232.jpg';
const ARJUN_AVATAR = '/src/assets/images/host_arjun_avatar_1795597437586.jpg';

interface TranscriptChatViewProps {
  episode: Episode;
  currentTimeSec: number;
  isPlaying: boolean;
  onSeekTo: (sec: number, autoPlay?: boolean) => void;
  onPlayingChange: (playing: boolean) => void;
  onEpisodeUpdate: (ep: Episode) => void;
  onRetryAudio: (ep: Episode) => void;
  isRetryingAudio: boolean;
  onOpen3D: () => void;
}

const SUGGESTED_QUESTIONS = [
  'Summarize this episode in 3 bullet points',
  'What are the key takeaways?',
  'Give me real-world examples from the discussion',
  'Explain the main concept more simply',
];

export const TranscriptChatView: React.FC<TranscriptChatViewProps> = ({
  episode,
  currentTimeSec,
  isPlaying,
  onSeekTo,
  onPlayingChange,
  onEpisodeUpdate,
  onRetryAudio,
  isRetryingAudio,
  onOpen3D,
}) => {
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [question, setQuestion] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  const activeTurnId = useMemo(() => {
    const match = episode.dialogue.find(
      (t) => currentTimeSec >= t.startTimeSec && currentTimeSec <= t.endTimeSec + 0.2
    );
    return match?.id || episode.dialogue[0]?.id;
  }, [episode.dialogue, currentTimeSec]);

  useEffect(() => {
    if (autoScroll && isPlaying && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeTurnId, autoScroll, isPlaying]);

  const handleCoverUpdate = async (coverSpec: CoverArtSpec, coverImageDataUrl: string) => {
    try {
      const res = await apiJson<{ episode: Episode }>(`/api/episodes/${episode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ coverSpec, coverImageDataUrl }),
      });
      onEpisodeUpdate(res.episode);
    } catch {
      onEpisodeUpdate({ ...episode, coverSpec, coverImageDataUrl });
    }
  };

  const handleAsk = async (qText?: string) => {
    const query = (qText ?? question).trim();
    if (!query || chatLoading) return;
    setChatError(null);
    setChatLoading(true);
    if (!qText) setQuestion('');

    try {
      const res = await apiJson<{
        userMsg: ChatMessage;
        assistantMsg: ChatMessage;
        episode: Episode;
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          episodeId: episode.id,
          question: query,
        }),
      });
      onEpisodeUpdate(res.episode);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to reach episode assistant.');
    } finally {
      setChatLoading(false);
    }
  };

  const chapterMap = useMemo(
    () => new Map(episode.plan.chapters.map((c) => [c.id, c])),
    [episode.plan.chapters]
  );

  let lastRenderedChapter = '';

  return (
    <div className="space-y-6">
      {/* Episode Overview Header */}
      <section className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <CoverArtwork
            episode={episode}
            size="lg"
            editable
            onUpdateSpec={handleCoverUpdate}
          />

          <div className="flex-1 min-w-0 space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-[#8B5CF6] dark:text-[#C4B5FD]">
                  {episode.plan.language}
                </span>
                <span aria-hidden="true">·</span>
                <span>{episode.plan.style}</span>
                <span aria-hidden="true">·</span>
                <span>{episode.plan.audienceLevel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {formatTime(episode.totalDurationSec)}
                </span>
              </div>

              <h1 className="font-display font-bold text-2xl sm:text-3xl text-[#18122B] dark:text-white mt-1.5 text-balance">
                {episode.plan.title}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                {episode.plan.subtitle}
              </p>
            </div>

            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {episode.plan.topicOverview}
            </p>

            {/* Primary Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onPlayingChange(!isPlaying)}
                disabled={episode.audioProvider === 'none'}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#8B5CF6] to-[#EC4899] text-white shadow-sm hover:opacity-95 disabled:opacity-40 transition-opacity whitespace-nowrap"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isPlaying ? 'Pause Episode' : 'Play Episode'}
              </button>

              <button
                type="button"
                onClick={onOpen3D}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#E2DAF5] dark:border-white/15 bg-[#F8F7FC] dark:bg-white/5 text-[#18122B] dark:text-white hover:border-[#22D3EE] transition-colors whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 text-[#22D3EE]" />
                Explore 3D Model
              </button>

              {episode.audioProvider !== 'gemini-tts' && (
                <button
                  type="button"
                  onClick={() => onRetryAudio(episode)}
                  disabled={isRetryingAudio}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#FB923C]/50 bg-[#FB923C]/10 text-[#C2410C] dark:text-[#FDBA74] hover:bg-[#FB923C]/20 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-4 h-4 ${isRetryingAudio ? 'animate-spin' : ''}`} />
                  {isRetryingAudio ? 'Synthesizing Studio Audio...' : 'Generate Studio AI Audio'}
                </button>
              )}
            </div>

            {/* Quality Control & Audio Provider Notice */}
            <div className="pt-3 border-t border-[#EEEAF9] dark:border-white/10 flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                {episode.qcReport.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
                <span>{episode.qcReport.languageNaturalnessNote}</span>
              </span>
              {episode.audioProvider === 'browser-fallback' && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  Using Browser Speech Synthesis Fallback — click "Generate Studio AI Audio" to synthesize Gemini WAV audio.
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Split: Synchronized Transcript (Left) + Grounded Host Q&A & Notes (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Transcript Column */}
        <section className="lg:col-span-7 rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EEEAF9] dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-lg text-[#18122B] dark:text-white">
                Synchronized Transcript
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click any line to seek directly to that moment
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                autoScroll
                  ? 'bg-[#8B5CF6]/10 border-[#8B5CF6]/40 text-[#6D28D9] dark:text-[#C4B5FD]'
                  : 'border-[#E2DAF5] dark:border-white/10 text-slate-600 dark:text-slate-300'
              }`}
            >
              Auto-scroll: {autoScroll ? 'On' : 'Off'}
            </button>
          </div>

          {/* Chapter Jump Strip */}
          {episode.plan.chapters.length > 0 && (
            <div className="px-5 py-2.5 bg-[#FAF8FF] dark:bg-[#0D1020] border-b border-[#EEEAF9] dark:border-white/10 flex items-center gap-2 overflow-x-auto">
              {episode.plan.chapters.map((ch, idx) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onSeekTo(ch.startTimeSec, true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-white/5 border border-[#E5DFF5] dark:border-white/10 hover:border-[#8B5CF6] text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
                >
                  {idx + 1}. {ch.title} · {formatTime(ch.startTimeSec)}
                </button>
              ))}
            </div>
          )}

          {/* Dialogue Turns */}
          <div className="p-4 sm:p-5 space-y-3 max-h-[620px] overflow-y-auto">
            {episode.dialogue.map((turn) => {
              const isActive = turn.id === activeTurnId;
              const isRiya = turn.speaker === 'Riya';
              const chapter = chapterMap.get(turn.chapterId);
              const showChapterHeader = chapter && turn.chapterId !== lastRenderedChapter;
              if (showChapterHeader) lastRenderedChapter = turn.chapterId;

              return (
                <React.Fragment key={turn.id}>
                  {showChapterHeader && chapter && (
                    <div className="pt-3 pb-1 flex items-center gap-2 text-xs font-semibold text-[#6D28D9] dark:text-[#C4B5FD]">
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>{chapter.title}</span>
                    </div>
                  )}

                  <div
                    ref={isActive ? activeLineRef : undefined}
                    onClick={() => onSeekTo(turn.startTimeSec, true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSeekTo(turn.startTimeSec, true);
                      }
                    }}
                    className={`group rounded-xl p-4 border cursor-pointer transition-all ${
                      isActive
                        ? 'bg-[#F3EEFF] dark:bg-[#1B1838] border-[#8B5CF6] shadow-sm'
                        : 'bg-[#FCFBFF] dark:bg-white/[0.02] border-[#EEEAF9] dark:border-white/5 hover:border-[#C4B5FD] dark:hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={isRiya ? RIYA_AVATAR : ARJUN_AVATAR}
                          alt={turn.speaker}
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded-full object-cover border border-white/20"
                        />
                        <span
                          className={`text-sm font-semibold ${
                            isRiya
                              ? 'text-[#DB2777] dark:text-[#F472B6]'
                              : 'text-[#0284C7] dark:text-[#22D3EE]'
                          }`}
                        >
                          {turn.speaker}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {turn.emotionCue}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                          {formatTime(turn.startTimeSec)}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 text-[#8B5CF6] transition-opacity">
                          {isActive && isPlaying ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </span>
                      </div>
                    </div>

                    <p className="text-[15px] leading-relaxed text-[#18122B] dark:text-slate-100">
                      {turn.text}
                    </p>
                  </div>
                </React.Fragment>
              );
            })}

            {episode.conclusion && (
              <div className="mt-4 pt-4 border-t border-[#EEEAF9] dark:border-white/10">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Episode Takeaway
                </div>
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {episode.conclusion}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Grounded Host Q&A + Key Facts */}
        <div className="lg:col-span-5 space-y-6">
          {/* Grounded Q&A */}
          <section className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EEEAF9] dark:border-white/10 flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-[#EC4899]" />
              <div>
                <h2 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
                  Ask About This Episode
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Answers grounded strictly in the generated episode and sources
                </p>
              </div>
            </div>

            <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
              {(episode.chatHistory || []).length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Try a quick question or ask anything Riya and Arjun discussed:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_QUESTIONS.map((sq) => (
                      <button
                        key={sq}
                        type="button"
                        onClick={() => handleAsk(sq)}
                        className="text-left text-xs px-3 py-2 rounded-lg border border-[#E5DFF5] dark:border-white/10 bg-[#FAF8FF] dark:bg-white/5 hover:border-[#8B5CF6] text-slate-700 dark:text-slate-200 transition-colors"
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                episode.chatHistory.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-xl p-3.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#8B5CF6]/10 text-[#18122B] dark:text-white ml-6'
                        : 'bg-[#F8F7FC] dark:bg-white/5 text-slate-700 dark:text-slate-200 mr-4 border border-[#EEEAF9] dark:border-white/10'
                    }`}
                  >
                    <div className="text-[11px] font-semibold mb-1 text-slate-500 dark:text-slate-400">
                      {msg.role === 'user' ? 'You' : 'Cozyland Episode Guide'}
                    </div>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))
              )}

              {chatError && (
                <p className="text-xs text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
                  {chatError}
                </p>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAsk();
              }}
              className="p-3 border-t border-[#EEEAF9] dark:border-white/10 flex items-center gap-2"
            >
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask Riya & Arjun about this episode..."
                className="flex-1 px-3.5 py-2 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white focus:outline-none focus:border-[#8B5CF6]"
              />
              <button
                type="submit"
                disabled={chatLoading || !question.trim()}
                className="inline-flex items-center justify-center p-2.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white disabled:opacity-40 hover:opacity-95 transition-opacity"
                aria-label="Send question"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </section>

          {/* Key Facts & Sources */}
          <section className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 space-y-4">
            <h3 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
              Episode Notes &amp; Sources
            </h3>
            {episode.plan.keyFacts.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-[#8B5CF6] dark:text-[#C4B5FD] mb-1.5">
                  Key Facts
                </div>
                <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                  {episode.plan.keyFacts.map((fact, idx) => (
                    <li key={idx}>{fact}</li>
                  ))}
                </ul>
              </div>
            )}

            {episode.plan.groundingUrls.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-[#22D3EE] mb-1.5">
                  Reference Sources
                </div>
                <div className="space-y-1.5">
                  {episode.plan.groundingUrls.map((g, idx) => (
                    <a
                      key={idx}
                      href={g.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-[#8B5CF6] truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{g.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
