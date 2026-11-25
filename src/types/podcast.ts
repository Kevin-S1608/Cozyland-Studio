export const SUPPORTED_LANGUAGES = [
  'English',
  'Hinglish',
  'Hindi',
  'Tamil',
  'Telugu',
  'Bengali',
  'Marathi',
  'Kannada',
  'Malayalam',
  'Gujarati',
  'Punjabi',
  'Odia',
  'Urdu',
  'Assamese',
] as const;

export type PodcastLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const PODCAST_DURATIONS = ['short', 'medium', 'long'] as const;
export type PodcastDuration = (typeof PODCAST_DURATIONS)[number];

export const PODCAST_STYLES = [
  'Educational',
  'Conversational',
  'Professional',
  'Storytelling',
  'Technical deep dive',
  'Beginner friendly',
  'News and analysis',
  'Interview style',
] as const;
export type PodcastStyle = (typeof PODCAST_STYLES)[number];

export const GEMINI_VOICE_NAMES = [
  'Kore',
  'Zephyr',
  'Puck',
  'Charon',
  'Fenrir',
] as const;
export type GeminiVoiceName = (typeof GEMINI_VOICE_NAMES)[number];

export interface GeminiVoiceCatalogEntry {
  name: GeminiVoiceName;
  label: string;
  register: string;
  timbre: string;
  recommendedFor: 'Riya' | 'Arjun' | 'Either';
  description: string;
}

export const GEMINI_VOICE_CATALOG: GeminiVoiceCatalogEntry[] = [
  {
    name: 'Kore',
    label: 'Kore',
    register: 'Warm Alto',
    timbre: 'Clear, expressive, nurturing',
    recommendedFor: 'Riya',
    description: 'Balanced studio warmth ideal for explaining concepts smoothly.',
  },
  {
    name: 'Zephyr',
    label: 'Zephyr',
    register: 'Bright Soprano',
    timbre: 'Crisp, upbeat, articulate',
    recommendedFor: 'Riya',
    description: 'Energetic conversational delivery with natural pacing.',
  },
  {
    name: 'Puck',
    label: 'Puck',
    register: 'Dynamic Tenor',
    timbre: 'Curious, agile, engaging',
    recommendedFor: 'Arjun',
    description: 'Lively co-host cadence suited for sharp questions and banter.',
  },
  {
    name: 'Charon',
    label: 'Charon',
    register: 'Deep Baritone',
    timbre: 'Grounded, resonant, calm',
    recommendedFor: 'Arjun',
    description: 'Authoritative studio presence for deep dives and analysis.',
  },
  {
    name: 'Fenrir',
    label: 'Fenrir',
    register: 'Rich Mid-Low',
    timbre: 'Storytelling, vivid, bold',
    recommendedFor: 'Either',
    description: 'Expressive narrative voice great for storytelling and interviews.',
  },
];

export type ExpressivenessLevel = 'Calm' | 'Balanced' | 'Expressive' | 'Dramatic';
export type EnergyLevel = 'Relaxed' | 'Warm' | 'Upbeat' | 'High-Energy';
export type VoiceDeliveryStyle =
  | 'Conversational'
  | 'Storyteller'
  | 'Journalist'
  | 'Educator'
  | 'Tech Analyst';

export interface HostVoiceConfig {
  voiceName: GeminiVoiceName;
  speed: number; // 0.85 to 1.25
  expressiveness: ExpressivenessLevel;
  energy: EnergyLevel;
  deliveryStyle: VoiceDeliveryStyle;
  customProfileId?: string;
  calibrationNote?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  assignedHost: 'Riya' | 'Arjun';
  config: HostVoiceConfig;
  isCustomCalibrated: boolean;
  calibrationSummary?: string;
  consentConfirmed?: boolean;
  sampleDurationSec?: number;
  createdAt: string;
}

export interface EpisodeChapter {
  id: string;
  title: string;
  summary: string;
  startTimeSec: number;
  endTimeSec: number;
}

export interface EpisodePlan {
  title: string;
  subtitle: string;
  topicOverview: string;
  audienceLevel: string;
  language: PodcastLanguage;
  style: PodcastStyle;
  duration: PodcastDuration;
  introduction: string;
  chapters: EpisodeChapter[];
  keyFacts: string[];
  practicalExamples: string[];
  interestingQuestions: string[];
  sourceNotes: string[];
  groundingUrls: Array<{ title: string; uri: string }>;
}

export interface DialogueTurn {
  id: string;
  index: number;
  speaker: 'Riya' | 'Arjun';
  text: string;
  chapterId: string;
  emotionCue: string;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  audioStatus: 'pending' | 'ready' | 'error' | 'fallback';
  errorMessage?: string;
}

export interface SceneNode {
  id: string;
  label: string;
  role: 'core' | 'primary' | 'secondary' | 'detail';
  category: string;
  summary: string;
  chapterId: string;
  position: [number, number, number];
  scale: number;
  color: string;
  shape: 'sphere' | 'octahedron' | 'torus' | 'box' | 'cylinder' | 'icosahedron' | 'ring';
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  flowDirection: 'forward' | 'bidirectional';
  strength: number;
}

export interface ExplainerSceneData {
  domainType: string;
  title: string;
  summary: string;
  centralMetaphor: string;
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export interface CoverArtSpec {
  palette: [string, string, string];
  motif: 'waves' | 'neural' | 'orbit' | 'prism' | 'bio' | 'network' | 'architecture' | 'pulse';
  badgeLabel: string;
  subtitleLine: string;
  visualStyle: 'vibrant' | 'editorial' | 'neon' | 'minimal';
}

export interface QualityControlReport {
  passed: boolean;
  factualConsistencyNote: string;
  languageNaturalnessNote: string;
  speakerBalanceOk: boolean;
  conclusionComplete: boolean;
  adjustmentsApplied: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  groundedSources?: string[];
}

export interface Episode {
  id: string;
  topicInput: string;
  referenceUrl?: string;
  createdAt: string;
  updatedAt: string;
  plan: EpisodePlan;
  dialogue: DialogueTurn[];
  conclusion: string;
  qcReport: QualityControlReport;
  scene3D: ExplainerSceneData;
  coverSpec: CoverArtSpec;
  coverImageDataUrl?: string;
  audioUrl?: string;
  totalDurationSec: number;
  audioProvider: 'gemini-tts' | 'browser-fallback' | 'none';
  voiceConfig: {
    Riya: HostVoiceConfig;
    Arjun: HostVoiceConfig;
  };
  chatHistory: ChatMessage[];
}

export type PipelineStageId =
  | 'understanding'
  | 'planning'
  | 'writing'
  | 'quality_control'
  | 'visualizing'
  | 'audio_hosts'
  | 'audio_combining'
  | 'finalizing';

export interface GenerationProgressEvent {
  type:
    | 'stage'
    | 'plan'
    | 'dialogue_line'
    | 'qc_report'
    | 'visualization'
    | 'cover_spec'
    | 'audio_progress'
    | 'done'
    | 'error';
  stage?: PipelineStageId;
  message?: string;
  plan?: EpisodePlan;
  turn?: DialogueTurn;
  turns?: DialogueTurn[];
  conclusion?: string;
  qcReport?: QualityControlReport;
  scene3D?: ExplainerSceneData;
  coverSpec?: CoverArtSpec;
  completedSegments?: number;
  totalSegments?: number;
  episode?: Episode;
  error?: string;
  code?: string;
}
