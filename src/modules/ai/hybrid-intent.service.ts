import { env } from '../../config/env.js';
import { getIntentCategoryOptions } from './category-context.service.js';
import { AiClientError, extractIntentWithQwen } from './qwen-client.js';
import type { AiIntentResult, IntentCategoryOption, ResolvedIntent } from './intent.types.js';

const categoryRules: Array<{ code: string; keywords: string[] }> = [
  {
    code: 'pipe_unclogging',
    keywords: ['下水', '管道', '马桶', '疏通', '反水', '漏水', '地漏', '水槽'],
  },
  {
    code: 'locksmith',
    keywords: ['开锁', '换锁', '钥匙', '门锁', '锁芯', '指纹锁', '反锁', '进不了门'],
  },
  {
    code: 'appliance_repair',
    keywords: ['空调', '冰箱', '洗衣机', '热水器', '家电', '不制冷'],
  },
  {
    code: 'housekeeping',
    keywords: ['保洁', '打扫', '钟点工', '阿姨', '清洁', '家政', '开荒'],
  },
];

const highUrgencyKeywords = [
  '急', '马上', '立刻', '赶紧', '半夜', '进不了门', '被反锁', '钥匙丢', '漫出来', '漫到', '漏水', '冒烟', '焦味',
];
const lowUrgencyKeywords = ['不急', '不着急', '下个月', '月底再', '有空再'];
const possibleServiceKeywords = ['找人', '上门', '维修', '修一下', '服务', '师傅', '坏了', '处理一下'];

export type IntentTelemetryEvent = {
  source: ResolvedIntent['source'];
  intent: AiIntentResult['intent'];
  serviceCategory: string | null;
  urgency: AiIntentResult['urgency'];
  confidence: number;
  model?: string;
  requestId?: string;
  latencyMs?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostYuan: number;
  errorCode?: string;
  upstreamStatus?: number;
};

type ResolveIntentOptions = {
  categories?: IntentCategoryOption[];
  aiEnabled?: boolean;
  onTelemetry?: (event: IntentTelemetryEvent) => void;
};

export async function resolveIntent(
  message: string,
  options: ResolveIntentOptions = {},
): Promise<ResolvedIntent> {
  const categories = options.categories ?? await getIntentCategoryOptions();
  const ruleResult = extractHighConfidenceRuleIntent(message, categories);

  if (ruleResult) {
    const resolved = withResolutionMetadata(ruleResult, categories, 'rule');
    emitTelemetry(options, resolved);
    return resolved;
  }

  if (options.aiEnabled ?? env.AI_ENABLED) {
    try {
      const extraction = await extractIntentWithQwen(message, { categories });
      const result = enforceConfidenceThreshold(extraction.result);
      const resolved = withResolutionMetadata(result, categories, 'ai');
      emitTelemetry(options, resolved, {
        model: extraction.model,
        requestId: extraction.requestId,
        latencyMs: extraction.latencyMs,
        inputTokens: extraction.usage.inputTokens,
        outputTokens: extraction.usage.outputTokens,
        totalTokens: extraction.usage.totalTokens,
      });
      return resolved;
    } catch (error) {
      if (!(error instanceof AiClientError)) throw error;
      const fallback = withResolutionMetadata(buildSafeFallback(message), categories, 'fallback');
      emitTelemetry(options, fallback, {
        errorCode: error.code,
        upstreamStatus: error.status,
      });
      return fallback;
    }
  }

  const fallback = withResolutionMetadata(buildSafeFallback(message), categories, 'fallback');
  emitTelemetry(options, fallback, { errorCode: 'AI_DISABLED' });
  return fallback;
}

function extractHighConfidenceRuleIntent(
  message: string,
  categories: IntentCategoryOption[],
): AiIntentResult | null {
  const availableCodes = new Set(categories.map((category) => category.code));
  const matches = categoryRules
    .filter((rule) => availableCodes.has(rule.code))
    .map((rule) => ({
      ...rule,
      matchedKeywords: rule.keywords.filter((keyword) => message.includes(keyword)),
    }))
    .filter((rule) => rule.matchedKeywords.length > 0);

  if (matches.length !== 1) return null;

  const match = matches[0];
  return {
    intent: 'find_service',
    serviceCategory: match.code,
    urgency: detectUrgency(message),
    keywords: match.matchedKeywords.slice(0, 5),
    confidence: 0.98,
    locationRequired: true,
    needsClarification: false,
    clarificationQuestion: null,
  };
}

function detectUrgency(message: string): AiIntentResult['urgency'] {
  if (lowUrgencyKeywords.some((keyword) => message.includes(keyword))) return 'low';
  if (highUrgencyKeywords.some((keyword) => message.includes(keyword))) return 'high';
  return 'normal';
}

function enforceConfidenceThreshold(result: AiIntentResult): AiIntentResult {
  if (result.intent !== 'find_service' || result.confidence >= env.AI_CONFIDENCE_THRESHOLD) {
    return result;
  }

  return {
    intent: 'unclear',
    serviceCategory: null,
    urgency: result.urgency,
    keywords: [],
    confidence: result.confidence,
    locationRequired: false,
    needsClarification: true,
    clarificationQuestion: '请再具体说一下需要处理的物品或问题，可以吗？',
  };
}

function buildSafeFallback(message: string): AiIntentResult {
  const looksLikeServiceRequest = possibleServiceKeywords.some((keyword) => message.includes(keyword))
    || categoryRules.some((rule) => rule.keywords.some((keyword) => message.includes(keyword)));

  if (!looksLikeServiceRequest) {
    return {
      intent: 'small_talk',
      serviceCategory: null,
      urgency: 'normal',
      keywords: [],
      confidence: 0,
      locationRequired: false,
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  return {
    intent: 'unclear',
    serviceCategory: null,
    urgency: detectUrgency(message),
    keywords: [],
    confidence: 0,
    locationRequired: false,
    needsClarification: true,
    clarificationQuestion: '请再具体说一下需要处理的物品或问题，可以吗？',
  };
}

function withResolutionMetadata(
  result: AiIntentResult,
  categories: IntentCategoryOption[],
  source: ResolvedIntent['source'],
): ResolvedIntent {
  const category = categories.find((item) => item.code === result.serviceCategory);

  return {
    ...result,
    serviceCategoryName: category?.name ?? null,
    source,
  };
}

function emitTelemetry(
  options: ResolveIntentOptions,
  result: ResolvedIntent,
  details: Partial<IntentTelemetryEvent> = {},
) {
  const inputTokens = details.inputTokens ?? 0;
  const outputTokens = details.outputTokens ?? 0;
  const totalTokens = details.totalTokens ?? inputTokens + outputTokens;
  const estimatedCostYuan = (
    inputTokens * env.AI_INPUT_PRICE_PER_MILLION
    + outputTokens * env.AI_OUTPUT_PRICE_PER_MILLION
  ) / 1_000_000;

  options.onTelemetry?.({
    source: result.source,
    intent: result.intent,
    serviceCategory: result.serviceCategory,
    urgency: result.urgency,
    confidence: result.confidence,
    model: details.model,
    requestId: details.requestId,
    latencyMs: details.latencyMs,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostYuan: Number(estimatedCostYuan.toFixed(8)),
    errorCode: details.errorCode,
    upstreamStatus: details.upstreamStatus,
  });
}
