import { pool } from '../../db/client.js';
import type { IntentCategoryOption } from './intent.types.js';

export const INTENT_CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

type CategoryRow = {
  code: string;
  name: string;
  description: string | null;
};

type CategoryCache = {
  categories: IntentCategoryOption[];
  expiresAt: number;
};

let categoryCache: CategoryCache | null = null;
let categoryLoad: Promise<IntentCategoryOption[]> | null = null;

/**
 * Returns the categories that the intent model is allowed to select.
 * Concurrent cache misses share one database query.
 */
export async function getIntentCategoryOptions(options: { forceRefresh?: boolean } = {}) {
  const now = Date.now();

  if (!options.forceRefresh && categoryCache && categoryCache.expiresAt > now) {
    return cloneCategories(categoryCache.categories);
  }

  if (categoryLoad) {
    return cloneCategories(await categoryLoad);
  }

  categoryLoad = loadIntentCategoryOptions();

  try {
    const categories = await categoryLoad;
    categoryCache = {
      categories,
      expiresAt: Date.now() + INTENT_CATEGORY_CACHE_TTL_MS,
    };

    return cloneCategories(categories);
  } finally {
    categoryLoad = null;
  }
}

/** Invalidates cached data after an administrator changes a category. */
export function invalidateIntentCategoryCache() {
  categoryCache = null;
}

async function loadIntentCategoryOptions(): Promise<IntentCategoryOption[]> {
  const result = await pool.query<CategoryRow>(
    `SELECT code, name, description
     FROM service_categories
     ORDER BY created_at ASC`,
  );

  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
  }));
}

function cloneCategories(categories: IntentCategoryOption[]) {
  return categories.map((category) => ({ ...category }));
}
