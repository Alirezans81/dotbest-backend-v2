import { prisma } from "@/lib/prisma";
import { addMinutes } from "@/lib/time";
import { ConversationActorType } from "@prisma/client";
import { HairdresserState, CustomerState } from "./states";
import type { BotPlatform } from "./telegram/client";

const SESSION_TTL_MINUTES = 30;

export interface Session {
  id: string;
  actorType: ConversationActorType;
  platform: string;
  hairdresserId: string | null;
  customerId: string | null;
  telegramChatId: string;
  state: string;
  payload: Record<string, unknown>;
  expiresAt: Date;
}

export async function getOrCreateHairdresserSession(
  telegramChatId: string,
  hairdresserId?: string,
  platform: BotPlatform = "TELEGRAM"
): Promise<Session> {
  const existing = await prisma.conversationSession.findUnique({
    where: { telegramChatId },
  });

  const now = new Date();
  const expiresAt = addMinutes(now, SESSION_TTL_MINUTES);

  if (existing) {
    const isExpired = existing.expiresAt < now;
    if (!isExpired) {
      await prisma.conversationSession.update({
        where: { id: existing.id },
        data: { lastInteractionAt: now, expiresAt, platform },
      });
      return { ...existing, platform, payload: existing.payload as Record<string, unknown> };
    }
    await prisma.conversationSession.update({
      where: { id: existing.id },
      data: { state: HairdresserState.IDLE, payload: {}, expiresAt, lastInteractionAt: now, platform },
    });
    return { ...existing, platform, state: HairdresserState.IDLE, payload: {}, expiresAt };
  }

  const session = await prisma.conversationSession.create({
    data: {
      actorType: ConversationActorType.HAIRDRESSER,
      platform,
      hairdresserId: hairdresserId ?? null,
      telegramChatId,
      state: HairdresserState.IDLE,
      payload: {},
      expiresAt,
    },
  });

  return { ...session, payload: {} };
}

export async function getOrCreateCustomerSession(
  telegramChatId: string,
  customerId?: string,
  platform: BotPlatform = "TELEGRAM"
): Promise<Session> {
  const existing = await prisma.conversationSession.findUnique({
    where: { telegramChatId },
  });

  const now = new Date();
  const expiresAt = addMinutes(now, SESSION_TTL_MINUTES);

  if (existing) {
    const isExpired = existing.expiresAt < now;
    if (!isExpired) {
      await prisma.conversationSession.update({
        where: { id: existing.id },
        data: { lastInteractionAt: now, expiresAt, platform },
      });
      return { ...existing, platform, payload: existing.payload as Record<string, unknown> };
    }
    await prisma.conversationSession.update({
      where: { id: existing.id },
      data: { state: CustomerState.IDLE, payload: {}, expiresAt, lastInteractionAt: now, platform },
    });
    return { ...existing, platform, state: CustomerState.IDLE, payload: {}, expiresAt };
  }

  const session = await prisma.conversationSession.create({
    data: {
      actorType: ConversationActorType.CUSTOMER,
      platform,
      customerId: customerId ?? null,
      telegramChatId,
      state: CustomerState.IDLE,
      payload: {},
      expiresAt,
    },
  });

  return { ...session, payload: {} };
}

export async function updateSession(
  telegramChatId: string,
  state: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const now = new Date();
  const expiresAt = addMinutes(now, SESSION_TTL_MINUTES);
  await prisma.conversationSession.update({
    where: { telegramChatId },
    data: {
      state,
      ...(payload !== undefined ? { payload } : {}),
      expiresAt,
      lastInteractionAt: now,
    },
  });
}

export async function mergeSessionPayload(
  telegramChatId: string,
  partialPayload: Record<string, unknown>
): Promise<void> {
  const session = await prisma.conversationSession.findUnique({
    where: { telegramChatId },
  });
  if (!session) return;
  const current = (session.payload as Record<string, unknown>) ?? {};
  await prisma.conversationSession.update({
    where: { telegramChatId },
    data: { payload: { ...current, ...partialPayload } },
  });
}

export async function clearSession(telegramChatId: string, actorType: ConversationActorType): Promise<void> {
  const idleState = actorType === ConversationActorType.HAIRDRESSER
    ? HairdresserState.IDLE
    : CustomerState.IDLE;
  await updateSession(telegramChatId, idleState, {});
}

export async function linkHairdresserToSession(telegramChatId: string, hairdresserId: string): Promise<void> {
  await prisma.conversationSession.update({
    where: { telegramChatId },
    data: { hairdresserId },
  });
}

export async function linkCustomerToSession(telegramChatId: string, customerId: string): Promise<void> {
  await prisma.conversationSession.update({
    where: { telegramChatId },
    data: { customerId },
  });
}
