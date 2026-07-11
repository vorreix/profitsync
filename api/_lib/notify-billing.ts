// Billing notification hooks (V5, branch notif5-01).
//
// Both helpers are BEST-EFFORT: they never throw and never block the money
// path that calls them (webhook, reconcile, admin actions). Both fire from the
// webhook AND the reconcile path — like referral crediting, user-visible
// billing state must never depend on webhooks being configured — and rely on
// dedupe keys to collapse the double-fire.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { notifyOrgMembers } from "./notifications.js"

// Reconcile replays the FULL payment history; only a recent payment is news.
const PAYMENT_NOTIFY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type PaymentSucceededEvent = {
  /** Dodo payment id — the dedupe anchor. Without one we skip (can't be idempotent). */
  paymentId: string | null | undefined
  /** Major units, e.g. 9.99 */
  amount: number
  currency: string
  paidAt: Date | null | undefined
}

/** Tell org owners/admins a charge went through. Idempotent per payment. */
export async function notifyPaymentSucceeded(organizationId: string, evt: PaymentSucceededEvent): Promise<void> {
  try {
    if (!evt.paymentId) return
    const paidAt = evt.paidAt ? evt.paidAt.getTime() : 0
    if (!paidAt || Date.now() - paidAt > PAYMENT_NOTIFY_WINDOW_MS) return
    const amount = `${evt.amount.toFixed(2)} ${evt.currency}`
    await notifyOrgMembers(
      organizationId,
      {
        type: "payment_succeeded",
        title: "Payment received",
        body: `Your ${amount} payment was successful.`,
        data: {
          i18nKey: "types.payment_succeeded.title",
          i18nBodyKey: "types.payment_succeeded.body",
          i18nParams: { amount },
        },
        link: "/subscription",
        dedupeKey: `payment_ok:${evt.paymentId}`,
      },
      { roles: ["owner", "admin"] },
    )
  } catch {
    // Notifications must never break billing.
  }
}

export type SubscriptionTransition = {
  fromPlan: string | null | undefined
  toPlan: string | null | undefined
  fromStatus: string | null | undefined
  toStatus: string | null | undefined
}

/**
 * Is this transition worth telling the org about? Plan changes always; status
 * changes only when landing on active/cancelled (past_due is already covered by
 * the louder payment_failed alert; pending is checkout plumbing, not news).
 */
export function isNoteworthySubscriptionChange(t: SubscriptionTransition): boolean {
  const planChanged = !!t.toPlan && t.fromPlan !== t.toPlan
  const statusChanged = !!t.toStatus && t.fromStatus !== t.toStatus
  return planChanged || (statusChanged && (t.toStatus === "active" || t.toStatus === "cancelled"))
}

/**
 * Tell org owners/admins their plan/status changed. The dedupe key is
 * day-stamped: the webhook and the return-from-checkout reconcile reporting the
 * same transition on the same day collapse to one notification, while a real
 * repeat transition later (e.g. re-upgrading next month) notifies again.
 */
export async function notifySubscriptionChanged(organizationId: string, t: SubscriptionTransition): Promise<void> {
  try {
    if (!isNoteworthySubscriptionChange(t)) return
    const plan = t.toPlan || t.fromPlan || "free"
    const cancelled = t.toStatus === "cancelled"
    const day = new Date().toISOString().slice(0, 10)
    await notifyOrgMembers(
      organizationId,
      {
        type: "subscription_changed",
        title: "Subscription updated",
        body: cancelled ? `Your ${plan} subscription was cancelled.` : `Your organization is now on ${plan}.`,
        data: {
          i18nKey: "types.subscription_changed.title",
          i18nBodyKey: cancelled ? "types.subscription_changed.body_cancelled" : "types.subscription_changed.body_active",
          i18nParams: { plan },
        },
        link: "/subscription",
        dedupeKey: `sub_changed:${organizationId}:${t.fromPlan}>${plan}:${t.fromStatus}>${t.toStatus}:${day}`,
      },
      { roles: ["owner", "admin"] },
    )
  } catch {
    // Notifications must never break billing.
  }
}
