import { INTENT_EVAL_CATEGORIES } from '../evals/intent-cases.js';
import {
  resolveIntent,
  type IntentTelemetryEvent,
} from '../src/modules/ai/hybrid-intent.service.js';

const cases = [
  {
    message: '厨房下水堵了，很急',
    expected: { intent: 'find_service', category: 'pipe_unclogging', urgency: 'high', source: 'rule' },
  },
  {
    message: '月底搬家前做个深度清洁，不着急',
    expected: { intent: 'find_service', category: 'housekeeping', urgency: 'low', source: 'rule' },
  },
  {
    message: '马桶堵了，空调也不凉，先找哪个都行',
    expected: { intent: 'unclear', category: null, urgency: 'normal', source: 'fallback' },
  },
  {
    message: '你好',
    expected: { intent: 'small_talk', category: null, urgency: 'normal', source: 'fallback' },
  },
] as const;

for (const testCase of cases) {
  const telemetry: IntentTelemetryEvent[] = [];
  const actual = await resolveIntent(testCase.message, {
    categories: INTENT_EVAL_CATEGORIES,
    aiEnabled: false,
    onTelemetry: (event) => telemetry.push(event),
  });

  if (
    actual.intent !== testCase.expected.intent
    || actual.serviceCategory !== testCase.expected.category
    || actual.urgency !== testCase.expected.urgency
    || actual.source !== testCase.expected.source
  ) {
    throw new Error(`Hybrid intent check failed: ${JSON.stringify({ testCase, actual })}`);
  }

  if (
    telemetry.length !== 1
    || telemetry[0].source !== actual.source
    || telemetry[0].totalTokens !== 0
    || telemetry[0].estimatedCostYuan !== 0
    || Object.values(telemetry[0]).includes(testCase.message)
  ) {
    throw new Error(`Hybrid telemetry check failed: ${JSON.stringify({ testCase, telemetry })}`);
  }
}

console.log(`Validated ${cases.length} hybrid rule and fallback cases.`);
