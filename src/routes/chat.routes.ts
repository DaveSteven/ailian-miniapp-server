import type { FastifyInstance } from 'fastify';
import { handleChatMessage } from '../modules/chat/chat.service.js';
import { AppError } from '../plugins/error-handler.js';
import { requireUser } from '../modules/auth/user-auth.service.js';

type ChatMessageBody = {
  message?: string;
  location?: {
    latitude: number;
    longitude: number;
    communityName?: string;
  };
};

const MAX_CHAT_MESSAGE_LENGTH = 2000;

export async function registerChatRoutes(app: FastifyInstance) {
  app.post<{ Body: ChatMessageBody }>('/message', async (request) => {
    await requireUser(request);
    const message = request.body.message?.trim();

    if (!message) {
      throw new AppError(400, 'MESSAGE_REQUIRED', '请先告诉我你遇到了什么生活问题。');
    }
    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new AppError(400, 'MESSAGE_TOO_LONG', `需求描述不能超过 ${MAX_CHAT_MESSAGE_LENGTH} 个字。`);
    }

    const location = validateLocation(request.body.location);

    return handleChatMessage({
      message,
      location,
      onIntentTelemetry: (event) => {
        const logData = { intentTelemetry: event };
        if (event.errorCode && event.errorCode !== 'AI_DISABLED') {
          request.log.warn(logData, 'AI intent extraction fell back');
        } else {
          request.log.info(logData, 'Intent extraction completed');
        }
      },
    });
  });
}

function validateLocation(location: ChatMessageBody['location']) {
  if (location === undefined) return undefined;

  if (
    !isCoordinate(location.latitude, -90, 90)
    || !isCoordinate(location.longitude, -180, 180)
  ) {
    throw new AppError(400, 'LOCATION_INVALID', '当前位置无效，请重新获取定位后再试。');
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    communityName: location.communityName?.trim().slice(0, 100) || undefined,
  };
}

function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}
