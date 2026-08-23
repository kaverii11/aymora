import { isBlocked } from "../trustSafety/repository.js";
import * as repo from "./repository.js";

export class NotParticipantError extends Error {}
export class BlockedError extends Error {}

export async function listMatches(userId: string) {
  return repo.listMatchesForUser(userId);
}

export async function listMessages(userId: string, conversationId: string, before?: string) {
  const convo = await repo.getConversationIfParticipant(conversationId, userId);
  if (!convo) throw new NotParticipantError();
  return repo.listMessages(conversationId, 50, before);
}

export async function sendMessage(userId: string, conversationId: string, body: string) {
  const convo = await repo.getConversationIfParticipant(conversationId, userId);
  if (!convo) throw new NotParticipantError();

  const match = (await repo.listMatchesForUser(userId)).find(
    (m) => m.conversation_id === conversationId,
  );
  if (match && (await isBlocked(userId, match.other_user_id))) {
    throw new BlockedError();
  }

  return repo.createMessage(conversationId, userId, body);
}
