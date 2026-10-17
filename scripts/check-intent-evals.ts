import {
  INTENT_EVAL_CASES,
  INTENT_EVAL_CATEGORIES,
  type IntentEvalCase,
} from '../evals/intent-cases.js';
import { buildIntentResponseFormat } from '../src/modules/ai/intent.schema.js';
import { buildIntentExtractionMessages } from '../src/modules/ai/prompts/intent-extraction.prompt.js';

const MINIMUM_CASE_COUNT = 50;
const categoryCodes = new Set(INTENT_EVAL_CATEGORIES.map((category) => category.code));
const seenIds = new Set<string>();
const errors: string[] = [];

for (const testCase of INTENT_EVAL_CASES) {
  validateCase(testCase);
}

if (INTENT_EVAL_CASES.length < MINIMUM_CASE_COUNT) {
  errors.push(`Expected at least ${MINIMUM_CASE_COUNT} cases, found ${INTENT_EVAL_CASES.length}.`);
}

if (errors.length > 0) {
  throw new Error(`Intent evaluation data is invalid:\n- ${errors.join('\n- ')}`);
}

validateModelContract();

const tagCounts = new Map<string, number>();

for (const testCase of INTENT_EVAL_CASES) {
  for (const tag of testCase.tags) {
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
}

console.log(`Validated ${INTENT_EVAL_CASES.length} intent evaluation cases.`);
console.log(
  [...tagCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, count]) => `${tag}: ${count}`)
    .join(', '),
);

function validateCase(testCase: IntentEvalCase) {
  if (!testCase.id.trim()) {
    errors.push('A case has an empty id.');
  } else if (seenIds.has(testCase.id)) {
    errors.push(`Duplicate case id: ${testCase.id}.`);
  } else {
    seenIds.add(testCase.id);
  }

  if (!testCase.message.trim()) {
    errors.push(`${testCase.id}: message is empty.`);
  }

  if (testCase.tags.length === 0) {
    errors.push(`${testCase.id}: at least one tag is required.`);
  }

  const { expected } = testCase;

  if (expected.serviceCategory !== null && !categoryCodes.has(expected.serviceCategory)) {
    errors.push(`${testCase.id}: unknown service category ${expected.serviceCategory}.`);
  }

  if (expected.intent === 'find_service') {
    if (expected.serviceCategory === null) {
      errors.push(`${testCase.id}: find_service requires a category.`);
    }
    if (!expected.locationRequired) {
      errors.push(`${testCase.id}: find_service should require location.`);
    }
    if (expected.needsClarification) {
      errors.push(`${testCase.id}: a resolved find_service case should not require clarification.`);
    }
  } else if (expected.serviceCategory !== null) {
    errors.push(`${testCase.id}: non-service intent must not select a category.`);
  }

  if (expected.intent === 'unclear' && !expected.needsClarification) {
    errors.push(`${testCase.id}: unclear intent should request clarification.`);
  }

  for (const hints of testCase.keywordHints ?? []) {
    if (hints.length === 0 || hints.some((hint) => !hint.trim())) {
      errors.push(`${testCase.id}: keyword hint groups must contain non-empty strings.`);
    }
  }
}

function validateModelContract() {
  const sampleMessage = '这是用于验证消息边界的用户输入';
  const messages = buildIntentExtractionMessages({
    message: sampleMessage,
    categories: INTENT_EVAL_CATEGORIES,
  });
  const responseFormat = buildIntentResponseFormat(INTENT_EVAL_CATEGORIES);

  if (messages.length !== 2 || messages[0]?.role !== 'system' || messages[1]?.role !== 'user') {
    throw new Error('Intent prompt must contain one system message followed by one user message.');
  }
  if (messages[0].content.includes(sampleMessage) || messages[1].content !== sampleMessage) {
    throw new Error('User input must remain isolated from the system prompt.');
  }
  for (const category of INTENT_EVAL_CATEGORIES) {
    if (!messages[0].content.includes(category.code)) {
      throw new Error(`Intent prompt is missing category code ${category.code}.`);
    }
  }
  if (responseFormat.type !== 'json_schema' || !responseFormat.json_schema.strict) {
    throw new Error('Intent response format must use strict JSON Schema output.');
  }
}
