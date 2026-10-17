import { resolveIntent, type IntentTelemetryEvent } from '../ai/hybrid-intent.service.js';
import { searchMerchants } from '../search/search.service.js';

type ChatMessageInput = {
  message: string;
  location?: {
    latitude: number;
    longitude: number;
    communityName?: string;
  };
  onIntentTelemetry?: (event: IntentTelemetryEvent) => void;
};

export async function handleChatMessage(input: ChatMessageInput) {
  const intent = await resolveIntent(input.message, {
    onTelemetry: input.onIntentTelemetry,
  });

  if (intent.intent === 'small_talk') {
    return {
      intent,
      reply: '我是爱联的社区生活服务助手。你可以直接告诉我遇到的问题，比如“厨房下水堵了”或“空调不制冷”，我会帮你找附近合适的服务人员。',
      merchants: [],
    };
  }

  if (intent.intent === 'unclear' || !intent.serviceCategory) {
    return {
      intent,
      reply: intent.clarificationQuestion
        || '我还没完全听明白你要找哪类服务，可以再具体说一下需要处理的物品或问题吗？',
      merchants: [],
    };
  }

  const merchants = await searchMerchants(intent, input.location);
  const categoryName = intent.serviceCategoryName || '生活服务';
  const community = input.location?.communityName ?? (input.location ? '当前位置附近' : '服务范围内');

  return {
    intent,
    reply:
      merchants.length > 0
        ? `我按“${categoryName}”帮你在${community}筛了附近能服务的师傅，优先看距离、评分、是否现在可联系和价格透明度。`
        : `我识别到你需要“${categoryName}”，但当前商户库里还没有合适结果。`,
    merchants,
  };
}
