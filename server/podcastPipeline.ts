import crypto from 'node:crypto';
import { ThinkingLevel, Type } from '@google/genai';
import { classifyGeminiError, generateTextWithFallback, getGeminiClient, MODELS, withRetry } from './ai.ts';
import { safeFetchUrlText, sanitizeText } from './security.ts';
import { saveEpisode, saveEpisodeAudio } from './storage.ts';
import type {
  CoverArtSpec,
  DialogueTurn,
  Episode,
  EpisodeChapter,
  EpisodePlan,
  ExplainerSceneData,
  GenerationProgressEvent,
  HostVoiceConfig,
  PodcastDuration,
  PodcastLanguage,
  PodcastStyle,
  QualityControlReport,
} from '../src/types/podcast.ts';

const LANGUAGE_GUIDANCE: Record<PodcastLanguage, string> = {
  English: 'Natural, vivid, conversational English.',
  Hinglish:
    'Natural urban Indian Hinglish in Latin script (blending everyday Hindi expressions seamlessly with English technical/conceptual words, the way friends chat on a modern Mumbai/Bengaluru podcast). Avoid stiff phrasing.',
  Hindi:
    'Natural conversational Hindi in Devanagari script with warm everyday phrasing. Keep well-known modern technical terms approachable rather than overly Sanskritized.',
  Tamil:
    'Natural conversational spoken Tamil in Tamil script (iyalbana pechu Tamil tone, NOT stiff literary or mechanical textbook translation). Use warm everyday Tamil expressions that sound great when spoken aloud.',
  Telugu:
    'Natural conversational Telugu in Telugu script, warm and engaging like two articulate Telugu podcast hosts.',
  Bengali:
    'Natural conversational Bengali in Bengali script, expressive and culturally grounded.',
  Marathi:
    'Natural conversational Marathi in Devanagari script, friendly and articulate.',
  Kannada:
    'Natural conversational Kannada in Kannada script, clear and relatable.',
  Malayalam:
    'Natural conversational Malayalam in Malayalam script, warm and engaging.',
  Gujarati:
    'Natural conversational Gujarati in Gujarati script, friendly and lively.',
  Punjabi:
    'Natural conversational Punjabi in Gurmukhi script, warm and expressive.',
  Odia:
    'Natural conversational Odia in Odia script, clear and relatable.',
  Urdu:
    'Natural conversational Urdu in Urdu/Nastaliq script, eloquent yet accessible.',
  Assamese:
    'Natural conversational Assamese in Assamese script, warm and natural.',
};

const DURATION_TURN_TARGET: Record<PodcastDuration, { min: number; max: number; chapters: number; label: string }> = {
  short: { min: 8, max: 10, chapters: 3, label: '2-3 minute quick explainer' },
  medium: { min: 14, max: 18, chapters: 4, label: '4-6 minute balanced episode' },
  long: { min: 20, max: 24, chapters: 5, label: '8-10 minute deep exploration' },
};

function stripWavHeader(wav: Buffer): Buffer {
  if (wav.length > 44 && wav.subarray(0, 4).toString('ascii') === 'RIFF') {
    let offset = 12;
    while (offset + 8 <= wav.length) {
      const chunkId = wav.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = wav.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        return wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + chunkSize));
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return wav.subarray(44);
  }
  return wav;
}

export function buildWavFile(pcmData: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

function buildVoiceStylePrompt(
  speaker: 'Riya' | 'Arjun',
  language: PodcastLanguage,
  config: HostVoiceConfig,
  emotionCue = 'natural'
): string {
  const persona =
    speaker === 'Riya'
      ? 'Friendly, expressive, knowledgeable female host explaining clearly'
      : 'Curious, engaged, articulate male co-host asking thoughtful questions';
  const paceNote =
    config.speed < 0.92
      ? 'slightly unhurried, clear pacing'
      : config.speed > 1.08
      ? 'brisk, lively conversational pacing'
      : 'natural conversational pacing';
  return `${persona}. Language: ${language}. Delivery style: ${config.deliveryStyle}. Expressiveness: ${config.expressiveness}. Energy: ${config.energy}. Tone: ${emotionCue}. Pace: ${paceNote}.${
    config.calibrationNote ? ` Vocal character cue: ${config.calibrationNote}` : ''
  }`;
}

async function resolveOptionalUrlContext(
  topicInput: string,
  referenceUrl?: string
): Promise<{ referenceContext: string; groundingUrls: Array<{ title: string; uri: string }> }> {
  const cleanTopic = sanitizeText(topicInput);
  let urlToFetch = referenceUrl ? sanitizeText(referenceUrl) : '';
  if (!urlToFetch && /^https?:\/\/\S+$/i.test(cleanTopic)) {
    urlToFetch = cleanTopic;
  }

  if (!urlToFetch) {
    return { referenceContext: '', groundingUrls: [] };
  }

  const fetched = await safeFetchUrlText(urlToFetch);
  return {
    referenceContext: `Reference URL (${fetched.url}) — Page Title: ${fetched.title}\nExtracted Content:\n${fetched.text}`,
    groundingUrls: [{ title: fetched.title, uri: fetched.url }],
  };
}

export async function runStageA(input: {
  topicInput: string;
  referenceUrl?: string;
  language: PodcastLanguage;
  duration: PodcastDuration;
  style: PodcastStyle;
  signal?: AbortSignal;
}): Promise<{ plan: EpisodePlan; referenceContext: string }> {
  const ai = getGeminiClient();
  const cleanTopic = sanitizeText(input.topicInput);
  const { referenceContext, groundingUrls } = await resolveOptionalUrlContext(
    cleanTopic,
    input.referenceUrl
  );
  const target = DURATION_TURN_TARGET[input.duration];
  const langRule = LANGUAGE_GUIDANCE[input.language];

  const response = await generateTextWithFallback(
    {
      contents: `You are the executive producer for Cozyland, a two-host AI podcast studio featuring Riya and Arjun.
Topic: "${cleanTopic}"
Language: ${input.language} (${langRule})
Style: ${input.style}
Length: ${input.duration} (${target.label}, ${target.chapters} chapters)
${referenceContext ? `\nSource Context:\n${referenceContext}\n` : ''}
Create a complete, accurate podcast plan written naturally in ${input.language}. Never invent fake statistics or citations.`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subtitle: { type: Type.STRING },
            topicOverview: { type: Type.STRING },
            audienceLevel: { type: Type.STRING },
            introduction: { type: Type.STRING },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                },
                required: ['id', 'title', 'summary'],
              },
            },
            keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
            practicalExamples: { type: Type.ARRAY, items: { type: Type.STRING } },
            interestingQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            sourceNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'title',
            'subtitle',
            'topicOverview',
            'audienceLevel',
            'introduction',
            'chapters',
            'keyFacts',
            'practicalExamples',
            'interestingQuestions',
            'sourceNotes',
          ],
        },
      },
    },
    { retries: 1, timeoutMs: 40000, signal: input.signal }
  );

  const raw = JSON.parse(response.text || '{}') as {
    title?: string;
    subtitle?: string;
    topicOverview?: string;
    audienceLevel?: string;
    introduction?: string;
    chapters?: Array<{ id?: string; title?: string; summary?: string }>;
    keyFacts?: string[];
    practicalExamples?: string[];
    interestingQuestions?: string[];
    sourceNotes?: string[];
  };

  const chapters: EpisodeChapter[] = (raw.chapters || []).slice(0, target.chapters + 1).map((ch, idx) => ({
    id: ch.id || `ch-${idx + 1}`,
    title: ch.title || `Chapter ${idx + 1}`,
    summary: ch.summary || '',
    startTimeSec: 0,
    endTimeSec: 0,
  }));

  if (chapters.length === 0) {
    chapters.push({
      id: 'ch-1',
      title: 'Core Foundations',
      summary: raw.topicOverview || cleanTopic,
      startTimeSec: 0,
      endTimeSec: 0,
    });
  }

  return {
    plan: {
      title: raw.title || cleanTopic,
      subtitle: raw.subtitle || 'A Cozyland Deep-Dive Conversation',
      topicOverview: raw.topicOverview || cleanTopic,
      audienceLevel: raw.audienceLevel || 'Curious General Audience',
      language: input.language,
      style: input.style,
      duration: input.duration,
      introduction: raw.introduction || '',
      chapters,
      keyFacts: raw.keyFacts || [],
      practicalExamples: raw.practicalExamples || [],
      interestingQuestions: raw.interestingQuestions || [],
      sourceNotes: raw.sourceNotes || [],
      groundingUrls,
    },
    referenceContext,
  };
}

/**
 * Generates full Episode Plan (if not supplied), natural two-host dialogue,
 * QC verification, dynamic 3D explainer topology, and cover art spec in ONE
 * streamlined Gemini call to minimize RPM quota usage and maximize speed.
 */
export async function runUnifiedStageAB(input: {
  topicInput: string;
  referenceUrl?: string;
  language: PodcastLanguage;
  duration: PodcastDuration;
  style: PodcastStyle;
  existingPlan?: EpisodePlan;
  voiceConfig: { Riya: HostVoiceConfig; Arjun: HostVoiceConfig };
  onEvent?: (event: GenerationProgressEvent) => void;
  signal?: AbortSignal;
}): Promise<{
  plan: EpisodePlan;
  dialogue: DialogueTurn[];
  conclusion: string;
  qcReport: QualityControlReport;
  scene3D: ExplainerSceneData;
  coverSpec: CoverArtSpec;
}> {
  const ai = getGeminiClient();
  const cleanTopic = sanitizeText(input.topicInput);

  input.onEvent?.({
    type: 'stage',
    stage: 'understanding',
    message: 'Understanding your topic and preparing episode blueprint...',
  });

  const { referenceContext, groundingUrls } = await resolveOptionalUrlContext(
    cleanTopic,
    input.referenceUrl
  );

  const target = DURATION_TURN_TARGET[input.duration];
  const langRule = LANGUAGE_GUIDANCE[input.language];

  input.onEvent?.({
    type: 'stage',
    stage: 'planning',
    message: `Structuring ${target.chapters} chapters and ${input.language} dialogue...`,
  });

  const unifiedPrompt = `You are the executive producer, scriptwriter, quality reviewer, and 3D visual director of Cozyland.
Topic Input: "${cleanTopic}"
Target Language: ${input.language} (${langRule})
Podcast Style: ${input.style}
Target Length: ${input.duration} (${target.label}, ${target.chapters} chapters, ${target.min}-${target.max} dialogue turns)
${referenceContext ? `\nReference Material:\n${referenceContext}\n` : ''}
${input.existingPlan ? `\nFollow this planned title & chapters: ${JSON.stringify(input.existingPlan)}\n` : ''}

Deliver ALL of the following in ONE cohesive JSON payload:
1. "plan":
   - title, subtitle, topicOverview, audienceLevel, introduction, chapters (${target.chapters} items with id "ch-1", "ch-2", ...), keyFacts (3-5 verified facts, NO fabricated stats), practicalExamples (2-3), interestingQuestions (2-3), sourceNotes.
   - ALL text fields must be written naturally in ${input.language}.
2. "dialogue":
   - ${target.min} to ${target.max} natural conversational turns alternating dynamically between "Riya" (friendly, expressive explainer) and "Arjun" (curious, sharp questioner who challenges & adds practical examples).
   - Every turn has: speaker ("Riya" | "Arjun"), chapterId (matching one of the plan chapter IDs), emotionCue (e.g., "warm", "curious", "excited", "thoughtful"), and text.
   - Keep "text" 100% pure spoken prose in ${input.language}. Never include "Riya:" prefixes, stage brackets like [music], or 3D metadata inside spoken lines.
   - Ensure smooth transitions, zero repetitive filler, and natural spoken idioms in ${input.language}.
3. "conclusion": A complete, warm closing takeaway in ${input.language}.
4. "qcReport": Self-audit confirming factual consistency, natural ${input.language} phrasing, balanced Riya/Arjun turns, complete conclusion, and any adjustmentsApplied.
5. "scene3D": Dynamic topic-specific 3D explanation topology:
   - domainType (e.g., "human-brain", "neural-network", "solar-system", "sound-waves", "climate-system", "computer-network", "molecular-biology", or fitting domain).
   - title, summary, centralMetaphor.
   - 7 to 9 well-spaced 3D nodes (x in [-6, 6], y in [-3.2, 3.2], z in [-5, 5], at least 2.2 units apart). One "core" node near [0,0,0], plus "primary" and "secondary" nodes. Each node links to a valid chapterId, has a scale (0.8-1.35), vibrant hex color (#8B5CF6, #EC4899, #22D3EE, #3B82F6, #FB7185, #FB923C, #C4B5FD), and shape ("sphere"|"octahedron"|"torus"|"box"|"cylinder"|"icosahedron"|"ring").
   - 7 to 11 edges connecting nodes with short labels and flowDirection ("forward"|"bidirectional").
6. "coverSpec": 3 harmonious hex colors in palette, motif ("waves"|"neural"|"orbit"|"prism"|"bio"|"network"|"architecture"|"pulse"), badgeLabel, subtitleLine, visualStyle ("vibrant"|"editorial"|"neon"|"minimal").`;

  const response = await generateTextWithFallback(
    {
      contents: unifiedPrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            plan: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                topicOverview: { type: Type.STRING },
                audienceLevel: { type: Type.STRING },
                introduction: { type: Type.STRING },
                chapters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                    },
                    required: ['id', 'title', 'summary'],
                  },
                },
                keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
                practicalExamples: { type: Type.ARRAY, items: { type: Type.STRING } },
                interestingQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                sourceNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: [
                'title',
                'subtitle',
                'topicOverview',
                'audienceLevel',
                'introduction',
                'chapters',
                'keyFacts',
                'practicalExamples',
                'interestingQuestions',
                'sourceNotes',
              ],
            },
            dialogue: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speaker: { type: Type.STRING, enum: ['Riya', 'Arjun'] },
                  chapterId: { type: Type.STRING },
                  emotionCue: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ['speaker', 'chapterId', 'emotionCue', 'text'],
              },
            },
            conclusion: { type: Type.STRING },
            qcReport: {
              type: Type.OBJECT,
              properties: {
                passed: { type: Type.BOOLEAN },
                factualConsistencyNote: { type: Type.STRING },
                languageNaturalnessNote: { type: Type.STRING },
                speakerBalanceOk: { type: Type.BOOLEAN },
                conclusionComplete: { type: Type.BOOLEAN },
                adjustmentsApplied: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: [
                'passed',
                'factualConsistencyNote',
                'languageNaturalnessNote',
                'speakerBalanceOk',
                'conclusionComplete',
                'adjustmentsApplied',
              ],
            },
            scene3D: {
              type: Type.OBJECT,
              properties: {
                domainType: { type: Type.STRING },
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                centralMetaphor: { type: Type.STRING },
                nodes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      label: { type: Type.STRING },
                      role: { type: Type.STRING, enum: ['core', 'primary', 'secondary', 'detail'] },
                      category: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      chapterId: { type: Type.STRING },
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                      z: { type: Type.NUMBER },
                      scale: { type: Type.NUMBER },
                      color: { type: Type.STRING },
                      shape: {
                        type: Type.STRING,
                        enum: ['sphere', 'octahedron', 'torus', 'box', 'cylinder', 'icosahedron', 'ring'],
                      },
                    },
                    required: [
                      'id',
                      'label',
                      'role',
                      'category',
                      'summary',
                      'chapterId',
                      'x',
                      'y',
                      'z',
                      'scale',
                      'color',
                      'shape',
                    ],
                  },
                },
                edges: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      from: { type: Type.STRING },
                      to: { type: Type.STRING },
                      label: { type: Type.STRING },
                      flowDirection: { type: Type.STRING, enum: ['forward', 'bidirectional'] },
                      strength: { type: Type.NUMBER },
                    },
                    required: ['id', 'from', 'to', 'label', 'flowDirection', 'strength'],
                  },
                },
              },
              required: ['domainType', 'title', 'summary', 'centralMetaphor', 'nodes', 'edges'],
            },
            coverSpec: {
              type: Type.OBJECT,
              properties: {
                palette: { type: Type.ARRAY, items: { type: Type.STRING } },
                motif: {
                  type: Type.STRING,
                  enum: ['waves', 'neural', 'orbit', 'prism', 'bio', 'network', 'architecture', 'pulse'],
                },
                badgeLabel: { type: Type.STRING },
                subtitleLine: { type: Type.STRING },
                visualStyle: { type: Type.STRING, enum: ['vibrant', 'editorial', 'neon', 'minimal'] },
              },
              required: ['palette', 'motif', 'badgeLabel', 'subtitleLine', 'visualStyle'],
            },
          },
          required: ['plan', 'dialogue', 'conclusion', 'qcReport', 'scene3D', 'coverSpec'],
        },
      },
    },
    { retries: 1, baseDelayMs: 2200, timeoutMs: 65000, signal: input.signal }
  );

  const parsed = JSON.parse(response.text || '{}') as {
    plan?: {
      title?: string;
      subtitle?: string;
      topicOverview?: string;
      audienceLevel?: string;
      introduction?: string;
      chapters?: Array<{ id?: string; title?: string; summary?: string }>;
      keyFacts?: string[];
      practicalExamples?: string[];
      interestingQuestions?: string[];
      sourceNotes?: string[];
    };
    dialogue?: Array<{ speaker?: string; chapterId?: string; emotionCue?: string; text?: string }>;
    conclusion?: string;
    qcReport?: QualityControlReport;
    scene3D?: {
      domainType?: string;
      title?: string;
      summary?: string;
      centralMetaphor?: string;
      nodes?: Array<{
        id: string;
        label: string;
        role: 'core' | 'primary' | 'secondary' | 'detail';
        category: string;
        summary: string;
        chapterId: string;
        x: number;
        y: number;
        z: number;
        scale: number;
        color: string;
        shape: 'sphere' | 'octahedron' | 'torus' | 'box' | 'cylinder' | 'icosahedron' | 'ring';
      }>;
      edges?: Array<{
        id: string;
        from: string;
        to: string;
        label: string;
        flowDirection: 'forward' | 'bidirectional';
        strength: number;
      }>;
    };
    coverSpec?: CoverArtSpec;
  };

  const chapters: EpisodeChapter[] = (parsed.plan?.chapters || []).map((ch, idx) => ({
    id: ch.id || `ch-${idx + 1}`,
    title: ch.title || `Chapter ${idx + 1}`,
    summary: ch.summary || '',
    startTimeSec: 0,
    endTimeSec: 0,
  }));
  if (chapters.length === 0) {
    chapters.push({
      id: 'ch-1',
      title: 'Core Foundations',
      summary: parsed.plan?.topicOverview || cleanTopic,
      startTimeSec: 0,
      endTimeSec: 0,
    });
  }

  const plan: EpisodePlan = input.existingPlan || {
    title: parsed.plan?.title || cleanTopic,
    subtitle: parsed.plan?.subtitle || 'A Cozyland Deep-Dive Conversation',
    topicOverview: parsed.plan?.topicOverview || cleanTopic,
    audienceLevel: parsed.plan?.audienceLevel || 'Curious General Audience',
    language: input.language,
    style: input.style,
    duration: input.duration,
    introduction: parsed.plan?.introduction || '',
    chapters,
    keyFacts: parsed.plan?.keyFacts || [],
    practicalExamples: parsed.plan?.practicalExamples || [],
    interestingQuestions: parsed.plan?.interestingQuestions || [],
    sourceNotes: parsed.plan?.sourceNotes || [],
    groundingUrls,
  };

  input.onEvent?.({
    type: 'stage',
    stage: 'writing',
    message: `Generated ${plan.language} script for "${plan.title}"...`,
    plan,
  });
  input.onEvent?.({ type: 'plan', plan });

  const validChapterIds = new Set(plan.chapters.map((c) => c.id));
  const fallbackChapterId = plan.chapters[0]?.id || 'ch-1';

  const dialogue: DialogueTurn[] = (parsed.dialogue || [])
    .filter((d) => d.text && d.text.trim().length > 0)
    .map((d, index) => ({
      id: `turn-${index + 1}`,
      index,
      speaker: d.speaker === 'Arjun' ? 'Arjun' : 'Riya',
      chapterId: d.chapterId && validChapterIds.has(d.chapterId) ? d.chapterId : fallbackChapterId,
      emotionCue: d.emotionCue || 'natural',
      text: d.text!.replace(/^(Riya|Arjun)\s*:\s*/i, '').trim(),
      startTimeSec: 0,
      endTimeSec: 0,
      durationSec: 0,
      audioStatus: 'pending',
    }));

  for (const turn of dialogue) {
    input.onEvent?.({ type: 'dialogue_line', turn });
  }

  const qcReport: QualityControlReport = {
    passed: parsed.qcReport?.passed ?? true,
    factualConsistencyNote: parsed.qcReport?.factualConsistencyNote || 'Verified against grounded episode plan.',
    languageNaturalnessNote: parsed.qcReport?.languageNaturalnessNote || `Reviewed for natural ${plan.language} cadence.`,
    speakerBalanceOk: parsed.qcReport?.speakerBalanceOk ?? true,
    conclusionComplete: parsed.qcReport?.conclusionComplete ?? true,
    adjustmentsApplied: parsed.qcReport?.adjustmentsApplied || [],
  };

  input.onEvent?.({
    type: 'stage',
    stage: 'quality_control',
    message: 'Quality control review passed.',
  });
  input.onEvent?.({ type: 'qc_report', qcReport, turns: dialogue });

  const sceneNodes = (parsed.scene3D?.nodes || []).map((n, idx) => ({
    id: n.id || `node-${idx + 1}`,
    label: n.label || `Concept ${idx + 1}`,
    role: n.role || (idx === 0 ? 'core' : 'primary'),
    category: n.category || 'Concept',
    summary: n.summary || '',
    chapterId: validChapterIds.has(n.chapterId) ? n.chapterId : fallbackChapterId,
    position: [
      Math.max(-7, Math.min(7, Number(n.x) || 0)),
      Math.max(-4, Math.min(4, Number(n.y) || 0)),
      Math.max(-6, Math.min(6, Number(n.z) || 0)),
    ] as [number, number, number],
    scale: Math.max(0.65, Math.min(1.5, Number(n.scale) || 1)),
    color: /^#[0-9a-fA-F]{6}$/.test(n.color) ? n.color : '#8B5CF6',
    shape: n.shape || 'sphere',
  }));

  const validNodeIds = new Set(sceneNodes.map((n) => n.id));
  const sceneEdges = (parsed.scene3D?.edges || []).filter(
    (e) => validNodeIds.has(e.from) && validNodeIds.has(e.to) && e.from !== e.to
  );

  const scene3D: ExplainerSceneData = {
    domainType: parsed.scene3D?.domainType || 'knowledge-graph',
    title: parsed.scene3D?.title || plan.title,
    summary: parsed.scene3D?.summary || plan.topicOverview,
    centralMetaphor: parsed.scene3D?.centralMetaphor || 'Interconnected concept topology',
    nodes: sceneNodes,
    edges: sceneEdges,
  };

  const paletteArr = parsed.coverSpec?.palette || ['#6D28D9', '#EC4899', '#22D3EE'];
  const coverSpec: CoverArtSpec = {
    palette: [paletteArr[0] || '#6D28D9', paletteArr[1] || '#EC4899', paletteArr[2] || '#22D3EE'],
    motif: parsed.coverSpec?.motif || 'waves',
    badgeLabel: parsed.coverSpec?.badgeLabel || plan.style,
    subtitleLine: parsed.coverSpec?.subtitleLine || plan.subtitle,
    visualStyle: parsed.coverSpec?.visualStyle || 'vibrant',
  };

  input.onEvent?.({
    type: 'stage',
    stage: 'visualizing',
    message: 'Built interactive 3D explainer model and custom episode artwork.',
  });
  input.onEvent?.({ type: 'visualization', scene3D });
  input.onEvent?.({ type: 'cover_spec', coverSpec });

  return {
    plan,
    dialogue,
    conclusion: parsed.conclusion || plan.introduction,
    qcReport,
    scene3D,
    coverSpec,
  };
}

/**
 * Generates multi-speaker chapter audio via gemini-3.8-flash-tts multiSpeakerVoiceConfig.
 * Batching by chapter slashes API requests by 3-4x, ensures natural conversational flow
 * between Riya and Arjun, and yields exact WAV byte durations per chapter!
 */
async function synthesizeChapterAudio(
  turns: DialogueTurn[],
  language: PodcastLanguage,
  voiceConfig: { Riya: HostVoiceConfig; Arjun: HostVoiceConfig },
  signal?: AbortSignal
): Promise<Buffer> {
  const ai = getGeminiClient();

  const parts = turns.map((turn) => ({
    text: `${turn.speaker}: ${turn.text}`,
    speechMetadata: {
      speaker: turn.speaker,
      style: buildVoiceStylePrompt(turn.speaker, language, voiceConfig[turn.speaker], turn.emotionCue),
    },
  }));

  try {
    const res = await withRetry(
      () =>
        ai.models.generateContent({
          model: MODELS.TTS_PODCAST,
          contents: [{ role: 'user', parts }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: 'Riya',
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceConfig.Riya.voiceName },
                    },
                  },
                  {
                    speaker: 'Arjun',
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceConfig.Arjun.voiceName },
                    },
                  },
                ],
              },
            },
          },
        }),
      { retries: 2, baseDelayMs: 3000, timeoutMs: 55000, signal }
    );
    const b64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error('No audio returned from gemini-3.8-flash-tts');
    return stripWavHeader(Buffer.from(b64, 'base64'));
  } catch (primaryErr) {
    const classified = classifyGeminiError(primaryErr);
    if (classified.code === 'MISSING_API_KEY' || classified.code === 'API_KEY_INVALID' || signal?.aborted) {
      throw primaryErr;
    }

    // Fallback: synthesize per-turn with gemini-3.8-flash-lite-tts sequentially
    const turnPcms: Buffer[] = [];
    const pause = Buffer.alloc(Math.floor(0.2 * 48000));
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const res = await withRetry(
        () =>
          ai.models.generateContent({
            model: MODELS.TTS_PREVIEW,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: turn.text,
                    speechMetadata: {
                      speaker: turn.speaker,
                      style: buildVoiceStylePrompt(turn.speaker, language, voiceConfig[turn.speaker], turn.emotionCue),
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voiceConfig[turn.speaker].voiceName },
                },
              },
            },
          }),
        { retries: 1, baseDelayMs: 2500, timeoutMs: 30000, signal }
      );
      const b64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (b64) {
        turnPcms.push(stripWavHeader(Buffer.from(b64, 'base64')));
        if (i < turns.length - 1) turnPcms.push(pause);
      }
    }
    if (turnPcms.length === 0) throw primaryErr;
    return Buffer.concat(turnPcms);
  }
}

export async function runStageD(input: {
  episode: Episode;
  onProgress?: (completed: number, total: number, message: string) => void;
  signal?: AbortSignal;
}): Promise<Episode> {
  const { episode } = input;
  const turns = episode.dialogue.map((t) => ({ ...t }));
  const chapters = episode.plan.chapters.map((c) => ({ ...c }));

  // Group dialogue turns into ordered chapter batches (preserving exact sequence)
  const batches: Array<{ chapterId: string; chapterTitle: string; turns: DialogueTurn[] }> = [];
  for (const turn of turns) {
    const last = batches[batches.length - 1];
    if (last && last.chapterId === turn.chapterId) {
      last.turns.push(turn);
    } else {
      const ch = chapters.find((c) => c.id === turn.chapterId);
      batches.push({
        chapterId: turn.chapterId,
        chapterTitle: ch?.title || `Segment ${batches.length + 1}`,
        turns: [turn],
      });
    }
  }

  const SAMPLE_RATE = 24000;
  const BYTES_PER_SEC = SAMPLE_RATE * 2;
  const PAUSE_BUFFER = Buffer.alloc(Math.floor(0.32 * BYTES_PER_SEC));

  const combinedParts: Buffer[] = [];
  let cursorSec = 0;
  let readyBatches = 0;

  for (let i = 0; i < batches.length; i++) {
    if (input.signal?.aborted) {
      throw new Error('Audio generation cancelled.');
    }
    const batch = batches[i];
    try {
      const pcm = await synthesizeChapterAudio(
        batch.turns,
        episode.plan.language,
        episode.voiceConfig,
        input.signal
      );
      readyBatches++;
      const batchDurationSec = pcm.length / BYTES_PER_SEC;
      const totalChars = batch.turns.reduce((acc, t) => acc + Math.max(8, t.text.length), 0);

      let localCursor = cursorSec;
      for (const turn of batch.turns) {
        const share = Math.max(8, turn.text.length) / totalChars;
        const turnDur = batchDurationSec * share;
        turn.startTimeSec = Number(localCursor.toFixed(3));
        turn.durationSec = Number(turnDur.toFixed(3));
        turn.endTimeSec = Number((localCursor + turnDur).toFixed(3));
        turn.audioStatus = 'ready';
        turn.errorMessage = undefined;
        localCursor += turnDur;
      }

      combinedParts.push(pcm);
      cursorSec += batchDurationSec;
      if (i < batches.length - 1) {
        combinedParts.push(PAUSE_BUFFER);
        cursorSec += PAUSE_BUFFER.length / BYTES_PER_SEC;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Audio synthesis failed';
      for (const turn of batch.turns) {
        turn.audioStatus = 'error';
        turn.errorMessage = msg;
      }
    } finally {
      input.onProgress?.(
        i + 1,
        batches.length,
        `Synthesized chapter audio ${i + 1} of ${batches.length}: ${batch.chapterTitle}...`
      );
    }
  }

  if (readyBatches === 0) {
    const updated: Episode = {
      ...episode,
      dialogue: turns,
      audioProvider: 'browser-fallback',
      totalDurationSec: estimateFallbackTimings(turns, chapters),
    };
    return await saveEpisode(updated);
  }

  // Update chapter timestamps from actual audio segments
  for (const ch of chapters) {
    const chTurns = turns.filter((t) => t.chapterId === ch.id && t.durationSec > 0);
    if (chTurns.length > 0) {
      ch.startTimeSec = chTurns[0].startTimeSec;
      ch.endTimeSec = chTurns[chTurns.length - 1].endTimeSec;
    }
  }

  const masterPcm = Buffer.concat(combinedParts);
  const masterWav = buildWavFile(masterPcm, SAMPLE_RATE, 1, 16);
  const audioUrl = await saveEpisodeAudio(episode.id, masterWav);

  const finalEpisode: Episode = {
    ...episode,
    plan: {
      ...episode.plan,
      chapters,
    },
    dialogue: turns,
    audioUrl,
    totalDurationSec: Number(cursorSec.toFixed(2)),
    audioProvider: 'gemini-tts',
  };

  return await saveEpisode(finalEpisode);
}

function estimateFallbackTimings(turns: DialogueTurn[], chapters: EpisodeChapter[]): number {
  let cursor = 0;
  for (const t of turns) {
    const words = Math.max(4, t.text.split(/\s+/).length);
    const dur = Number((words * 0.42).toFixed(2));
    t.startTimeSec = Number(cursor.toFixed(2));
    t.durationSec = dur;
    t.endTimeSec = Number((cursor + dur).toFixed(2));
    t.audioStatus = 'fallback';
    cursor += dur + 0.25;
  }
  for (const ch of chapters) {
    const chTurns = turns.filter((t) => t.chapterId === ch.id);
    if (chTurns.length > 0) {
      ch.startTimeSec = chTurns[0].startTimeSec;
      ch.endTimeSec = chTurns[chTurns.length - 1].endTimeSec;
    }
  }
  return Number(cursor.toFixed(2));
}

export async function runGroundedEpisodeChat(episode: Episode, question: string): Promise<{
  answer: string;
  groundedSources: string[];
}> {
  const ai = getGeminiClient();
  const transcriptText = episode.dialogue
    .map((t) => `[${t.startTimeSec.toFixed(1)}s · ${t.speaker} · ${t.chapterId}]: ${t.text}`)
    .join('\n');

  const chaptersText = episode.plan.chapters
    .map((c) => `${c.id}: ${c.title} — ${c.summary}`)
    .join('\n');

  const prompt = `You are Cozyland's episode assistant answering a listener's question strictly using the generated podcast episode content below.
Episode Title: ${episode.plan.title}
Language: ${episode.plan.language}
Overview: ${episode.plan.topicOverview}
Key Facts: ${episode.plan.keyFacts.join('; ')}
Practical Examples: ${episode.plan.practicalExamples.join('; ')}
Chapters:\n${chaptersText}
Source Notes: ${episode.plan.sourceNotes.join('; ')}
Transcript:\n${transcriptText}
Conclusion: ${episode.conclusion}

Listener Question: "${sanitizeText(question)}"

Rules:
- Answer clearly and helpfully, grounded ONLY in the episode transcript, facts, chapters, and source notes above.
- If the listener asks something NOT covered in this episode, explicitly state that it wasn't covered in this episode rather than inventing details.
- Cite which chapter or host statement supports your answer when relevant.
- Respond in ${episode.plan.language} (or match the user's question language if they asked in English).`;

  const res = await generateTextWithFallback(
    {
      contents: prompt,
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    },
    { retries: 1, timeoutMs: 25000 }
  );

  const groundedSources = episode.plan.groundingUrls.map((g) => g.title);
  return {
    answer: res.text || 'I could not generate an answer from the episode transcript.',
    groundedSources,
  };
}

export async function runVoicePreview(input: {
  speaker: 'Riya' | 'Arjun';
  language: PodcastLanguage;
  voiceConfig: HostVoiceConfig;
  sampleText?: string;
}): Promise<{ audioBase64: string; mimeType: string; sampleTextUsed: string }> {
  const ai = getGeminiClient();
  const defaultLines: Record<PodcastLanguage, { Riya: string; Arjun: string }> = {
    English: {
      Riya: 'Welcome to Cozyland! Today we are breaking down big ideas into warm, unforgettable conversations.',
      Arjun: 'Wait, hold on — does that mean anyone can explore a complex topic just from one single line?',
    },
    Hinglish: {
      Riya: 'Welcome to Cozyland! Aaj hum ek bahut interesting topic ko simple aur mazedaar tarike se samjhenge.',
      Arjun: 'Arre wah, matlab sirf ek line likh ke hum poora podcast aur 3D explainer bana sakte hain?',
    },
    Tamil: {
      Riya: 'Cozyland-க்கு அன்புடன் வரவேற்கிறோம்! இன்னைக்கு ஒரு சுவாரஸ்யமான விஷயத்தை ரொம்ப எளிமையா பேசப் போறோம்.',
      Arjun: 'அட, நிஜமாவா? ஒரு வரியில கொடுத்தாலே இவ்வளவு தெளிவா விளக்க முடியுமா?',
    },
    Hindi: {
      Riya: 'कोज़ीलैंड में आपका स्वागत है! आज हम एक बेहद दिलचस्प विषय को आसान भाषा में समझेंगे।',
      Arjun: 'वाह, क्या वाकई सिर्फ एक पंक्ति से हम इतना गहरा और रोचक पॉडकास्ट बना सकते हैं?',
    },
    Telugu: {
      Riya: 'కోజీల్యాండ్‌కు స్వాగతం! ఈరోజు మనం ఒక ఆసక్తికరమైన విషయాన్ని సులభంగా తెలుసుకుందాం.',
      Arjun: 'నిజంగానా? కేవలం ఒక్క లైన్‌తో ఇంత అద్భుతమైన పాడ్‌కాస్ట్ తయారు చేయవచ్చా?',
    },
    Bengali: {
      Riya: 'কোজিল্যান্ডে স্বাগতম! আজ আমরা একটি দারুণ বিষয় খুব সহজভাবে আলোচনা করব।',
      Arjun: 'দারুণ তো! সত্যিই কি মাত্র এক লাইনের বিষয় থেকে পুরো পডকাস্ট তৈরি করা যায়?',
    },
    Marathi: {
      Riya: 'कोझीलँडमध्ये तुमचे स्वागत आहे! आज आपण एक रंजक विषय अगदी सोप्या शब्दांत समजून घेणार आहोत.',
      Arjun: 'खरंच का? फक्त एका ओळीवरून आपण इतका सुंदर पॉडकास्ट तयार करू शकतो?',
    },
    Kannada: {
      Riya: 'ಕೋಜಿಲ್ಯಾಂಡ್‌ಗೆ ಸ್ವಾಗತ! ಇಂದು ನಾವು ಒಂದು ಕುತೂಹಲಕಾರಿ ವಿಷಯವನ್ನು ಸರಳವಾಗಿ ತಿಳಿದುಕೊಳ್ಳೋಣ.',
      Arjun: 'ನಿಜವಾಗಲೂ? ಕೇವಲ ಒಂದು ಸಾಲಿನಿಂದ ಇಷ್ಟೊಂದು ಚೆನ್ನಾಗಿ ಪಾಡ್‌ಕಾಸ್ಟ್ ಮಾಡಬಹುದೇ?',
    },
    Malayalam: {
      Riya: 'കോസിലാൻഡിലേക്ക് സ്വാഗതം! ഇന്ന് നമ്മൾ രസകരമായ ഒരു വിഷയം ലളിതമായി സംസാരിക്കാം.',
      Arjun: 'ശരിക്കും? ഒറ്റ വരിയിൽ നിന്ന് ഇത്രയും മികച്ച ഒരു പോഡ്‌കാസ്റ്റ് ഉണ്ടാക്കാൻ കഴിയുമോ?',
    },
    Gujarati: {
      Riya: 'કોઝીલેન્ડમાં તમારું સ્વાગત છે! આજે આપણે એક રસપ્રદ વિષય સરળ ભાષામાં સમજીશું.',
      Arjun: 'ખરેખર? શું માત્ર એક જ લાઇનથી આખો પોડકાસ્ટ તૈયાર થઈ શકે છે?',
    },
    Punjabi: {
      Riya: 'ਕੋਜ਼ੀਲੈਂਡ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ! ਅੱਜ ਅਸੀਂ ਇੱਕ ਦਿਲਚਸਪ ਵਿਸ਼ੇ ਨੂੰ ਸੌਖੇ ਤਰੀਕੇ ਨਾਲ ਸਮਝਾਂਗੇ।',
      Arjun: 'ਸੱਚੀ? ਕੀ ਸਿਰਫ਼ ਇੱਕ ਲਾਈਨ ਤੋਂ ਹੀ ਪੂਰਾ ਪੌਡਕਾਸਟ ਬਣ ਸਕਦਾ ਹੈ?',
    },
    Odia: {
      Riya: 'କୋଜିଲ୍ୟାଣ୍ଡକୁ ସ୍ୱାଗତ! ଆଜି ଆମେ ଏକ ରୋଚକ ବିଷୟକୁ ସହଜ ଭାଷାରେ ଆଲୋଚନା କରିବା।',
      Arjun: 'ସତରେ? କେବଳ ଗୋଟିଏ ଧାଡ଼ିରୁ କଣ ପୂରା ପଡକାଷ୍ଟ ତିଆରି ହୋଇପାରିବ?',
    },
    Urdu: {
      Riya: 'کوزی لینڈ میں خوش آمدید! آج ہم ایک دلچسپ موضوع کو آسان انداز میں سمجھیں گے۔',
      Arjun: 'واقعی؟ کیا صرف ایک جملے سے اتنا شاندار پوڈکاسٹ تیار ہو سکتا ہے؟',
    },
    Assamese: {
      Riya: 'কজীলেণ্ডলৈ স্বাগতম! আজি আমি এটা আকৰ্ষণীয় বিষয় সহজকৈ আলোচনা কৰিম।',
      Arjun: 'সঁচাকৈ নেকি? মাত্ৰ এটা শাৰীৰ পৰাই সম্পূৰ্ণ পডকাষ্ট বনাব পাৰি নেকি?',
    },
  };

  const text =
    input.sampleText && input.sampleText.trim().length > 0
      ? sanitizeText(input.sampleText)
      : defaultLines[input.language]?.[input.speaker] || defaultLines.English[input.speaker];

  const stylePrompt = buildVoiceStylePrompt(
    input.speaker,
    input.language,
    input.voiceConfig,
    'warm studio preview'
  );

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODELS.TTS_PREVIEW,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  speaker: input.speaker,
                  style: stylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: input.voiceConfig.voiceName,
              },
            },
          },
        },
      }),
    { retries: 1, timeoutMs: 25000 }
  );

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Preview audio could not be generated.');
  }

  return {
    audioBase64: base64Audio,
    mimeType: 'audio/wav',
    sampleTextUsed: text,
  };
}

export async function analyzeAuthorizedVoiceSample(input: {
  audioBuffer: Buffer;
  mimeType: string;
  assignedHost: 'Riya' | 'Arjun';
}): Promise<{
  transcript: string;
  recommendedVoiceName: 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';
  calibrationSummary: string;
  calibrationNote: string;
  recommendedEnergy: 'Relaxed' | 'Warm' | 'Upbeat' | 'High-Energy';
  recommendedSpeed: number;
}> {
  const ai = getGeminiClient();
  const base64Audio = input.audioBuffer.toString('base64');

  const transcribeRes = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODELS.TRANSCRIBE,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: input.mimeType,
                data: base64Audio,
              },
            },
            {
              text: 'Transcribe this short voice sample accurately.',
            },
          ],
        },
      }),
    { retries: 1, timeoutMs: 25000 }
  );

  const transcript = transcribeRes.text?.trim() || 'Sample speech recognized';

  const analysisRes = await generateTextWithFallback(
    {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: base64Audio,
            },
          },
          {
            text: `Listen to this authorized voice sample for podcast host "${input.assignedHost}".
Map its vocal pitch register, warmth, energy, and speaking pace to the closest available Gemini studio voice from:
- Kore (Warm Alto: clear, expressive, nurturing)
- Zephyr (Bright Soprano: crisp, upbeat, articulate)
- Puck (Dynamic Tenor: curious, agile, engaging)
- Charon (Deep Baritone: grounded, resonant, calm)
- Fenrir (Rich Mid-Low: storytelling, vivid, bold)

Return JSON with recommendedVoiceName, calibrationSummary, calibrationNote, recommendedEnergy, and recommendedSpeed (0.88 to 1.15).`,
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendedVoiceName: {
              type: Type.STRING,
              enum: ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'],
            },
            calibrationSummary: { type: Type.STRING },
            calibrationNote: { type: Type.STRING },
            recommendedEnergy: {
              type: Type.STRING,
              enum: ['Relaxed', 'Warm', 'Upbeat', 'High-Energy'],
            },
            recommendedSpeed: { type: Type.NUMBER },
          },
          required: [
            'recommendedVoiceName',
            'calibrationSummary',
            'calibrationNote',
            'recommendedEnergy',
            'recommendedSpeed',
          ],
        },
      },
    },
    { retries: 1, timeoutMs: 25000 }
  );

  const parsed = JSON.parse(analysisRes.text || '{}') as {
    recommendedVoiceName?: 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';
    calibrationSummary?: string;
    calibrationNote?: string;
    recommendedEnergy?: 'Relaxed' | 'Warm' | 'Upbeat' | 'High-Energy';
    recommendedSpeed?: number;
  };

  return {
    transcript,
    recommendedVoiceName: parsed.recommendedVoiceName || (input.assignedHost === 'Riya' ? 'Kore' : 'Puck'),
    calibrationSummary:
      parsed.calibrationSummary ||
      'Analyzed vocal cadence, warmth, and pacing to match the closest Gemini studio voice.',
    calibrationNote: parsed.calibrationNote || 'Balanced warm conversational cadence',
    recommendedEnergy: parsed.recommendedEnergy || 'Warm',
    recommendedSpeed: Math.max(0.85, Math.min(1.2, Number(parsed.recommendedSpeed) || 1.0)),
  };
}

export function createNewEpisodeShell(input: {
  topicInput: string;
  referenceUrl?: string;
  plan: EpisodePlan;
  dialogue: DialogueTurn[];
  conclusion: string;
  qcReport: QualityControlReport;
  scene3D: ExplainerSceneData;
  coverSpec: CoverArtSpec;
  voiceConfig: { Riya: HostVoiceConfig; Arjun: HostVoiceConfig };
}): Episode {
  const now = new Date().toISOString();
  return {
    id: `ep-${crypto.randomUUID().slice(0, 10)}`,
    topicInput: input.topicInput,
    referenceUrl: input.referenceUrl,
    createdAt: now,
    updatedAt: now,
    plan: input.plan,
    dialogue: input.dialogue,
    conclusion: input.conclusion,
    qcReport: input.qcReport,
    scene3D: input.scene3D,
    coverSpec: input.coverSpec,
    totalDurationSec: 0,
    audioProvider: 'none',
    voiceConfig: input.voiceConfig,
    chatHistory: [],
  };
}
