import { query, queryOne } from "../../db/client.js";

export interface Subscription {
  id: string;
  user_id: string;
  plan: "plus";
  status: "active" | "cancelled" | "expired" | "past_due";
  source: "waitlist_promo" | "razorpay";
  razorpay_customer_id: string | null;
  razorpay_subscription_id: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  current_period_end: string | null;
}

export async function findActiveSubscription(userId: string): Promise<Subscription | null> {
  return queryOne<Subscription>(
    `select * from subscriptions where user_id = $1 and status = 'active'`,
    [userId],
  );
}

/**
 * Auto-provisions Aymora Plus for waitlist rank <= 1000, per the launch
 * promo promised in the landing page copy ("Free Aymora Plus for the first
 * 1,000"). Idempotent via the (user_id, plan) unique constraint.
 */
export async function grantWaitlistPromo(userId: string): Promise<void> {
  await query(
    `insert into subscriptions (user_id, plan, status, source)
     values ($1, 'plus', 'active', 'waitlist_promo')
     on conflict (user_id, plan) do nothing`,
    [userId],
  );
}

export async function createPendingRazorpayOrder(
  userId: string,
  orderId: string,
): Promise<void> {
  await query(
    `insert into subscriptions (user_id, plan, status, source, razorpay_order_id)
     values ($1, 'plus', 'past_due', 'razorpay', $2)
     on conflict (user_id, plan)
       do update set razorpay_order_id = excluded.razorpay_order_id, status = 'past_due'`,
    [userId, orderId],
  );
}

export async function activateByOrderId(
  orderId: string,
  paymentId: string,
  currentPeriodEnd: Date,
): Promise<void> {
  await query(
    `update subscriptions
        set status = 'active', razorpay_payment_id = $2, current_period_end = $3, updated_at = now()
      where razorpay_order_id = $1`,
    [orderId, paymentId, currentPeriodEnd.toISOString()],
  );
}

export async function findByOrderId(orderId: string): Promise<Subscription | null> {
  return queryOne<Subscription>("select * from subscriptions where razorpay_order_id = $1", [
    orderId,
  ]);
}

// --- Payment event log (webhook idempotency + audit trail) ---

export async function hasProcessedEvent(razorpayEventId: string): Promise<boolean> {
  const row = await queryOne(
    "select 1 from payment_events where razorpay_event_id = $1 and processed_at is not null",
    [razorpayEventId],
  );
  return row !== null;
}

export async function recordPaymentEvent(
  razorpayEventId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await query(
    `insert into payment_events (razorpay_event_id, event_type, payload)
     values ($1, $2, $3)
     on conflict (razorpay_event_id) do nothing`,
    [razorpayEventId, eventType, JSON.stringify(payload)],
  );
}

export async function markEventProcessed(razorpayEventId: string): Promise<void> {
  await query("update payment_events set processed_at = now() where razorpay_event_id = $1", [
    razorpayEventId,
  ]);
}
