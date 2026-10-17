export type ServiceCategory =
  | 'pipe_unclogging'
  | 'locksmith'
  | 'appliance_repair'
  | 'housekeeping'
  | 'unknown';

export type ServiceIntent = {
  intent: 'find_service' | 'small_talk';
  serviceCategory: ServiceCategory;
  urgency: 'low' | 'normal' | 'high';
  keywords: string[];
  locationRequired: boolean;
};

/** A service category supplied to the model from the application database. */
export type IntentCategoryOption = {
  code: string;
  name: string;
  description?: string | null;
};

/** The complete input boundary for one AI intent-extraction request. */
export type AiIntentInput = {
  message: string;
  categories: IntentCategoryOption[];
};

/**
 * The model-facing result. All fields are required so strict structured output
 * can be used without guessing whether an omitted property has meaning.
 */
export type AiIntentResult = {
  intent: 'find_service' | 'small_talk' | 'unclear';
  serviceCategory: string | null;
  urgency: 'low' | 'normal' | 'high';
  keywords: string[];
  confidence: number;
  locationRequired: boolean;
  needsClarification: boolean;
  clarificationQuestion: string | null;
};

export type ResolvedIntent = AiIntentResult & {
  serviceCategoryName: string | null;
  source: 'rule' | 'ai' | 'fallback';
};
