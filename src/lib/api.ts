import type { GenerationProgressEvent } from '../types/podcast';

export class ApiError extends Error {
  status: number;
  code: string;
  isHtmlResponse: boolean;

  constructor(message: string, status = 500, code = 'API_ERROR', isHtmlResponse = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.isHtmlResponse = isHtmlResponse;
  }
}

async function parseSafeJson<T>(response: Response): Promise<T> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text();
  const trimmed = rawText.trimStart();

  const looksLikeHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html');

  if (looksLikeHtml) {
    throw new ApiError(
      'The server returned an HTML page instead of JSON. Ensure the Cozyland Express backend is running and the API route is configured.',
      response.status || 502,
      'HTML_INSTEAD_OF_JSON',
      true
    );
  }

  let parsed: Record<string, unknown> | null = null;
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new ApiError(
        `Invalid JSON response from server (HTTP ${response.status}).`,
        response.status || 500,
        'INVALID_JSON_RESPONSE'
      );
    }
  }

  if (!response.ok) {
    const errMsg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      `Request failed with status HTTP ${response.status}.`;
    const errCode = (parsed && typeof parsed.code === 'string' && parsed.code) || 'HTTP_ERROR';
    throw new ApiError(errMsg, response.status, errCode);
  }

  return (parsed ?? {}) as T;
}

export async function apiJson<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 45000, signal: externalSignal, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const headers = new Headers(fetchOpts.headers);
    if (!(fetchOpts.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });
    return await parseSafeJson<T>(response);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw new ApiError('Request cancelled.', 499, 'REQUEST_CANCELLED');
      }
      throw new ApiError('Request timed out. Please try again.', 504, 'REQUEST_TIMEOUT');
    }
    throw new ApiError(
      err instanceof Error ? err.message : 'Network error connecting to Cozyland backend.',
      0,
      'NETWORK_ERROR'
    );
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function streamSse(
  url: string,
  body: unknown,
  onEvent: (evt: GenerationProgressEvent) => void,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<void> {
  const { timeoutMs = 180000, signal: externalSignal } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || !contentType.includes('text/event-stream')) {
      await parseSafeJson(response);
      throw new ApiError('Streaming endpoint did not return an event stream.', response.status, 'BAD_SSE_RESPONSE');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ApiError('Browser does not support streaming response bodies.', 500, 'STREAM_UNSUPPORTED');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const seenEventFingerprints = new Set<string>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';

      for (const frame of frames) {
        if (!frame.trim()) continue;
        const lines = frame.split(/\r?\n/);
        let eventName = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (dataLines.length === 0) continue;
        const rawData = dataLines.join('\n');
        const fingerprint = `${eventName}:${rawData.slice(0, 160)}:${rawData.length}`;
        if (eventName === 'dialogue_line' && seenEventFingerprints.has(fingerprint)) {
          continue;
        }
        seenEventFingerprints.add(fingerprint);

        try {
          const parsed = JSON.parse(rawData) as GenerationProgressEvent;
          onEvent(parsed);
        } catch {
          // Ignore malformed keepalive comments
        }
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw new ApiError('Generation cancelled.', 499, 'REQUEST_CANCELLED');
      }
      throw new ApiError('Streaming connection timed out.', 504, 'STREAM_TIMEOUT');
    }
    throw new ApiError(
      err instanceof Error ? err.message : 'Lost connection to live generation stream.',
      0,
      'STREAM_NETWORK_ERROR'
    );
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
