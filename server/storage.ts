import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Episode, VoiceProfile } from '../src/types/podcast.ts';

const DATA_ROOT = path.resolve(process.cwd(), '.cozyland-data');
const EPISODES_DIR = path.join(DATA_ROOT, 'episodes');
const AUDIO_DIR = path.join(DATA_ROOT, 'audio');
const PROFILES_FILE = path.join(DATA_ROOT, 'voice-profiles.json');

async function ensureDirs(): Promise<void> {
  await fs.mkdir(EPISODES_DIR, { recursive: true });
  await fs.mkdir(AUDIO_DIR, { recursive: true });
}

function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned || cleaned.length > 100) {
    throw Object.assign(new Error('Invalid resource identifier.'), { statusCode: 400, code: 'INVALID_ID' });
  }
  return cleaned;
}

function confinePath(baseDir: string, fileName: string): string {
  const resolved = path.resolve(baseDir, fileName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw Object.assign(new Error('Forbidden path traversal attempt.'), { statusCode: 403, code: 'FORBIDDEN_PATH' });
  }
  return resolved;
}

export async function saveEpisode(episode: Episode): Promise<Episode> {
  await ensureDirs();
  const id = safeId(episode.id);
  const filePath = confinePath(EPISODES_DIR, `${id}.json`);
  const updated: Episode = {
    ...episode,
    id,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export async function getEpisode(id: string): Promise<Episode | null> {
  await ensureDirs();
  const cleanId = safeId(id);
  const filePath = confinePath(EPISODES_DIR, `${cleanId}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Episode;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function listEpisodes(): Promise<Episode[]> {
  await ensureDirs();
  const files = await fs.readdir(EPISODES_DIR);
  const episodes: Episode[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(confinePath(EPISODES_DIR, file), 'utf8');
      episodes.push(JSON.parse(raw) as Episode);
    } catch {
      // Ignore corrupted single file without breaking library
    }
  }
  episodes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return episodes;
}

export async function deleteEpisode(id: string): Promise<boolean> {
  await ensureDirs();
  const cleanId = safeId(id);
  const filePath = confinePath(EPISODES_DIR, `${cleanId}.json`);
  const audioPath = confinePath(AUDIO_DIR, `${cleanId}.wav`);
  let removed = false;
  try {
    await fs.unlink(filePath);
    removed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  try {
    await fs.unlink(audioPath);
  } catch {
    // Ignore missing audio
  }
  return removed;
}

export async function saveEpisodeAudio(episodeId: string, wavBuffer: Buffer): Promise<string> {
  await ensureDirs();
  const cleanId = safeId(episodeId);
  const audioPath = confinePath(AUDIO_DIR, `${cleanId}.wav`);
  await fs.writeFile(audioPath, wavBuffer);
  return `/api/audio/${cleanId}`;
}

export async function getEpisodeAudioPath(episodeId: string): Promise<string | null> {
  await ensureDirs();
  const cleanId = safeId(episodeId);
  const audioPath = confinePath(AUDIO_DIR, `${cleanId}.wav`);
  try {
    await fs.access(audioPath);
    return audioPath;
  } catch {
    return null;
  }
}

const DEFAULT_PROFILES: VoiceProfile[] = [
  {
    id: 'preset-studio-warm',
    name: 'Studio Warmth (Riya Default)',
    assignedHost: 'Riya',
    config: {
      voiceName: 'Kore',
      speed: 1.0,
      expressiveness: 'Expressive',
      energy: 'Warm',
      deliveryStyle: 'Conversational',
    },
    isCustomCalibrated: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-curious-spark',
    name: 'Curious Spark (Arjun Default)',
    assignedHost: 'Arjun',
    config: {
      voiceName: 'Puck',
      speed: 1.02,
      expressiveness: 'Expressive',
      energy: 'Upbeat',
      deliveryStyle: 'Conversational',
    },
    isCustomCalibrated: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-deep-documentary',
    name: 'Deep Documentary (Arjun)',
    assignedHost: 'Arjun',
    config: {
      voiceName: 'Charon',
      speed: 0.96,
      expressiveness: 'Balanced',
      energy: 'Relaxed',
      deliveryStyle: 'Tech Analyst',
    },
    isCustomCalibrated: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(PROFILES_FILE, 'utf8');
    const parsed = JSON.parse(raw) as VoiceProfile[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PROFILES;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.writeFile(PROFILES_FILE, JSON.stringify(DEFAULT_PROFILES, null, 2), 'utf8');
      return DEFAULT_PROFILES;
    }
    return DEFAULT_PROFILES;
  }
}

export async function saveVoiceProfile(profile: Omit<VoiceProfile, 'id' | 'createdAt'> & { id?: string }): Promise<VoiceProfile> {
  const profiles = await listVoiceProfiles();
  const id = profile.id ? safeId(profile.id) : `vp-${crypto.randomUUID().slice(0, 8)}`;
  const existingIdx = profiles.findIndex((p) => p.id === id);
  const nextProfile: VoiceProfile = {
    ...profile,
    id,
    createdAt: existingIdx >= 0 ? profiles[existingIdx].createdAt : new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    profiles[existingIdx] = nextProfile;
  } else {
    profiles.unshift(nextProfile);
  }
  await fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
  return nextProfile;
}

export async function deleteVoiceProfile(id: string): Promise<boolean> {
  const cleanId = safeId(id);
  const profiles = await listVoiceProfiles();
  const filtered = profiles.filter((p) => p.id !== cleanId);
  if (filtered.length === profiles.length) return false;
  await fs.writeFile(PROFILES_FILE, JSON.stringify(filtered, null, 2), 'utf8');
  return true;
}
