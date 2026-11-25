import { GoogleGenAI } from '@google/genai';

export const MODELS = {
  TEXT: 'gemini-4-hydrogen',
  TEXT_FALLBACK: 'gemini-3.1-flash-lite',
  TTS_PODCAST: 'gemini-3.8-flash-tts',
  TTS_PREVIEW: 'gemini-3.8-flash-lite-tts',
  TRANSCRIBE: 'gemini-3.5-transcribe',
} as const;

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error(
      'GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets.'
    ) as Error & { statusCode?: number; code?: string };
    err.statusCode = 503;
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export function isGeminiConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

export function classifyGeminiError(err: unknown): {
  statusCode: number;
  code: string;
  message: string;
  retryable: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  console.error('[Cozyland AI Error]', raw.slice(0, 400));

  if (lower.includes('missing_api_key') || lower.includes('gemini_api_key is not configured')) {
    return {
      statusCode: 503,
      code: 'MISSING_API_KEY',
      message: 'Gemini API key is not configured on the server. Please set GEMINI_API_KEY in Settings > Secrets.',
      retryable: false,
    };
  }
  if (lower.includes('api_key_invalid') || lower.includes('invalid api key') || lower.includes('400')) {
    if (lower.includes('api key')) {
      return {
        statusCode: 400,
        code: 'API_KEY_INVALID',
        message: 'The configured Gemini API key appears invalid. Please verify it in Settings > Secrets.',
        retryable: false,
      };
    }
  }
  if (lower.includes('permission_denied') || lower.includes('403')) {
    return {
      statusCode: 403,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied by Gemini API. Please check your API key permissions.',
      retryable: false,
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      statusCode: 429,
      code: 'QUOTA_EXCEEDED',
      message: 'Gemini API rate limit or quota reached. Please wait a moment and retry.',
      retryable: true,
    };
  }
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('etimedout')) {
    return {
      statusCode: 504,
      code: 'UPSTREAM_TIMEOUT',
      message: 'The AI request timed out. Your partial progress has been preserved so you can retry.',
      retryable: true,
    };
  }
  if (lower.includes('503') || lower.includes('unavailable')) {
    return {
      statusCode: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: `The AI service is temporarily busy: ${raw.slice(0, 180)}`,
      retryable: true,
    };
  }
  if (lower.includes('500') || lower.includes('internal')) {
    return {
      statusCode: 502,
      code: 'UPSTREAM_INTERNAL_ERROR',
      message: `Upstream AI request failed: ${raw.slice(0, 220)}`,
      retryable: true,
    };
  }

  return {
    statusCode: 500,
    code: 'AI_GENERATION_ERROR',
    message: raw || 'An unexpected AI generation error occurred.',
    retryable: true,
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const { retries = 2, baseDelayMs = 2500, timeoutMs = 55000, signal } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request cancelled by client');
    }
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Upstream AI call timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          if (signal) {
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('Request cancelled by client'));
              },
              { once: true }
            );
          }
        }),
      ]);
      return result;
    } catch (err) {
      lastError = err;
      const classified = classifyGeminiError(err);
      if (!classified.retryable || attempt === retries || signal?.aborted) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt) + jitter));
    }
  }
  throw lastError;
}

export async function generateTextWithFallback(
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  retryOptions: { retries?: number; baseDelayMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
) {
  const ai = getGeminiClient();
  try {
    return await withRetry(
      () =>
        ai.models.generateContent({
          ...params,
          model: MODELS.TEXT,
        }),
      { retries: 1, baseDelayMs: 1800, ...retryOptions }
    );
  } catch (err) {
    const classified = classifyGeminiError(err);
    const shouldFallback =
      !retryOptions.signal?.aborted &&
      (classified.code === 'UPSTREAM_UNAVAILABLE' ||
        classified.code === 'QUOTA_EXCEEDED' ||
        classified.code === 'UPSTREAM_TIMEOUT');
    if (!shouldFallback) {
      throw err;
    }

    const fallbackConfig = params.config ? { ...params.config } : undefined;
    if (fallbackConfig && 'thinkingConfig' in fallbackConfig) {
      delete (fallbackConfig as Record<string, unknown>).thinkingConfig;
    }

    return await withRetry(
      () =>
        ai.models.generateContent({
          ...params,
          config: fallbackConfig,
          model: MODELS.TEXT_FALLBACK,
        }),
      { retries: 1, baseDelayMs: 2000, ...retryOptions }
    );
  }
}
