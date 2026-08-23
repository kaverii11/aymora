-- Razorpay's recurring Subscriptions API requires a Plan to be pre-created in
-- the dashboard (not something this codebase can provision). For an MVP that
-- must work purely from code in Test Mode, Aymora Plus is sold instead as a
-- one-time Order (Razorpay Orders + Checkout.js), verified via HMAC signature
-- on the client-return callback (src/modules/subscriptions/routes.ts) and
-- durably confirmed via the webhook (src/modules/subscriptions/webhook.ts).
-- `razorpay_subscription_id` is left in place for when true recurring
-- billing is wired up later.

alter table subscriptions
  add column razorpay_order_id text unique,
  add column razorpay_payment_id text unique;
