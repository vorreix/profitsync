// Quotation notification hook (V5, branch notif5-02). Best-effort: never
// throws, never blocks the quotation mutation that calls it.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { createNotification, notifyOrgMembers } from "./notifications.js"

export type AcceptedQuotation = {
  id: string
  title: string
  /** The quotation's creator (quotations.user_id). */
  userId: string
}

/**
 * Tell the org a quotation was accepted: owners/admins via fan-out, plus the
 * quotation's creator directly (an editor who created it isn't in the
 * owner/admin fan-out). Both sends share the `quote_accepted:<id>:<userId>`
 * dedupe shape, so a creator who IS an owner/admin gets exactly one row, and
 * an accept-then-convert double fire collapses too.
 */
export async function notifyQuotationAccepted(
  organizationId: string,
  quotation: AcceptedQuotation,
  actorUserId: string,
): Promise<void> {
  try {
    const input = {
      type: "quotation_accepted",
      title: "Quotation accepted",
      body: `"${quotation.title}" was accepted.`,
      data: {
        i18nKey: "types.quotation_accepted.title",
        i18nBodyKey: "types.quotation_accepted.body",
        i18nParams: { title: quotation.title },
      },
      link: "/quotations",
      actorUserId,
      dedupeKey: `quote_accepted:${quotation.id}`,
    }
    await notifyOrgMembers(organizationId, input, {
      roles: ["owner", "admin"],
      excludeUserId: actorUserId,
    })
    if (quotation.userId !== actorUserId) {
      await createNotification({
        ...input,
        userId: quotation.userId,
        organizationId,
        dedupeKey: `${input.dedupeKey}:${quotation.userId}`,
      })
    }
  } catch {
    // Notifications must never break the quotation flow.
  }
}
