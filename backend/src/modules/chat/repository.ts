import { query, queryOne } from "../../db/client.js";

export interface Match {
  id: string;
  user_a_id: string;
  user_b_id: string;
  matched_at: string;
}

export interface Conversation {
  id: string;
  match_id: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export async function createMatch(userAId: string, userBId: string): Promise<Match | null> {
  const [a, b] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  return queryOne<Match>(
    `insert into matches (user_a_id, user_b_id) values ($1, $2)
     on conflict (user_a_id, user_b_id) do nothing
     returning *`,
    [a, b],
  );
}

export async function createConversation(matchId: string): Promise<Conversation> {
  const row = await queryOne<Conversation>(
    `insert into conversations (match_id) values ($1)
     on conflict (match_id) do update set match_id = excluded.match_id
     returning *`,
    [matchId],
  );
  if (!row) throw new Error("failed to create conversation");
  return row;
}

export async function listMatchesForUser(userId: string): Promise<
  Array<
    Match & {
      conversation_id: string;
      other_user_id: string;
      other_display_name: string | null;
      other_city: string | null;
    }
  >
> {
  return query(
    `select m.*, c.id as conversation_id,
            ou.id as other_user_id,
            ou.display_name as other_display_name,
            ou.city as other_city
       from matches m
       join conversations c on c.match_id = m.id
       join users ou on ou.id = (case when m.user_a_id = $1 then m.user_b_id else m.user_a_id end)
      where m.user_a_id = $1 or m.user_b_id = $1
      order by m.matched_at desc`,
    [userId],
  );
}

export async function getConversationIfParticipant(
  conversationId: string,
  userId: string,
): Promise<Conversation | null> {
  return queryOne<Conversation>(
    `select c.* from conversations c
       join matches m on m.id = c.match_id
      where c.id = $1 and (m.user_a_id = $2 or m.user_b_id = $2)`,
    [conversationId, userId],
  );
}

export async function createMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<Message> {
  const row = await queryOne<Message>(
    `insert into messages (conversation_id, sender_id, body) values ($1, $2, $3) returning *`,
    [conversationId, senderId, body],
  );
  if (!row) throw new Error("failed to create message");
  return row;
}

export async function listMessages(
  conversationId: string,
  limit: number,
  before?: string,
): Promise<Message[]> {
  if (before) {
    return query<Message>(
      `select * from messages
        where conversation_id = $1 and created_at < $2
        order by created_at desc
        limit $3`,
      [conversationId, before, limit],
    );
  }
  return query<Message>(
    `select * from messages
      where conversation_id = $1
      order by created_at desc
      limit $2`,
    [conversationId, limit],
  );
}
