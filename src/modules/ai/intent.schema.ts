import type { IntentCategoryOption } from './intent.types.js';

export const INTENT_SCHEMA_NAME = 'service_intent';
export const MAX_INTENT_KEYWORDS = 5;
export const MAX_CLARIFICATION_QUESTION_LENGTH = 80;

type JsonSchema = Record<string, unknown>;

/**
 * Builds the strict schema sent to the model. Category codes are injected from
 * the database so the model cannot invent a category that the search layer
 * does not understand.
 */
export function buildIntentResultSchema(categories: IntentCategoryOption[]): JsonSchema {
  const categoryCodes = [...new Set(categories.map((category) => category.code.trim()).filter(Boolean))];

  if (categoryCodes.length === 0) {
    throw new Error('At least one service category is required to build the intent schema.');
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: {
        type: 'string',
        enum: ['find_service', 'small_talk', 'unclear'],
        description: 'The user request type.',
      },
      serviceCategory: {
        anyOf: [
          {
            type: 'string',
            enum: categoryCodes,
          },
          { type: 'null' },
        ],
        description: 'A code from the supplied service categories, or null when uncertain.',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'normal', 'high'],
        description: 'Urgency explicitly supported by the user message.',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        maxItems: MAX_INTENT_KEYWORDS,
        description: 'Short search terms copied or normalized from the user request.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence in the selected intent and service category.',
      },
      locationRequired: {
        type: 'boolean',
        description: 'Whether location is required to fulfil this request.',
      },
      needsClarification: {
        type: 'boolean',
        description: 'Whether one follow-up question is required before merchant search.',
      },
      clarificationQuestion: {
        anyOf: [
          {
            type: 'string',
            maxLength: MAX_CLARIFICATION_QUESTION_LENGTH,
          },
          { type: 'null' },
        ],
        description: 'One concise follow-up question, or null when no clarification is needed.',
      },
    },
    required: [
      'intent',
      'serviceCategory',
      'urgency',
      'keywords',
      'confidence',
      'locationRequired',
      'needsClarification',
      'clarificationQuestion',
    ],
  };
}

/** OpenAI-compatible response_format payload accepted by Qwen structured output. */
export function buildIntentResponseFormat(categories: IntentCategoryOption[]) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: INTENT_SCHEMA_NAME,
      strict: true,
      schema: buildIntentResultSchema(categories),
    },
  };
}
