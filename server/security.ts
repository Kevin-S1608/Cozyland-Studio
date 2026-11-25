import dns from 'node:dns/promises';
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  GEMINI_VOICE_NAMES,
  PODCAST_DURATIONS,
  PODCAST_STYLES,
  SUPPORTED_LANGUAGES,
} from '../src/types/podcast.ts';

export const HostVoiceConfigSchema = z.object({
  voiceName: z.enum(GEMINI_VOICE_NAMES),
  speed: z.number().min(0.75).max(1.35).default(1.0),
  expressiveness: z.enum(['Calm', 'Balanced', 'Expressive', 'Dramatic']).default('Expressive'),
  energy: z.enum(['Relaxed', 'Warm', 'Upbeat', 'High-Energy']).default('Warm'),
  deliveryStyle: z
    .enum(['Conversational', 'Storyteller', 'Journalist', 'Educator', 'Tech Analyst'])
    .default('Conversational'),
  customProfileId: z.string().max(120).optional(),
  calibrationNote: z.string().max(400).optional(),
});

export const StageARequestSchema = z.object({
  topicInput: z.string().trim().min(1, 'Please enter a topic, question, or URL.').max(12000),
  referenceUrl: z.string().trim().max(2048).optional().or(z.literal('')),
  language: z.enum(SUPPORTED_LANGUAGES).default('English'),
  duration: z.enum(PODCAST_DURATIONS).default('short'),
  style: z.enum(PODCAST_STYLES).default('Conversational'),
});

export const StageBRequestSchema = z.object({
  topicInput: z.string().trim().min(1).max(12000),
  referenceUrl: z.string().trim().max(2048).optional().or(z.literal('')),
  language: z.enum(SUPPORTED_LANGUAGES).default('English'),
  duration: z.enum(PODCAST_DURATIONS).default('short'),
  style: z.enum(PODCAST_STYLES).default('Conversational'),
  plan: z.any().optional(),
  voiceConfig: z
    .object({
      Riya: HostVoiceConfigSchema,
      Arjun: HostVoiceConfigSchema,
    })
    .optional(),
});

export const StageDRequestSchema = z.object({
  episodeId: z.string().trim().min(1).max(120),
  language: z.enum(SUPPORTED_LANGUAGES),
  turns: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        index: z.number().int().min(0),
        speaker: z.enum(['Riya', 'Arjun']),
        text: z.string().min(1).max(4000),
        chapterId: z.string().min(1).max(120),
        emotionCue: z.string().max(120).default('natural'),
      })
    )
    .min(1)
    .max(60),
  voiceConfig: z.object({
    Riya: HostVoiceConfigSchema,
    Arjun: HostVoiceConfigSchema,
  }),
});

export const ChatRequestSchema = z.object({
  episodeId: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1, 'Please ask a question.').max(2000),
});

export const VoicePreviewSchema = z.object({
  speaker: z.enum(['Riya', 'Arjun']),
  language: z.enum(SUPPORTED_LANGUAGES).default('English'),
  voiceConfig: HostVoiceConfigSchema,
  sampleText: z.string().trim().max(400).optional(),
});

export const VoiceProfileSaveSchema = z.object({
  id: z.string().max(120).optional(),
  name: z.string().trim().min(1).max(80),
  assignedHost: z.enum(['Riya', 'Arjun']),
  config: HostVoiceConfigSchema,
  isCustomCalibrated: z.boolean().default(false),
  calibrationSummary: z.string().max(500).optional(),
  consentConfirmed: z.boolean().optional(),
  sampleDurationSec: z.number().min(0).max(600).optional(),
});

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SAFE_RASTER_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const EpisodePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    coverSpec: z
      .object({
        palette: z.tuple([
          z.string().regex(HEX_COLOR_RE),
          z.string().regex(HEX_COLOR_RE),
          z.string().regex(HEX_COLOR_RE),
        ]).optional(),
        motif: z
          .enum(['waves', 'neural', 'orbit', 'prism', 'bio', 'network', 'architecture', 'pulse'])
          .optional(),
        visualStyle: z.enum(['vibrant', 'editorial', 'neon', 'minimal']).optional(),
        badgeLabel: z.string().trim().max(80).optional(),
        subtitleLine: z.string().trim().max(140).optional(),
      })
      .strict()
      .optional(),
    coverImageDataUrl: z
      .string()
      .max(1_500_000)
      .regex(SAFE_RASTER_DATA_URL_RE, 'Cover image must be a valid PNG, JPEG, or WebP data URL.')
      .optional(),
  })
  .strict();

export function sanitizeText(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(normalized.slice(7));
  }
  if (!net.isIPv4(ip)) {
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // Multicast / reserved
  return false;
}

export async function validateSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Invalid URL format. Use a full https:// or http:// URL.'), {
      statusCode: 400,
      code: 'INVALID_URL',
    });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw Object.assign(new Error('Only http:// and https:// URLs are permitted.'), {
      statusCode: 400,
      code: 'UNSUPPORTED_URL_SCHEME',
    });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('URLs with embedded credentials are not permitted.'), {
      statusCode: 400,
      code: 'INVALID_URL_CREDENTIALS',
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw Object.assign(new Error('Private or internal network URLs are not allowed.'), {
      statusCode: 400,
      code: 'BLOCKED_PRIVATE_URL',
    });
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw Object.assign(new Error('Private or loopback IP addresses are not allowed.'), {
        statusCode: 400,
        code: 'BLOCKED_PRIVATE_IP',
      });
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) {
      throw new Error('Hostname could not be resolved.');
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw Object.assign(new Error('Target URL resolves to a restricted private network address.'), {
          statusCode: 400,
          code: 'BLOCKED_PRIVATE_IP',
        });
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'BLOCKED_PRIVATE_IP') throw err;
    throw Object.assign(new Error('Could not safely verify the reference URL host.'), {
      statusCode: 400,
      code: 'DNS_RESOLUTION_FAILED',
    });
  }

  return parsed;
}

export async function safeFetchUrlText(rawUrl: string): Promise<{ title: string; text: string; url: string }> {
  const safeUrl = await validateSafeExternalUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(safeUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'CozylandBot/1.0 (+https://cozyland.studio)',
        Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) {
        const redirected = new URL(location, safeUrl).toString();
        await validateSafeExternalUrl(redirected);
        const res2 = await fetch(redirected, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'User-Agent': 'CozylandBot/1.0' },
        });
        if (!res2.ok) {
          throw new Error(`Reference page returned HTTP ${res2.status}`);
        }
        const html2 = (await res2.text()).slice(0, 120000);
        return extractReadableText(html2, redirected);
      }
    }

    if (!res.ok) {
      throw new Error(`Reference page returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/') && !contentType.includes('xml') && !contentType.includes('json')) {
      throw new Error('Reference URL did not return readable text content.');
    }

    const body = (await res.text()).slice(0, 120000);
    return extractReadableText(body, safeUrl.toString());
  } finally {
    clearTimeout(timer);
  }
}

function extractReadableText(html: string, url: string): { title: string; text: string; url: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url;
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);

  return { title, text: cleaned, url };
}

export function createRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (hits.get(key) || []).filter((t) => t > cutoff);
    if (recent.length >= options.maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a few seconds before trying again.',
        code: 'RATE_LIMITED',
      });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) {
      for (const [ip, timestamps] of hits.entries()) {
        if (timestamps.every((t) => t <= cutoff)) hits.delete(ip);
      }
    }
    next();
  };
}

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'audio/webm',
  'audio/ogg',
]);

export function validateAudioBufferMagic(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 16) return false;
  const headAscii = buffer.subarray(0, 12).toString('ascii');
  // WAV: RIFF....WAVE
  if (headAscii.startsWith('RIFF') && headAscii.includes('WAVE')) return true;
  // MP3: ID3 or MPEG frame sync 0xFF 0xFB/0xF3/0xF2
  if (headAscii.startsWith('ID3')) return true;
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true;
  // FLAC: fLaC
  if (headAscii.startsWith('fLaC')) return true;
  // OGG: OggS
  if (headAscii.startsWith('OggS')) return true;
  // M4A / MP4: ftyp at offset 4
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return true;
  // WebM / Matroska: 0x1A 0x45 0xDF 0xA3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
  // Fallback if mimeType is explicitly audio/* and not obviously text/executable
  if (ALLOWED_AUDIO_MIME_TYPES.has(mimeType.toLowerCase())) {
    const snippet = buffer.subarray(0, 64).toString('utf8').trimStart();
    if (snippet.startsWith('<!') || snippet.startsWith('<html') || snippet.startsWith('#!')) {
      return false;
    }
    return true;
  }
  return false;
}
