import { INTENT_EVAL_CATEGORIES } from '../evals/intent-cases.js';
import { extractIntentWithQwen } from '../src/modules/ai/qwen-client.js';

const message = process.argv.slice(2).join(' ').trim() || '厨房下水堵了，很急';
const extraction = await extractIntentWithQwen(message, {
  categories: INTENT_EVAL_CATEGORIES,
});

console.log(JSON.stringify({
  input: message,
  result: extraction.result,
  model: extraction.model,
  requestId: extraction.requestId,
  latencyMs: extraction.latencyMs,
  usage: extraction.usage,
}, null, 2));
