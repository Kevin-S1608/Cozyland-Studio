import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Mic,
  Play,
  Save,
  ShieldCheck,
  Sliders,
  Square,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import { apiJson } from '../lib/api';
import {
  type EnergyLevel,
  type ExpressivenessLevel,
  GEMINI_VOICE_CATALOG,
  type HostVoiceConfig,
  type PodcastLanguage,
  SUPPORTED_LANGUAGES,
  type VoiceDeliveryStyle,
  type VoiceProfile,
} from '../types/podcast';
import RIYA_AVATAR from '../assets/images/host_riya_avatar_160.webp';
import ARJUN_AVATAR from '../assets/images/host_arjun_avatar_160.webp';

const EXPRESSIVENESS_OPTIONS: ExpressivenessLevel[] = ['Calm', 'Balanced', 'Expressive', 'Dramatic'];
const ENERGY_OPTIONS: EnergyLevel[] = ['Relaxed', 'Warm', 'Upbeat', 'High-Energy'];
const DELIVERY_STYLES: VoiceDeliveryStyle[] = [
  'Conversational',
  'Storyteller',
  'Journalist',
  'Educator',
  'Tech Analyst',
];

interface VoiceStudioViewProps {
  voiceConfig: { Riya: HostVoiceConfig; Arjun: HostVoiceConfig };
  onVoiceConfigChange: (next: { Riya: HostVoiceConfig; Arjun: HostVoiceConfig }) => void;
  profiles: VoiceProfile[];
  onProfilesChange: (profiles: VoiceProfile[]) => void;
  defaultLanguage: PodcastLanguage;
}

export const VoiceStudioView: React.FC<VoiceStudioViewProps> = ({
  voiceConfig,
  onVoiceConfigChange,
  profiles,
  onProfilesChange,
  defaultLanguage,
}) => {
  const [previewLang, setPreviewLang] = useState<PodcastLanguage>(defaultLanguage);
  const [previewingHost, setPreviewingHost] = useState<'Riya' | 'Arjun' | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [presetName, setPresetName] = useState<string>('');
  const [presetHost, setPresetHost] = useState<'Riya' | 'Arjun'>('Riya');
  const [savingPreset, setSavingPreset] = useState<boolean>(false);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);

  // Authorized Custom Voice Calibration state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sampleObjectUrl, setSampleObjectUrl] = useState<string | null>(null);
  const [sampleDurationSec, setSampleDurationSec] = useState<number>(0);
  const [importHost, setImportHost] = useState<'Riya' | 'Arjun'>('Riya');
  const [importProfileName, setImportProfileName] = useState<string>('');
  const [consentConfirmed, setConsentConfirmed] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<{
    transcript: string;
    note: string;
    profile: VoiceProfile;
  } | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const updateHost = (host: 'Riya' | 'Arjun', patch: Partial<HostVoiceConfig>) => {
    onVoiceConfigChange({
      ...voiceConfig,
      [host]: { ...voiceConfig[host], ...patch },
    });
  };

  const handlePreviewVoice = async (
    speaker: 'Riya' | 'Arjun',
    configOverride?: HostVoiceConfig
  ) => {
    setPreviewError(null);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    if (previewingHost === speaker) {
      setPreviewingHost(null);
      return;
    }

    setPreviewingHost(speaker);
    try {
      const res = await apiJson<{ audioBase64: string; mimeType: string }>('/api/voice/preview', {
        method: 'POST',
        body: JSON.stringify({
          speaker,
          language: previewLang,
          voiceConfig: configOverride || voiceConfig[speaker],
        }),
      });
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewingHost(null);
      audio.onerror = () => {
        setPreviewingHost(null);
        setPreviewError('Browser could not play the preview WAV audio.');
      };
      await audio.play();
    } catch (err) {
      setPreviewingHost(null);
      setPreviewError(err instanceof Error ? err.message : 'Preview failed.');
    }
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetName.trim()) return;
    setSavingPreset(true);
    setPresetMessage(null);
    try {
      const res = await apiJson<{ profile: VoiceProfile }>('/api/voice/profile', {
        method: 'POST',
        body: JSON.stringify({
          name: presetName.trim(),
          assignedHost: presetHost,
          config: voiceConfig[presetHost],
          isCustomCalibrated: false,
        }),
      });
      onProfilesChange([res.profile, ...profiles.filter((p) => p.id !== res.profile.id)]);
      setPresetName('');
      setPresetMessage(`Saved "${res.profile.name}" for ${presetHost}.`);
    } catch (err) {
      setPresetMessage(err instanceof Error ? err.message : 'Failed to save preset.');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['wav', 'mp3', 'm4a', 'flac', 'webm', 'ogg'].includes(ext)) {
      setImportError('Unsupported file format. Choose a WAV, MP3, M4A, or FLAC recording.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImportError('File is larger than 10 MB. Upload a concise 5–30 second sample.');
      return;
    }

    if (sampleObjectUrl) URL.revokeObjectURL(sampleObjectUrl);
    const objUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setSampleObjectUrl(objUrl);

    const probe = new Audio(objUrl);
    probe.onloadedmetadata = () => {
      setSampleDurationSec(Number.isFinite(probe.duration) ? Number(probe.duration.toFixed(1)) : 0);
    };
  };

  const handleCalibrateImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setImportError('Please select an audio file first.');
      return;
    }
    if (!consentConfirmed) {
      setImportError('You must confirm voice authorization consent before uploading.');
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const form = new FormData();
      form.append('audio', selectedFile);
      form.append('assignedHost', importHost);
      form.append('profileName', importProfileName.trim() || `${importHost} Calibrated Voice`);
      form.append('consentConfirmed', 'true');
      form.append('durationSec', String(sampleDurationSec));

      const res = await apiJson<{
        profile: VoiceProfile;
        transcript: string;
        cloningCapabilityNote: string;
      }>('/api/voice/import', {
        method: 'POST',
        body: form,
        timeoutMs: 60000,
      });

      onProfilesChange([res.profile, ...profiles.filter((p) => p.id !== res.profile.id)]);
      updateHost(importHost, res.profile.config);
      setImportSuccess({
        transcript: res.transcript,
        note: res.cloningCapabilityNote,
        profile: res.profile,
      });
      setImportProfileName('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to analyze voice recording.');
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await apiJson(`/api/voice/profile/${id}`, { method: 'DELETE' });
      onProfilesChange(profiles.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Could not delete profile.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#18122B] dark:text-white">
            Voice Studio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            Configure Riya and Arjun using Gemini&apos;s verified studio voices, preview in 14 languages, and save reusable presets.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="preview-lang" className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Preview language
          </label>
          <select
            id="preview-lang"
            value={previewLang}
            onChange={(e) => setPreviewLang(e.target.value as PodcastLanguage)}
            className="px-3 py-2 rounded-xl text-sm bg-white dark:bg-[#111526] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
      </div>

      {previewError && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {previewError}
        </div>
      )}

      {/* Dual Host Voice Configurators */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(['Riya', 'Arjun'] as const).map((host) => {
          const cfg = voiceConfig[host];
          const isRiya = host === 'Riya';
          return (
            <section
              key={host}
              className="rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 space-y-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <img
                    src={isRiya ? RIYA_AVATAR : ARJUN_AVATAR}
                    alt={`${host} studio portrait`}
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-2xl object-cover border border-[#E5DFF5] dark:border-white/15"
                  />
                  <div>
                    <h2 className="font-display font-bold text-lg text-[#18122B] dark:text-white">
                      {host}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {isRiya
                        ? 'Lead explainer · Warm, expressive & clear'
                        : 'Curious co-host · Sharp questions & examples'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handlePreviewVoice(host)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-opacity whitespace-nowrap ${
                    isRiya
                      ? 'bg-gradient-to-r from-[#6D28D9] to-[#BE185D]'
                      : 'bg-gradient-to-r from-[#0369A1] to-[#0E7490]'
                  }`}
                >
                  {previewingHost === host ? (
                    <>
                      <Square className="w-3.5 h-3.5" /> Stop
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" /> Preview
                    </>
                  )}
                </button>
              </div>

              {/* Studio Voice Selector */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                  Gemini Studio Voice
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {GEMINI_VOICE_CATALOG.map((v) => {
                    const active = cfg.voiceName === v.name;
                    return (
                      <button
                        key={v.name}
                        type="button"
                        onClick={() => updateHost(host, { voiceName: v.name })}
                        className={`text-left p-3 rounded-xl border transition-colors ${
                          active
                            ? 'border-[#8B5CF6] bg-[#F3EEFF] dark:bg-[#1E193E]'
                            : 'border-[#EEEAF9] dark:border-white/10 hover:border-[#C4B5FD] dark:hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between text-sm font-semibold text-[#18122B] dark:text-white">
                          <span>{v.label}</span>
                          <span className="text-[11px] font-normal text-slate-600 dark:text-slate-300">
                            {v.register}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                          {v.timbre}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sliders & Style Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#EEEAF9] dark:border-white/10">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label htmlFor={`speed-${host}`} className="font-medium text-slate-700 dark:text-slate-200">
                      Speaking Speed
                    </label>
                    <span className="font-mono-tabular font-semibold text-[#5B21B6] dark:text-[#C4B5FD]">
                      {cfg.speed.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    id={`speed-${host}`}
                    type="range"
                    min={0.85}
                    max={1.25}
                    step={0.02}
                    value={cfg.speed}
                    onChange={(e) => updateHost(host, { speed: Number(e.target.value) })}
                    className="w-full accent-[#8B5CF6]"
                  />
                </div>

                <div>
                  <label htmlFor={`delivery-${host}`} className="text-xs font-medium text-slate-700 dark:text-slate-200 block mb-1.5">
                    Delivery Style
                  </label>
                  <select
                    id={`delivery-${host}`}
                    value={cfg.deliveryStyle}
                    onChange={(e) =>
                      updateHost(host, { deliveryStyle: e.target.value as VoiceDeliveryStyle })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
                  >
                    {DELIVERY_STYLES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={`expressiveness-${host}`} className="text-xs font-medium text-slate-700 dark:text-slate-200 block mb-1.5">
                    Expressiveness
                  </label>
                  <select
                    id={`expressiveness-${host}`}
                    value={cfg.expressiveness}
                    onChange={(e) =>
                      updateHost(host, { expressiveness: e.target.value as ExpressivenessLevel })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
                  >
                    {EXPRESSIVENESS_OPTIONS.map((ex) => (
                      <option key={ex} value={ex}>
                        {ex}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={`energy-${host}`} className="text-xs font-medium text-slate-700 dark:text-slate-200 block mb-1.5">
                    Energy
                  </label>
                  <select
                    id={`energy-${host}`}
                    value={cfg.energy}
                    onChange={(e) => updateHost(host, { energy: e.target.value as EnergyLevel })}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
                  >
                    {ENERGY_OPTIONS.map((en) => (
                      <option key={en} value={en}>
                        {en}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Save & Manage Presets + Authorized Custom Voice Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Saved Voice Presets */}
        <section className="lg:col-span-6 rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#8B5CF6]" />
            <h2 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
              Saved Voice Presets
            </h2>
          </div>

          <form onSubmit={handleSavePreset} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              aria-label="Preset name"
              placeholder="Preset name (e.g. Tamil Storytelling)"
              className="flex-1 min-w-[180px] px-3 py-2 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400"
            />
            <select
              value={presetHost}
              onChange={(e) => setPresetHost(e.target.value as 'Riya' | 'Arjun')}
              aria-label="Preset host"
              className="px-3 py-2 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
            >
              <option value="Riya">Save Riya</option>
              <option value="Arjun">Save Arjun</option>
            </select>
            <button
              type="submit"
              disabled={savingPreset || !presetName.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[#6D28D9] text-white hover:bg-[#5B21B6] disabled:opacity-40 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          </form>

          {presetMessage && (
            <p className="text-xs text-[#5B21B6] dark:text-[#C4B5FD]">{presetMessage}</p>
          )}

          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {profiles.map((prof) => (
              <div
                key={prof.id}
                className="p-3.5 rounded-xl border border-[#EEEAF9] dark:border-white/10 bg-[#FCFBFF] dark:bg-white/[0.02] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm text-[#18122B] dark:text-white truncate">
                    {prof.name}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    {prof.assignedHost} · {prof.config.voiceName} · {prof.config.speed.toFixed(2)}x ·{' '}
                    {prof.config.deliveryStyle}
                  </div>
                  {prof.calibrationSummary && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                      {prof.calibrationSummary}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handlePreviewVoice(prof.assignedHost, prof.config)}
                    className="p-2 rounded-lg border border-[#E5DFF5] dark:border-white/10 hover:border-[#22D3EE] text-slate-700 dark:text-slate-200"
                    aria-label={`Preview preset ${prof.name}`}
                    title="Preview preset"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-[#0E7490] dark:text-[#22D3EE]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateHost(prof.assignedHost, prof.config)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#8B5CF6]/10 text-[#5B21B6] dark:text-[#C4B5FD] hover:bg-[#8B5CF6]/20 whitespace-nowrap"
                  >
                    Apply
                  </button>
                  {confirmDeleteId === prof.id ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteProfile(prof.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(prof.id)}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                      aria-label={`Delete preset ${prof.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Authorized Custom Voice Sample Calibration */}
        <section className="lg:col-span-6 rounded-2xl border border-[#E5DFF5] dark:border-white/10 bg-white dark:bg-[#111526] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-[#BE185D] dark:text-[#F472B6]" />
            <h2 className="font-display font-semibold text-base text-[#18122B] dark:text-white">
              Authorized Voice Sample Calibration
            </h2>
          </div>

          <div className="rounded-xl bg-[#FAF8FF] dark:bg-white/5 border border-[#E5DFF5] dark:border-white/10 p-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#C2410C] dark:text-[#FB923C] shrink-0 mt-0.5" />
            <span>
              Gemini TTS generates new speech using verified studio voices and does not perform raw-audio voice cloning. Uploading an authorized sample transcribes and analyzes vocal cadence to calibrate a matched Gemini studio profile for generating new episode speech.
            </span>
          </div>

          <form onSubmit={handleCalibrateImport} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="import-profile-name" className="text-xs font-medium text-slate-700 dark:text-slate-200 block mb-1">
                  Profile Name
                </label>
                <input
                  id="import-profile-name"
                  type="text"
                  value={importProfileName}
                  onChange={(e) => setImportProfileName(e.target.value)}
                  placeholder="My Studio Voice"
                  className="w-full px-3 py-2 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400"
                />
              </div>

              <div>
                <label htmlFor="import-assign-host" className="text-xs font-medium text-slate-700 dark:text-slate-200 block mb-1">
                  Assign to Host
                </label>
                <select
                  id="import-assign-host"
                  value={importHost}
                  onChange={(e) => setImportHost(e.target.value as 'Riya' | 'Arjun')}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-[#F8F7FC] dark:bg-[#090B14] border border-[#E5DFF5] dark:border-white/10 text-[#18122B] dark:text-white"
                >
                  <option value="Riya">Riya</option>
                  <option value="Arjun">Arjun</option>
                </select>
              </div>
            </div>

            <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#C4B5FD] dark:border-white/20 bg-[#FAF8FF] dark:bg-white/[0.02] p-4 cursor-pointer hover:border-[#8B5CF6] focus-within:ring-2 focus-within:ring-[#0E7490] dark:focus-within:ring-[#22D3EE] transition-colors">
              <Upload className="w-5 h-5 text-[#6D28D9] dark:text-[#C4B5FD] mb-1.5" />
              <span className="text-xs font-medium text-[#18122B] dark:text-white">
                {selectedFile ? selectedFile.name : 'Choose WAV, MP3, M4A, or FLAC sample (max 10 MB)'}
              </span>
              {selectedFile && (
                <span className="text-[11px] font-mono-tabular text-slate-600 dark:text-slate-300 mt-0.5">
                  {(selectedFile.size / 1024).toFixed(0)} KB · {sampleDurationSec}s duration
                </span>
              )}
              <input
                type="file"
                accept=".wav,.mp3,.m4a,.flac,audio/*"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            {sampleObjectUrl && (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Uploaded Reference Sample Preview
                </div>
                <audio controls src={sampleObjectUrl} className="w-full h-9" />
              </div>
            )}

            <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
                className="mt-0.5 accent-[#8B5CF6]"
              />
              <span>
                I confirm this recording is my own voice or I have explicit authorization from the speaker. I will not upload unauthorized celebrity or third-party recordings.
              </span>
            </label>

            {importError && (
              <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-500/10 rounded-lg px-3 py-2">{importError}</p>
            )}

            {importSuccess && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4" />
                  Calibrated Profile "{importSuccess.profile.name}" Ready ({importSuccess.profile.config.voiceName})
                </div>
                <p className="text-slate-700 dark:text-slate-200">
                  Detected transcript: &ldquo;{importSuccess.transcript}&rdquo;
                </p>
                <p className="text-slate-600 dark:text-slate-300">{importSuccess.note}</p>
                <button
                  type="button"
                  onClick={() => handlePreviewVoice(importHost, importSuccess.profile.config)}
                  className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-lg bg-[#047857] text-white font-medium"
                >
                  <Check className="w-3.5 h-3.5" />
                  Preview Calibrated Speech
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={importing || !selectedFile || !consentConfirmed}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#BE185D] to-[#BE123C] text-white hover:opacity-95 disabled:opacity-40 transition-opacity"
            >
              {importing ? 'Analyzing Voice Sample...' : 'Calibrate Studio Voice Profile'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
