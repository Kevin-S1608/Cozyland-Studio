import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { classifyGeminiError, isGeminiConfigured } from './server/ai.ts';
import {
  analyzeAuthorizedVoiceSample,
  createNewEpisodeShell,
  runGroundedEpisodeChat,
  runStageA,
  runStageD,
  runUnifiedStageAB,
  runVoicePreview,
} from './server/podcastPipeline.ts';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  ChatRequestSchema,
  createRateLimiter,
  sanitizeText,
  StageARequestSchema,
  StageBRequestSchema,
  StageDRequestSchema,
  validateAudioBufferMagic,
  VoicePreviewSchema,
  VoiceProfileSaveSchema,
} from './server/security.ts';
import {
  deleteEpisode,
  deleteVoiceProfile,
  getEpisode,
  getEpisodeAudioPath,
  listEpisodes,
  listVoiceProfiles,
  saveEpisode,
  saveVoiceProfile,
} from './server/storage.ts';
import type { GenerationProgressEvent, HostVoiceConfig } from './src/types/podcast.ts';

const PORT = Number(process.env.PORT) || 3000;

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = new Set(['.wav', '.mp3', '.m4a', '.flac', '.webm', '.ogg']);
    if (ALLOWED_AUDIO_MIME_TYPES.has(file.mimetype.toLowerCase()) || allowedExt.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported audio format. Please upload WAV, MP3, M4A, or FLAC.'));
    }
  },
});

function sendSseEvent(res: Response, event: GenerationProgressEvent): void {
  if (res.writableEnded) return;
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  // Request ID & basic security headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    (req as Request & { requestId?: string }).requestId = requestId;
    next();
  });

  const apiLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 45 });
  const api = express.Router();

  // Ensure every response from /api sets JSON unless explicitly streaming SSE/audio
  api.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'cozyland-studio',
      geminiConfigured: isGeminiConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  api.post('/stage-a', apiLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const parsed = StageARequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid request payload.',
          code: 'VALIDATION_ERROR',
        });
      }
      const result = await runStageA({
        ...parsed.data,
        referenceUrl: parsed.data.referenceUrl || undefined,
        signal: controller.signal,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  api.post('/stage-b', apiLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const parsed = StageBRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid stage B payload.',
          code: 'VALIDATION_ERROR',
        });
      }

      const data = parsed.data;
      const voiceConfig = data.voiceConfig || DEFAULT_VOICE_CONFIG;
      const stageAB = await runUnifiedStageAB({
        topicInput: data.topicInput,
        referenceUrl: data.referenceUrl || undefined,
        language: data.language,
        duration: data.duration,
        style: data.style,
        existingPlan: data.plan,
        voiceConfig,
        signal: controller.signal,
      });

      const episode = await saveEpisode(
        createNewEpisodeShell({
          topicInput: data.topicInput,
          referenceUrl: data.referenceUrl || undefined,
          plan: stageAB.plan,
          dialogue: stageAB.dialogue,
          conclusion: stageAB.conclusion,
          qcReport: stageAB.qcReport,
          scene3D: stageAB.scene3D,
          coverSpec: stageAB.coverSpec,
          voiceConfig,
        })
      );

      res.json({ episode });
    } catch (err) {
      next(err);
    }
  });

  api.post('/stage-b-stream', apiLimiter, async (req: Request, res: Response) => {
    const parsed = StageBRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid streaming request payload.',
        code: 'VALIDATION_ERROR',
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const data = parsed.data;
      const voiceConfig = data.voiceConfig || DEFAULT_VOICE_CONFIG;
      const stageAB = await runUnifiedStageAB({
        topicInput: data.topicInput,
        referenceUrl: data.referenceUrl || undefined,
        language: data.language,
        duration: data.duration,
        style: data.style,
        existingPlan: data.plan,
        voiceConfig,
        signal: controller.signal,
        onEvent: (evt) => sendSseEvent(res, evt),
      });

      const episode = await saveEpisode(
        createNewEpisodeShell({
          topicInput: data.topicInput,
          referenceUrl: data.referenceUrl || undefined,
          plan: stageAB.plan,
          dialogue: stageAB.dialogue,
          conclusion: stageAB.conclusion,
          qcReport: stageAB.qcReport,
          scene3D: stageAB.scene3D,
          coverSpec: stageAB.coverSpec,
          voiceConfig,
        })
      );

      sendSseEvent(res, {
        type: 'done',
        episode,
        message: 'Script, quality review, artwork spec, and 3D explainer ready.',
      });
    } catch (err) {
      const classified = classifyGeminiError(err);
      sendSseEvent(res, {
        type: 'error',
        error: classified.message,
        code: classified.code,
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  api.post('/stage-d', apiLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const parsed = StageDRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid audio generation payload.',
          code: 'VALIDATION_ERROR',
        });
      }

      const existing = await getEpisode(parsed.data.episodeId);
      if (!existing) {
        return res.status(404).json({
          error: 'Episode not found. Generate the episode script first.',
          code: 'EPISODE_NOT_FOUND',
        });
      }

      const updatedEpisode = await runStageD({
        episode: {
          ...existing,
          voiceConfig: parsed.data.voiceConfig,
          dialogue: parsed.data.turns.map((t) => ({
            ...t,
            startTimeSec: 0,
            endTimeSec: 0,
            durationSec: 0,
            audioStatus: 'pending',
          })),
        },
        signal: controller.signal,
      });

      res.json({ episode: updatedEpisode });
    } catch (err) {
      next(err);
    }
  });

  api.post('/stage-d-stream', apiLimiter, async (req: Request, res: Response) => {
    const parsed = StageDRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid audio stream payload.',
        code: 'VALIDATION_ERROR',
      });
    }

    const existing = await getEpisode(parsed.data.episodeId);
    if (!existing) {
      return res.status(404).json({
        error: 'Episode not found. Generate the episode script first.',
        code: 'EPISODE_NOT_FOUND',
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      sendSseEvent(res, {
        type: 'stage',
        stage: 'audio_hosts',
        message: 'Generating spoken host audio segments for Riya and Arjun...',
      });

      const updatedEpisode = await runStageD({
        episode: {
          ...existing,
          voiceConfig: parsed.data.voiceConfig,
          dialogue: parsed.data.turns.map((t) => ({
            ...t,
            startTimeSec: 0,
            endTimeSec: 0,
            durationSec: 0,
            audioStatus: 'pending',
          })),
        },
        signal: controller.signal,
        onProgress: (completed, total, message) => {
          sendSseEvent(res, {
            type: 'audio_progress',
            stage: completed === total ? 'audio_combining' : 'audio_hosts',
            completedSegments: completed,
            totalSegments: total,
            message,
          });
        },
      });

      sendSseEvent(res, {
        type: 'done',
        stage: 'finalizing',
        episode: updatedEpisode,
        message: 'Podcast audio master ready!',
      });
    } catch (err) {
      const classified = classifyGeminiError(err);
      sendSseEvent(res, {
        type: 'error',
        error: classified.message,
        code: classified.code,
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  api.get('/audio/:episodeId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audioPath = await getEpisodeAudioPath(String(req.params.episodeId));
      if (!audioPath) {
        return res.status(404).json({ error: 'Audio file not found.', code: 'AUDIO_NOT_FOUND' });
      }

      const stat = fs.statSync(audioPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="cozyland-${req.params.episodeId}.wav"`);
      }

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        if (Number.isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
          return res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        }
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'audio/wav',
        });
        fs.createReadStream(audioPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'audio/wav',
        });
        fs.createReadStream(audioPath).pipe(res);
      }
    } catch (err) {
      next(err);
    }
  });

  api.get('/episodes', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const episodes = await listEpisodes();
      res.json({ episodes });
    } catch (err) {
      next(err);
    }
  });

  api.get('/episodes/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const episode = await getEpisode(String(req.params.id));
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found.', code: 'EPISODE_NOT_FOUND' });
      }
      res.json({ episode });
    } catch (err) {
      next(err);
    }
  });

  api.patch('/episodes/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const episode = await getEpisode(String(req.params.id));
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found.', code: 'EPISODE_NOT_FOUND' });
      }
      const title = typeof req.body.title === 'string' ? sanitizeText(req.body.title).slice(0, 180) : undefined;
      const coverSpec = req.body.coverSpec && typeof req.body.coverSpec === 'object' ? req.body.coverSpec : undefined;
      const coverImageDataUrl =
        typeof req.body.coverImageDataUrl === 'string' && req.body.coverImageDataUrl.startsWith('data:image/')
          ? req.body.coverImageDataUrl.slice(0, 1_500_000)
          : undefined;

      const updated = await saveEpisode({
        ...episode,
        plan: title ? { ...episode.plan, title } : episode.plan,
        coverSpec: coverSpec ? { ...episode.coverSpec, ...coverSpec } : episode.coverSpec,
        coverImageDataUrl: coverImageDataUrl ?? episode.coverImageDataUrl,
      });
      res.json({ episode: updated });
    } catch (err) {
      next(err);
    }
  });

  api.delete('/episodes/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteEpisode(String(req.params.id));
      if (!deleted) {
        return res.status(404).json({ error: 'Episode not found.', code: 'EPISODE_NOT_FOUND' });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.post('/chat', apiLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid chat request.',
          code: 'VALIDATION_ERROR',
        });
      }
      const episode = await getEpisode(parsed.data.episodeId);
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found.', code: 'EPISODE_NOT_FOUND' });
      }
      const { answer, groundedSources } = await runGroundedEpisodeChat(episode, parsed.data.question);
      const now = new Date().toISOString();
      const userMsg = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'user' as const,
        content: sanitizeText(parsed.data.question),
        createdAt: now,
      };
      const assistantMsg = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant' as const,
        content: answer,
        createdAt: new Date().toISOString(),
        groundedSources,
      };
      const updated = await saveEpisode({
        ...episode,
        chatHistory: [...(episode.chatHistory || []), userMsg, assistantMsg],
      });
      res.json({ userMsg, assistantMsg, episode: updated });
    } catch (err) {
      next(err);
    }
  });

  api.post('/voice/preview', apiLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = VoicePreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid voice preview payload.',
          code: 'VALIDATION_ERROR',
        });
      }
      const preview = await runVoicePreview(parsed.data);
      res.json(preview);
    } catch (err) {
      next(err);
    }
  });

  api.get('/voice/profiles', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const profiles = await listVoiceProfiles();
      res.json({ profiles });
    } catch (err) {
      next(err);
    }
  });

  api.post('/voice/profile', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = VoiceProfileSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid voice profile payload.',
          code: 'VALIDATION_ERROR',
        });
      }
      const profile = await saveVoiceProfile(parsed.data);
      res.json({ profile });
    } catch (err) {
      next(err);
    }
  });

  api.delete('/voice/profile/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteVoiceProfile(String(req.params.id));
      if (!deleted) {
        return res.status(404).json({ error: 'Voice profile not found.', code: 'PROFILE_NOT_FOUND' });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.post(
    '/voice/import',
    apiLimiter,
    upload.single('audio'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const consentConfirmed = req.body.consentConfirmed === 'true' || req.body.consentConfirmed === true;
        if (!consentConfirmed) {
          return res.status(400).json({
            error: 'Explicit voice authorization consent is required before analyzing a voice recording.',
            code: 'CONSENT_REQUIRED',
          });
        }
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({
            error: 'Please upload a valid WAV, MP3, M4A, or FLAC audio recording.',
            code: 'NO_AUDIO_FILE',
          });
        }
        if (!validateAudioBufferMagic(req.file.buffer, req.file.mimetype)) {
          return res.status(400).json({
            error: 'The uploaded file failed audio signature validation.',
            code: 'INVALID_AUDIO_FILE',
          });
        }

        const assignedHost = req.body.assignedHost === 'Arjun' ? 'Arjun' : 'Riya';
        const profileName = sanitizeText(String(req.body.profileName || `${assignedHost} Custom Calibrated`)).slice(0, 80);
        const durationSec = Math.max(0, Number(req.body.durationSec) || 0);

        const analysis = await analyzeAuthorizedVoiceSample({
          audioBuffer: req.file.buffer,
          mimeType: req.file.mimetype || 'audio/wav',
          assignedHost,
        });

        const savedProfile = await saveVoiceProfile({
          name: profileName,
          assignedHost,
          config: {
            voiceName: analysis.recommendedVoiceName,
            speed: analysis.recommendedSpeed,
            expressiveness: 'Expressive',
            energy: analysis.recommendedEnergy,
            deliveryStyle: 'Conversational',
            calibrationNote: analysis.calibrationNote,
          },
          isCustomCalibrated: true,
          calibrationSummary: analysis.calibrationSummary,
          consentConfirmed: true,
          sampleDurationSec: durationSec,
        });

        res.json({
          profile: savedProfile,
          transcript: analysis.transcript,
          cloningCapabilityNote:
            'Gemini TTS generates new speech using calibrated studio voices rather than direct raw-audio voice cloning. Your sample was analyzed in memory to match vocal cadence and timbre, then discarded immediately.',
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Explicit JSON 404 catch-all for /api so unknown API routes NEVER fall through to HTML
  api.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'API_ROUTE_NOT_FOUND',
    });
  });

  app.use('/api', api);

  // Centralized error handler returning structured JSON
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      return next(err);
    }
    const requestId = (req as Request & { requestId?: string }).requestId;
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'Audio file exceeds 10 MB limit.' : err.message,
        code: 'UPLOAD_ERROR',
        requestId,
      });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    const code = (err as { code?: string }).code;
    if (statusCode && code) {
      return res.status(statusCode).json({
        error: (err as Error).message,
        code,
        requestId,
      });
    }
    const classified = classifyGeminiError(err);
    res.status(classified.statusCode).json({
      error: classified.message,
      code: classified.code,
      requestId,
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cozyland Studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Cozyland server:', err);
  process.exit(1);
});
