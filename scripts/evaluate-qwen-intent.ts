import {
  INTENT_EVAL_CASES,
  INTENT_EVAL_CATEGORIES,
  type IntentEvalCase,
} from '../evals/intent-cases.js';
import { extractIntentWithQwen, type AiIntentExtraction } from '../src/modules/ai/qwen-client.js';

const CONCURRENCY = 5;
const MINIMUM_ACCURACY = 0.9;
const requestedIds = new Set(process.argv.slice(2));
const selectedCases = requestedIds.size > 0
  ? INTENT_EVAL_CASES.filter((testCase) => requestedIds.has(testCase.id))
  : INTENT_EVAL_CASES;
const queue = [...selectedCases];
const outcomes: EvalOutcome[] = [];

if (requestedIds.size > 0 && selectedCases.length !== requestedIds.size) {
  const knownIds = new Set(selectedCases.map((testCase) => testCase.id));
  const missingIds = [...requestedIds].filter((id) => !knownIds.has(id));
  throw new Error(`Unknown intent evaluation case ids: ${missingIds.join(', ')}`);
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorker()));

outcomes.sort((left, right) => left.testCase.id.localeCompare(right.testCase.id));

const completed = outcomes.filter((outcome) => outcome.extraction);
const passed = completed.filter((outcome) => outcome.mismatches.length === 0);
const failed = outcomes.filter((outcome) => outcome.error || outcome.mismatches.length > 0);
const keywordWarnings = outcomes.filter((outcome) => outcome.keywordWarnings.length > 0);
const usage = completed.reduce(
  (total, outcome) => ({
    inputTokens: total.inputTokens + (outcome.extraction?.usage.inputTokens ?? 0),
    outputTokens: total.outputTokens + (outcome.extraction?.usage.outputTokens ?? 0),
    totalTokens: total.totalTokens + (outcome.extraction?.usage.totalTokens ?? 0),
    latencyMs: total.latencyMs + (outcome.extraction?.latencyMs ?? 0),
  }),
  { inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 },
);
const accuracy = outcomes.length > 0 ? passed.length / outcomes.length : 0;

console.log(JSON.stringify({
  cases: outcomes.length,
  passed: passed.length,
  failed: failed.length,
  accuracy: Number(accuracy.toFixed(4)),
  keywordWarnings: keywordWarnings.length,
  averageLatencyMs: completed.length > 0 ? Math.round(usage.latencyMs / completed.length) : 0,
  usage: {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  },
}, null, 2));

for (const outcome of failed) {
  console.log(JSON.stringify({
    id: outcome.testCase.id,
    input: outcome.testCase.message,
    expected: outcome.testCase.expected,
    actual: outcome.extraction?.result,
    mismatches: outcome.mismatches,
    keywordWarnings: outcome.keywordWarnings,
    error: outcome.error,
  }, null, 2));
}

if (accuracy < MINIMUM_ACCURACY || outcomes.some((outcome) => outcome.error)) {
  process.exitCode = 1;
}

async function runWorker() {
  while (queue.length > 0) {
    const testCase = queue.shift();
    if (!testCase) return;

    try {
      const extraction = await extractIntentWithQwen(testCase.message, {
        categories: INTENT_EVAL_CATEGORIES,
      });
      outcomes.push({
        testCase,
        extraction,
        ...compareExpected(testCase, extraction),
      });
    } catch (error) {
      outcomes.push({
        testCase,
        mismatches: [],
        keywordWarnings: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function compareExpected(testCase: IntentEvalCase, extraction: AiIntentExtraction) {
  const mismatches: string[] = [];
  const keywordWarnings: string[] = [];
  const actual = extraction.result;

  for (const field of [
    'intent',
    'serviceCategory',
    'urgency',
    'locationRequired',
    'needsClarification',
  ] as const) {
    if (actual[field] !== testCase.expected[field]) {
      mismatches.push(`${field}: expected ${String(testCase.expected[field])}, got ${String(actual[field])}`);
    }
  }

  if (testCase.keywordHints && actual.intent === 'find_service') {
    const missedGroups = testCase.keywordHints.filter(
      (group) => !group.some((hint) => actual.keywords.some((keyword) => keyword.includes(hint))),
    );
    if (missedGroups.length > 0) {
      keywordWarnings.push(`keywords missed hints: ${JSON.stringify(missedGroups)}`);
    }
  }

  return { mismatches, keywordWarnings };
}

type EvalOutcome = {
  testCase: IntentEvalCase;
  extraction?: AiIntentExtraction;
  mismatches: string[];
  keywordWarnings: string[];
  error?: string;
};
