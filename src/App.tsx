import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  FileText,
  Library,
  Menu,
  Mic2,
  Moon,
  PlusCircle,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { apiJson, streamSse } from './lib/api';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { LibraryView, SettingsView } from './components/LibrarySettingsViews';
import { type LiveGenerationState, StudioCreateView } from './components/StudioCreateView';
import { TranscriptChatView } from './components/TranscriptChatView';
import { VoiceStudioView } from './components/VoiceStudioView';
import type {
  Episode,
  HostVoiceConfig,
  PodcastDuration,
  PodcastLanguage,
  PodcastStyle,
  VoiceProfile,
} from './types/podcast';

const Explainer3D = lazy(() =>
  import('./components/Explainer3D').then((m) => ({ default: m.Explainer3D }))
);

type WorkspaceTab = 'studio' | 'transcript' | '3d' | 'voices' | 'library' | 'settings';

const DEFAULT_VOICE_CONFIG: { Riya: HostVoiceConfig; Arjun: HostVoiceConfig } = {
  Riya: {
    voiceName: 'Kore',
    speed: 1.0,
    expressiveness: 'Expressive',
    energy: 'Warm',
    deliveryStyle: 'Conversational',
  },
  Arjun: {
    voiceName: 'Puck',
    speed: 1.02,
    expressiveness: 'Expressive',
    energy: 'Upbeat',
    deliveryStyle: 'Conversational',
  },
};

const INITIAL_LIVE_STATE: LiveGenerationState = {
  isGenerating: false,
  stage: null,
  statusMessage: '',
  plan: null,
  turns: [],
  qcReport: null,
  scene3D: null,
  audioProgress: null,
  partialEpisode: null,
  error: null,
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('cozyland_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Ignore storage access errors
    }
    return 'dark';
  });

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [defaultLanguage, setDefaultLanguage] = useState<PodcastLanguage>(() => {
    try {
      return (localStorage.getItem('cozyland_default_lang') as PodcastLanguage) || 'English';
    } catch {
      return 'English';
    }
  });
  const [defaultDuration, setDefaultDuration] = useState<PodcastDuration>(() => {
    try {
      return (localStorage.getItem('cozyland_default_dur') as PodcastDuration) || 'short';
    } catch {
      return 'short';
    }
  });
  const [defaultStyle, setDefaultStyle] = useState<PodcastStyle>(() => {
    try {
      return (localStorage.getItem('cozyland_default_style') as PodcastStyle) || 'Conversational';
    } catch {
      return 'Conversational';
    }
  });

  const [voiceConfig, setVoiceConfig] = useState<{ Riya: HostVoiceConfig; Arjun: HostVoiceConfig }>(() => {
    try {
      const raw = localStorage.getItem('cozyland_voice_config');
      if (raw) return JSON.parse(raw);
    } catch {
      // Ignore
    }
    return DEFAULT_VOICE_CONFIG;
  });

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);

  const [currentEpisodeId, setCurrentEpisodeId] = useState<string | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [seekTargetSec, setSeekTargetSec] = useState<number | null>(null);

  const [liveState, setLiveState] = useState<LiveGenerationState>(INITIAL_LIVE_STATE);
  const [isRetryingAudio, setIsRetryingAudio] = useState(false);
  const generationAbortRef = useRef<AbortController | null>(null);

  // Sync theme to document root & localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('cozyland_theme', theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('cozyland_default_lang', defaultLanguage);
      localStorage.setItem('cozyland_default_dur', defaultDuration);
      localStorage.setItem('cozyland_default_style', defaultStyle);
      localStorage.setItem('cozyland_voice_config', JSON.stringify(voiceConfig));
    } catch {
      // Ignore
    }
  }, [defaultLanguage, defaultDuration, defaultStyle, voiceConfig]);

  // Initial data load
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [epRes, profRes] = await Promise.all([
          apiJson<{ episodes: Episode[] }>('/api/episodes'),
          apiJson<{ profiles: VoiceProfile[] }>('/api/voice/profiles'),
        ]);
        if (!active) return;
        setEpisodes(epRes.episodes || []);
        setVoiceProfiles(profRes.profiles || []);
        if (epRes.episodes?.length > 0) {
          setCurrentEpisodeId(epRes.episodes[0].id);
        }
      } catch (err) {
        if (active) {
          setInitialError(err instanceof Error ? err.message : 'Unable to connect to Cozyland backend.');
        }
      } finally {
        if (active) setInitialLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const currentEpisode = useMemo(
    () => episodes.find((e) => e.id === currentEpisodeId) || null,
    [episodes, currentEpisodeId]
  );

  const activeChapterId = useMemo(() => {
    if (!currentEpisode) return undefined;
    const turn = currentEpisode.dialogue.find(
      (t) => currentTimeSec >= t.startTimeSec && currentTimeSec <= t.endTimeSec + 0.25
    );
    return turn?.chapterId || currentEpisode.plan.chapters[0]?.id;
  }, [currentEpisode, currentTimeSec]);

  const upsertEpisode = useCallback((ep: Episode) => {
    setEpisodes((prev) => [ep, ...prev.filter((item) => item.id !== ep.id)]);
    setCurrentEpisodeId(ep.id);
  }, []);

  const handleSeekTo = useCallback((sec: number, autoPlay = false) => {
    setSeekTargetSec(sec);
    setCurrentTimeSec(sec);
    if (autoPlay) setIsPlaying(true);
  }, []);

  const runAudioStage = useCallback(
    async (episodeShell: Episode, signal: AbortSignal) => {
      let finalizedEpisode: Episode = episodeShell;
      await streamSse(
        '/api/stage-d-stream',
        {
          episodeId: episodeShell.id,
          language: episodeShell.plan.language,
          turns: episodeShell.dialogue.map((t) => ({
            id: t.id,
            index: t.index,
            speaker: t.speaker,
            text: t.text,
            chapterId: t.chapterId,
            emotionCue: t.emotionCue,
          })),
          voiceConfig: episodeShell.voiceConfig,
        },
        (evt) => {
          if (evt.type === 'stage' || evt.type === 'audio_progress') {
            setLiveState((prev) => ({
              ...prev,
              stage: evt.stage || 'audio_hosts',
              statusMessage: evt.message || prev.statusMessage,
              audioProgress:
                typeof evt.completedSegments === 'number' && typeof evt.totalSegments === 'number'
                  ? { completed: evt.completedSegments, total: evt.totalSegments }
                  : prev.audioProgress,
            }));
          } else if (evt.type === 'done' && evt.episode) {
            finalizedEpisode = evt.episode;
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'Audio generation failed.');
          }
        },
        { timeoutMs: 240000, signal }
      );
      return finalizedEpisode;
    },
    []
  );

  const handleGenerate = async (params: {
    topicInput: string;
    referenceUrl: string;
    language: PodcastLanguage;
    duration: PodcastDuration;
    style: PodcastStyle;
  }) => {
    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;

    setIsPlaying(false);
    setCurrentTimeSec(0);
    setLiveState({
      ...INITIAL_LIVE_STATE,
      isGenerating: true,
      stage: 'understanding',
      statusMessage: 'Connecting to Cozyland AI pipeline...',
    });

    let stageBEpisode: Episode | null = null;

    try {
      await streamSse(
        '/api/stage-b-stream',
        {
          ...params,
          voiceConfig,
        },
        (evt) => {
          if (evt.type === 'stage') {
            setLiveState((prev) => ({
              ...prev,
              stage: evt.stage || prev.stage,
              statusMessage: evt.message || prev.statusMessage,
              plan: evt.plan || prev.plan,
            }));
          } else if (evt.type === 'plan' && evt.plan) {
            setLiveState((prev) => ({ ...prev, plan: evt.plan! }));
          } else if (evt.type === 'dialogue_line' && evt.turn) {
            setLiveState((prev) => ({
              ...prev,
              turns: [...prev.turns.filter((t) => t.id !== evt.turn!.id), evt.turn!],
            }));
          } else if (evt.type === 'qc_report') {
            setLiveState((prev) => ({
              ...prev,
              qcReport: evt.qcReport || prev.qcReport,
              turns: evt.turns || prev.turns,
            }));
          } else if (evt.type === 'visualization' && evt.scene3D) {
            setLiveState((prev) => ({ ...prev, scene3D: evt.scene3D! }));
          } else if (evt.type === 'done' && evt.episode) {
            stageBEpisode = evt.episode;
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'Script generation failed.');
          }
        },
        { timeoutMs: 180000, signal: controller.signal }
      );

      if (!stageBEpisode) {
        throw new Error('Episode script generation did not complete.');
      }

      // Preserve script & 3D scene immediately before Stage D audio synthesis
      upsertEpisode(stageBEpisode);
      setLiveState((prev) => ({
        ...prev,
        partialEpisode: stageBEpisode,
        stage: 'audio_hosts',
        statusMessage: 'Synthesizing host speech for Riya and Arjun...',
      }));

      const finalEpisode = await runAudioStage(stageBEpisode, controller.signal);
      upsertEpisode(finalEpisode);

      setLiveState((prev) => ({
        ...prev,
        isGenerating: false,
        stage: 'finalizing',
        statusMessage: 'Podcast episode and 3D explainer ready!',
        partialEpisode: finalEpisode,
      }));
      setActiveTab('transcript');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation interrupted.';
      setLiveState((prev) => ({
        ...prev,
        isGenerating: false,
        error: msg,
        partialEpisode: stageBEpisode || prev.partialEpisode,
      }));
    }
  };

  const handleCancelGeneration = () => {
    generationAbortRef.current?.abort();
    setLiveState((prev) => ({
      ...prev,
      isGenerating: false,
      statusMessage: 'Generation cancelled.',
      error: prev.partialEpisode
        ? 'Audio generation cancelled. Your generated script and 3D model were preserved.'
        : 'Generation cancelled.',
    }));
  };

  const handleRetryAudio = async (ep: Episode) => {
    if (isRetryingAudio || liveState.isGenerating) return;
    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;

    setIsRetryingAudio(true);
    setLiveState((prev) => ({
      ...prev,
      isGenerating: true,
      error: null,
      stage: 'audio_hosts',
      statusMessage: `Retrying speech synthesis for "${ep.plan.title}"...`,
      partialEpisode: ep,
    }));

    try {
      const updated = await runAudioStage({ ...ep, voiceConfig }, controller.signal);
      upsertEpisode(updated);
      setLiveState((prev) => ({
        ...prev,
        isGenerating: false,
        stage: 'finalizing',
        statusMessage: 'Audio synthesis completed!',
        partialEpisode: updated,
      }));
    } catch (err) {
      setLiveState((prev) => ({
        ...prev,
        isGenerating: false,
        error: err instanceof Error ? err.message : 'Retry failed.',
      }));
    } finally {
      setIsRetryingAudio(false);
    }
  };

  const handleOpenEpisode = (ep: Episode, tab: 'transcript' | '3d' = 'transcript') => {
    setCurrentEpisodeId(ep.id);
    setCurrentTimeSec(0);
    setIsPlaying(false);
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const navItems: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
    { id: 'studio', label: 'Studio', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'transcript', label: 'Transcript', icon: <FileText className="w-4 h-4" /> },
    { id: '3d', label: '3D Explainer', icon: <Box className="w-4 h-4" /> },
    { id: 'voices', label: 'Voice Studio', icon: <Mic2 className="w-4 h-4" /> },
    { id: 'library', label: 'Library', icon: <Library className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7FC] text-[#18122B] dark:bg-[#090B14] dark:text-[#F5F3FF] transition-colors">
      {/* Top Bar (Strict 3-zone contract: Wordmark — Nav Links — Primary Action) */}
      <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 border-b border-[#E5DFF5] dark:border-white/10 bg-white/95 dark:bg-[#0D1020]/95 backdrop-blur-md flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-[#F3EEFF] dark:hover:bg-white/10"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className="font-display font-bold text-xl tracking-tight bg-gradient-to-r from-[#6D28D9] via-[#EC4899] to-[#22D3EE] bg-clip-text text-transparent whitespace-nowrap shrink-0"
          >
            Cozyland
          </button>
        </div>

        {/* Zone 2: Clean Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          {navItems.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeTab === item.id
                  ? 'border-[#8B5CF6] text-[#6D28D9] dark:text-white font-semibold'
                  : 'border-transparent hover:text-[#18122B] dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="p-2 rounded-xl border border-[#E5DFF5] dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-[#8B5CF6] transition-colors"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-[#FB923C]" /> : <Moon className="w-4 h-4 text-[#6D28D9]" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white hover:opacity-95 transition-opacity whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Create Episode
          </button>
        </div>
      </header>

      {/* Main Body: Responsive Sidebar + Content */}
      <div className="flex-1 flex min-w-0">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#0D1020] p-4 justify-between">
          <div className="space-y-1">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#F3EEFF] dark:bg-[#1E193E] text-[#6D28D9] dark:text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-[#F8F7FC] dark:hover:bg-white/5 hover:text-[#18122B] dark:hover:text-white'
                  }`}
                >
                  <span className={active ? 'text-[#8B5CF6] dark:text-[#22D3EE]' : ''}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {currentEpisode && (
            <div className="rounded-xl border border-[#E5DFF5] dark:border-white/10 bg-[#FAF8FF] dark:bg-white/[0.03] p-3.5 space-y-1.5">
              <div className="text-[11px] font-medium text-[#8B5CF6] dark:text-[#C4B5FD]">
                Active Episode
              </div>
              <div className="font-display font-semibold text-xs text-[#18122B] dark:text-white line-clamp-2">
                {currentEpisode.plan.title}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {currentEpisode.plan.language} · {currentEpisode.dialogue.length} turns
              </div>
            </div>
          )}
        </aside>

        {/* Mobile Drawer Navigation */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <nav className="relative z-50 w-64 bg-white dark:bg-[#0D1020] border-r border-[#E5DFF5] dark:border-white/10 p-4 space-y-1.5">
              <div className="font-display font-bold text-lg text-[#6D28D9] dark:text-white px-3 py-2">
                Cozyland Studio
              </div>
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium ${
                    activeTab === item.id
                      ? 'bg-[#F3EEFF] dark:bg-[#1E193E] text-[#6D28D9] dark:text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Primary Workspace Viewport */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {initialError && (
            <div className="mb-6 rounded-xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {initialError}
            </div>
          )}

          {initialLoading ? (
            <div className="space-y-6 animate-pulse">
              <div className="h-52 rounded-2xl bg-[#EAE4F7] dark:bg-white/5" />
              <div className="h-64 rounded-2xl bg-[#EAE4F7] dark:bg-white/5" />
            </div>
          ) : (
            <>
              {activeTab === 'studio' && (
                <StudioCreateView
                  defaultLanguage={defaultLanguage}
                  defaultDuration={defaultDuration}
                  defaultStyle={defaultStyle}
                  liveState={liveState}
                  recentEpisodes={episodes}
                  onGenerate={handleGenerate}
                  onCancelGeneration={handleCancelGeneration}
                  onRetryAudio={handleRetryAudio}
                  onOpenEpisode={handleOpenEpisode}
                />
              )}

              {activeTab === 'transcript' && (
                currentEpisode ? (
                  <TranscriptChatView
                    episode={currentEpisode}
                    currentTimeSec={currentTimeSec}
                    isPlaying={isPlaying}
                    onSeekTo={handleSeekTo}
                    onPlayingChange={setIsPlaying}
                    onEpisodeUpdate={upsertEpisode}
                    onRetryAudio={handleRetryAudio}
                    isRetryingAudio={isRetryingAudio}
                    onOpen3D={() => setActiveTab('3d')}
                  />
                ) : (
                  <EmptyEpisodeNotice onGoStudio={() => setActiveTab('studio')} />
                )
              )}

              {activeTab === '3d' && (
                currentEpisode ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h1 className="font-display font-bold text-2xl text-[#18122B] dark:text-white">
                          Interactive 3D Explainer
                        </h1>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          Click any 3D concept node, drag to orbit, scroll to zoom, or jump straight to its chapter audio.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('transcript')}
                        className="px-4 py-2 rounded-xl text-xs font-semibold border border-[#E5DFF5] dark:border-white/15 bg-white dark:bg-[#111526] hover:border-[#8B5CF6] whitespace-nowrap"
                      >
                        Back to Transcript
                      </button>
                    </div>
                    <Suspense
                      fallback={
                        <div className="h-[640px] rounded-2xl bg-[#0B0E1D] flex items-center justify-center text-sm text-slate-300">
                          Initializing 3D Explainer Viewport...
                        </div>
                      }
                    >
                      <Explainer3D
                        episode={currentEpisode}
                        activeChapterId={activeChapterId}
                        onJumpToChapter={(chId) => {
                          const ch = currentEpisode.plan.chapters.find((c) => c.id === chId);
                          if (ch) {
                            handleSeekTo(ch.startTimeSec, true);
                            setActiveTab('transcript');
                          }
                        }}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <EmptyEpisodeNotice onGoStudio={() => setActiveTab('studio')} />
                )
              )}

              {activeTab === 'voices' && (
                <VoiceStudioView
                  voiceConfig={voiceConfig}
                  onVoiceConfigChange={setVoiceConfig}
                  profiles={voiceProfiles}
                  onProfilesChange={setVoiceProfiles}
                  defaultLanguage={defaultLanguage}
                />
              )}

              {activeTab === 'library' && (
                <LibraryView
                  episodes={episodes}
                  onOpenEpisode={handleOpenEpisode}
                  onEpisodeUpdated={upsertEpisode}
                  onEpisodeDeleted={(id) => {
                    setEpisodes((prev) => prev.filter((e) => e.id !== id));
                    if (currentEpisodeId === id) {
                      setIsPlaying(false);
                      setCurrentEpisodeId(null);
                    }
                  }}
                  onGoCreate={() => setActiveTab('studio')}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  theme={theme}
                  onThemeChange={setTheme}
                  defaultLanguage={defaultLanguage}
                  onDefaultLanguageChange={setDefaultLanguage}
                  defaultDuration={defaultDuration}
                  onDefaultDurationChange={setDefaultDuration}
                  defaultStyle={defaultStyle}
                  onDefaultStyleChange={setDefaultStyle}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Persistent Bottom Audio Player */}
      {currentEpisode && (
        <AudioPlayerBar
          episode={currentEpisode}
          currentTimeSec={currentTimeSec}
          isPlaying={isPlaying}
          seekTargetSec={seekTargetSec}
          onClearSeekTarget={() => setSeekTargetSec(null)}
          onTimeUpdate={setCurrentTimeSec}
          onPlayingChange={setIsPlaying}
          onSeekTo={handleSeekTo}
          onOpenTranscript={() => setActiveTab('transcript')}
        />
      )}
    </div>
  );
}

const EmptyEpisodeNotice: React.FC<{ onGoStudio: () => void }> = ({ onGoStudio }) => (
  <div className="rounded-2xl border border-dashed border-[#D8CFF2] dark:border-white/15 bg-white dark:bg-[#111526] p-12 text-center space-y-3">
    <h2 className="font-display font-bold text-xl text-[#18122B] dark:text-white">
      No episode selected yet
    </h2>
    <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
      Generate a podcast from a single line in the Studio or pick a saved episode from your Library.
    </p>
    <button
      type="button"
      onClick={onGoStudio}
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#8B5CF6] to-[#EC4899] text-white"
    >
      <Sparkles className="w-4 h-4" />
      Go to Studio
    </button>
  </div>
);
