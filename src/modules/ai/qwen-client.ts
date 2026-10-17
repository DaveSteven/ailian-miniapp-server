import { env } from '../../config/env.js';
import { getIntentCategoryOptions } from './category-context.service.js';
import { buildIntentResponseFormat } from './intent.schema.js';
import type { AiIntentResult, IntentCategoryOption } from './intent.types.js';
import { buildIntentExtractionMessages } from './prompts/intent-extraction.prompt.js';

type ChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type AiIntentExtraction = {
  result: AiIntentResult;
  model: string;
  requestId?: string;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export class AiClientError extends Error {
  constructor(
    public readonly code: 'DISABLED' | 'NOT_CONFIGURED' | 'TIMEOUT' | 'UPSTREAM' | 'INVALID_RESPONSE',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

/** Calls Qwen for one intent-extraction request without changing chat behavior. */
export async function extractIntentWithQwen(
  message: string,
  options: { categories?: IntentCategoryOption[] } = {},
): Promise<AiIntentExtraction> {
  if (!env.AI_ENABLED) {
    throw new AiClientError('DISABLED', 'AI intent extraction is disabled.');
  }
  if (!env.AI_API_KEY) {
    throw new AiClientError('NOT_CONFIGURED', 'AI_API_KEY is not configured.');
  }

  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    throw new AiClientError('INVALID_RESPONSE', 'Intent extraction requires a non-empty message.');
  }

  const categories = options.categories ?? await getIntentCategoryOptions();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: buildIntentExtractionMessages({
          message: normalizedMessage,
          categories,
        }),
        response_format: buildIntentResponseFormat(categories),
        enable_thinking: false,
        temperature: 0.1,
        max_completion_tokens: 150,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await readUpstreamError(response);
      throw new AiClientError(
        'UPSTREAM',
        `Qwen API returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
        response.status,
      );
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new AiClientError('INVALID_RESPONSE', 'Qwen API returned no message content.');
    }

    return {
      result: parseIntentResult(content, categories),
      model: payload.model || env.AI_MODEL,
      requestId: payload.id,
      latencyMs: Date.now() - startedAt,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
    };
  } catch (error) {
    if (error instanceof AiClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiClientError('TIMEOUT', `Qwen API timed out after ${env.AI_TIMEOUT_MS}ms.`);
    }

    throw new AiClientError('UPSTREAM', 'Qwen API request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

function parseIntentResult(content: string, categories: IntentCategoryOption[]): AiIntentResult {
  let value: unknown;

  try {
    value = JSON.parse(content);
  } catch {
    throw new AiClientError('INVALID_RESPONSE', 'Qwen API returned invalid JSON.');
  }

  if (!isRecord(value)) {
    throw new AiClientError('INVALID_RESPONSE', 'Qwen intent result must be an object.');
  }

  const allowedCategories = new Set(categories.map((category) => category.code));
  const intent = value.intent;
  const serviceCategory = value.serviceCategory;
  const urgency = value.urgency;
  const keywords = value.keywords;
  const confidence = value.confidence;
  const locationRequired = value.locationRequired;
  const needsClarification = value.needsClarification;
  const clarificationQuestion = value.clarificationQuestion;

  if (!isOneOf(intent, ['find_service', 'small_talk', 'unclear'])) invalidResult('intent');
  if (serviceCategory !== null && (typeof serviceCategory !== 'string' || !allowedCategories.has(serviceCategory))) {
    invalidResult('serviceCategory');
  }
  if (!isOneOf(urgency, ['low', 'normal', 'high'])) invalidResult('urgency');
  if (
    !Array.isArray(keywords)
    || keywords.length > 5
    || keywords.some((item) => typeof item !== 'string')
    || new Set(keywords).size !== keywords.length
  ) {
    invalidResult('keywords');
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) invalidResult('confidence');
  if (typeof locationRequired !== 'boolean') invalidResult('locationRequired');
  if (typeof needsClarification !== 'boolean') invalidResult('needsClarification');
  if (clarificationQuestion !== null && typeof clarificationQuestion !== 'string') {
    invalidResult('clarificationQuestion');
  }

  if (intent === 'find_service') {
    if (serviceCategory === null || !locationRequired || needsClarification || clarificationQuestion !== null) {
      invalidResult('find_service relationships');
    }
  } else if (serviceCategory !== null || locationRequired) {
    invalidResult('non-service relationships');
  }

  if (intent === 'unclear' && (!needsClarification || !clarificationQuestion)) {
    invalidResult('unclear relationships');
  }
  if (intent === 'small_talk' && (needsClarification || clarificationQuestion !== null)) {
    invalidResult('small_talk relationships');
  }

  return {
    intent,
    serviceCategory,
    urgency,
    keywords,
    confidence,
    locationRequired,
    needsClarification,
    clarificationQuestion,
  };
}

function invalidResult(field: string): never {
  throw new AiClientError('INVALID_RESPONSE', `Qwen intent result has an invalid ${field} field.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && options.includes(value);
}

async function readUpstreamError(response: Response) {
  const body = (await response.text()).slice(0, 1000);

  try {
    const value = JSON.parse(body) as unknown;
    if (!isRecord(value)) return '';

    const error = value.error;
    if (isRecord(error)) {
      const code = typeof error.code === 'string' ? error.code : '';
      const message = typeof error.message === 'string' ? error.message : '';
      return [code, message].filter(Boolean).join(' - ');
    }

    const code = typeof value.code === 'string' ? value.code : '';
    const message = typeof value.message === 'string' ? value.message : '';
    return [code, message].filter(Boolean).join(' - ');
  } catch {
    return body.replace(/\s+/g, ' ').trim();
  }
}
