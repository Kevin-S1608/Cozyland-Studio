import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { DialogueTurn, Episode } from '../types/podcast';
import { formatTime } from '../lib/format';
import { CoverArtwork } from './CoverArtwork';
import RIYA_AVATAR from '../assets/images/host_riya_avatar_160.webp';
import ARJUN_AVATAR from '../assets/images/host_arjun_avatar_160.webp';

export { formatTime };

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

interface AudioPlayerBarProps {
  episode: Episode;
  currentTimeSec: number;
  isPlaying: boolean;
  seekTargetSec: number | null;
  onClearSeekTarget: () => void;
  onTimeUpdate: (sec: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSeekTo: (sec: number, autoPlay?: boolean) => void;
  onOpenTranscript: () => void;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  episode,
  currentTimeSec,
  isPlaying,
  seekTargetSec,
  onClearSeekTarget,
  onTimeUpdate,
  onPlayingChange,
  onSeekTo,
  onOpenTranscript,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const connectedElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  const [duration, setDuration] = useState<number>(episode.totalDurationSec || 0);
  const [volume, setVolume] = useState<number>(0.9);
  const [muted, setMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [audioError, setAudioError] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const isRealAudio = episode.audioProvider === 'gemini-tts' && Boolean(episode.audioUrl);

  const activeTurn: DialogueTurn | undefined = useMemo(() => {
    if (!episode.dialogue.length) return undefined;
    return (
      episode.dialogue.find(
        (t) => currentTimeSec >= t.startTimeSec && currentTimeSec <= t.endTimeSec + 0.25
      ) || episode.dialogue[0]
    );
  }, [episode.dialogue, currentTimeSec]);

  const currentChapterIndex = useMemo(() => {
    if (!episode.plan.chapters.length) return 0;
    const idx = episode.plan.chapters.findIndex(
      (ch) => currentTimeSec >= ch.startTimeSec && currentTimeSec <= ch.endTimeSec + 0.5
    );
    return idx >= 0 ? idx : 0;
  }, [episode.plan.chapters, currentTimeSec]);

  useEffect(() => {
    setDuration(episode.totalDurationSec || 0);
    setAudioError(null);
  }, [episode.id, episode.totalDurationSec, episode.audioUrl]);

  // Connect Web Audio API AnalyserNode cleanly once per audio DOM element
  const ensureWebAudioAnalyser = () => {
    const audioEl = audioRef.current;
    if (!audioEl || connectedElRef.current === audioEl) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current && audioCtxRef.current.state !== 'closed' ? audioCtxRef.current : new Ctx();
      let analyser = analyserRef.current;
      if (!analyser || audioCtxRef.current !== ctx) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;
        analyser.connect(ctx.destination);
      }
      const source = ctx.createMediaElementSource(audioEl);
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      connectedElRef.current = audioEl;
    } catch {
      // If Web Audio API is blocked, audio element still plays natively
    }
  };

  // Handle seek requests from transcript or chapters (deferred safely when preload="none")
  useEffect(() => {
    if (seekTargetSec === null) return;
    if (isRealAudio && audioRef.current) {
      const clamped = Math.max(0, Math.min(seekTargetSec, duration || 9999));
      if (audioRef.current.readyState >= 1) {
        audioRef.current.currentTime = clamped;
        pendingSeekRef.current = null;
      } else {
        pendingSeekRef.current = clamped;
      }
    }
    onTimeUpdate(seekTargetSec);
    onClearSeekTarget();
  }, [seekTargetSec, isRealAudio, duration, onTimeUpdate, onClearSeekTarget]);

  // Sync play/pause state with real <audio> element
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!isRealAudio || !audioEl) return;

    audioEl.playbackRate = playbackRate;
    audioEl.volume = muted ? 0 : volume;

    if (isPlaying) {
      ensureWebAudioAnalyser();
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => undefined);
      }
      audioEl.play().catch((err) => {
        setAudioError(err instanceof Error ? err.message : 'Playback blocked by browser.');
        onPlayingChange(false);
      });
    } else {
      audioEl.pause();
    }
  }, [isPlaying, isRealAudio, playbackRate, volume, muted, episode.audioUrl]);

  // Browser Speech Synthesis fallback ONLY when episode.audioProvider === 'browser-fallback'
  useEffect(() => {
    if (isRealAudio) return;
    if (fallbackTimerRef.current) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (!isPlaying) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      return;
    }

    const turns = episode.dialogue;
    const startTurn =
      turns.find((t) => currentTimeSec >= t.startTimeSec && currentTimeSec < t.endTimeSec) ||
      turns[0];

    if ('speechSynthesis' in window && startTurn) {
      window.speechSynthesis.cancel();
      const idxStart = Math.max(0, turns.indexOf(startTurn));
      const speakFrom = (idx: number) => {
        if (idx >= turns.length) {
          onPlayingChange(false);
          return;
        }
        const turn = turns[idx];
        onTimeUpdate(turn.startTimeSec);
        const utter = new SpeechSynthesisUtterance(turn.text);
        utter.rate = playbackRate;
        utter.pitch = turn.speaker === 'Riya' ? 1.12 : 0.92;
        utter.volume = muted ? 0 : volume;
        utter.onend = () => {
          if (isPlaying) speakFrom(idx + 1);
        };
        window.speechSynthesis.speak(utter);
      };
      speakFrom(idxStart);
    }

    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [isPlaying, isRealAudio, episode.id, playbackRate, muted, volume]);

  // Real Audio Waveform Canvas Visualizer driven by AnalyserNode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bars = 28;
    const freqData = new Uint8Array(32);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (analyserRef.current && isPlaying && isRealAudio) {
        analyserRef.current.getByteFrequencyData(freqData);
      } else {
        freqData.fill(0);
      }

      const barW = Math.max(2, Math.floor((w - (bars - 1) * 2) / bars));
      for (let i = 0; i < bars; i++) {
        const val = analyserRef.current && isPlaying && isRealAudio ? freqData[i % freqData.length] : 0;
        const norm = val / 255;
        const barH = Math.max(3, Math.round(norm * (h - 4)));
        const x = i * (barW + 2);
        const y = Math.round((h - barH) / 2);

        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, '#22D3EE');
        grad.addColorStop(1, '#8B5CF6');
        ctx.fillStyle = isPlaying ? grad : 'rgba(139, 92, 246, 0.25)';
        ctx.fillRect(x, y, barW, barH);
      }

      if (isPlaying) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, isRealAudio]);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  const handlePrevChapter = () => {
    const chapters = episode.plan.chapters;
    if (!chapters.length) return;
    const targetIdx = Math.max(0, currentChapterIndex - 1);
    onSeekTo(chapters[targetIdx].startTimeSec, true);
  };

  const handleNextChapter = () => {
    const chapters = episode.plan.chapters;
    if (!chapters.length) return;
    const targetIdx = Math.min(chapters.length - 1, currentChapterIndex + 1);
    onSeekTo(chapters[targetIdx].startTimeSec, true);
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(playbackRate);
    setPlaybackRate(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const speaker = activeTurn?.speaker || 'Riya';
  const totalSec = duration || episode.totalDurationSec || 1;

  return (
    <div
      role="region"
      aria-label="Podcast audio player"
      className="sticky bottom-0 z-30 border-t border-[#E5DFF5] dark:border-white/10 bg-white/95 dark:bg-[#0D1020]/95 backdrop-blur-md px-4 py-2.5 shadow-lg"
    >
      {isRealAudio && episode.audioUrl && (
        <audio
          ref={audioRef}
          src={episode.audioUrl}
          preload="none"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
            if (pendingSeekRef.current !== null) {
              e.currentTarget.currentTime = Math.min(pendingSeekRef.current, d || 9999);
              pendingSeekRef.current = null;
            }
          }}
          onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
          onEnded={() => onPlayingChange(false)}
          onError={() => setAudioError('Unable to load episode WAV audio stream.')}
        />
      )}

      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center gap-3">
        {/* Left: Cover + Active Host + Title */}
        <div className="flex items-center gap-3 min-w-0 lg:w-72 shrink-0">
          <button
            type="button"
            onClick={onOpenTranscript}
            className="shrink-0 focus-visible:outline-2 focus-visible:outline-[#8B5CF6] rounded-lg"
            title="Open transcript & player"
          >
            <CoverArtwork episode={episode} size="sm" />
          </button>

          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onOpenTranscript}
              className="text-left font-display font-semibold text-sm text-[#18122B] dark:text-white truncate block w-full hover:text-[#6D28D9] dark:hover:text-[#C4B5FD] transition-colors"
            >
              {episode.plan.title}
            </button>
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              <img
                src={speaker === 'Riya' ? RIYA_AVATAR : ARJUN_AVATAR}
                alt={speaker}
                width={16}
                height={16}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-4 h-4 rounded-full object-cover"
              />
              <span className={speaker === 'Riya' ? 'text-[#BE185D] dark:text-[#F472B6] font-medium' : 'text-[#0E7490] dark:text-[#22D3EE] font-medium'}>
                {speaker}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {episode.audioProvider === 'browser-fallback'
                  ? 'Browser Speech Fallback'
                  : episode.plan.language}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Controls + Scrubber + Real Waveform */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handlePrevChapter}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-[#F1ECFA] dark:hover:bg-white/10 transition-colors"
              aria-label="Previous chapter"
              title="Previous chapter"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onPlayingChange(!isPlaying)}
              disabled={episode.audioProvider === 'none'}
              className="w-10 h-10 rounded-full bg-gradient-to-r from-[#6D28D9] to-[#BE185D] text-white flex items-center justify-center shadow-md hover:opacity-95 disabled:opacity-40 transition-opacity"
              aria-label={isPlaying ? 'Pause episode' : 'Play episode'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={handleNextChapter}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-[#F1ECFA] dark:hover:bg-white/10 transition-colors"
              aria-label="Next chapter"
              title="Next chapter"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Real Web Audio AnalyserNode Waveform */}
            <canvas
              ref={canvasRef}
              width={132}
              height={26}
              className="hidden sm:block rounded bg-[#F5F2FC] dark:bg-white/5 px-1"
              aria-label="Live audio frequency waveform"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <span className="font-mono-tabular text-[11px] text-slate-600 dark:text-slate-300 w-10 text-right shrink-0">
              {formatTime(currentTimeSec)}
            </span>
            <input
              type="range"
              min={0}
              max={totalSec}
              step={0.1}
              value={Math.min(currentTimeSec, totalSec)}
              onChange={(e) => onSeekTo(Number(e.target.value), isPlaying)}
              aria-label="Seek episode timeline"
              className="w-full h-1.5 accent-[#8B5CF6] cursor-pointer"
            />
            <span className="font-mono-tabular text-[11px] text-slate-600 dark:text-slate-300 w-10 shrink-0">
              {formatTime(duration)}
            </span>
          </div>
          {audioError && <p className="text-[11px] text-rose-600 dark:text-rose-400 text-center">{audioError}</p>}
        </div>

        {/* Right: Speed, Volume, Download */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={cycleSpeed}
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono-tabular font-medium border border-[#E5DFF5] dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#8B5CF6] transition-colors whitespace-nowrap"
            title="Change playback speed"
          >
            {playbackRate}x
          </button>

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-[#F1ECFA] dark:hover:bg-white/10 transition-colors"
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          >
            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setMuted(false);
              setVolume(Number(e.target.value));
            }}
            aria-label="Audio volume"
            className="w-20 h-1.5 accent-[#22D3EE] cursor-pointer"
          />

          {isRealAudio && episode.audioUrl && (
            <a
              href={`${episode.audioUrl}?download=1`}
              download={`cozyland-${episode.id}.wav`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[#E5DFF5] dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#22D3EE] transition-colors whitespace-nowrap"
              title="Download episode WAV audio"
            >
              <Download className="w-3.5 h-3.5 text-[#0E7490] dark:text-[#22D3EE]" />
              WAV
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
