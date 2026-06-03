import type { VercelRequest, VercelResponse } from "@vercel/node"
import { matchRoute, type RoutePattern } from "../src/lib/api-router.js"

// ---------------------------------------------------------------------------
// Single consolidated API function.
//
// Vercel's Hobby plan allows at most 12 Serverless Functions per deployment,
// and each file under api/ is its own function. So every handler lives under
// api/_routes/** (the "_" prefix makes Vercel skip them as functions) and this
// one function routes requests to them. vercel.json rewrites every /api/* path
// to this file and forwards the path as the `__apipath` query param. URLs are
// unchanged: /api/clients/123 still hits the clients/[id] handler, etc.
// ---------------------------------------------------------------------------

import profile from "./_routes/profile.js"
import onboarding from "./_routes/onboarding.js"
import clients from "./_routes/clients.js"
import clientsBulkDelete from "./_routes/clients/bulk-delete.js"
import clientById from "./_routes/clients/[id].js"
import clientAttachments from "./_routes/clients/[id]/attachments.js"
import clientMedia from "./_routes/clients/[id]/media.js"
import transactions from "./_routes/transactions.js"
import transactionsBulkDelete from "./_routes/transactions/bulk-delete.js"
import transactionById from "./_routes/transactions/[id].js"
import transactionAttachments from "./_routes/transactions/[id]/attachments.js"
import analytics from "./_routes/analytics.js"
import audit from "./_routes/audit.js"
import categories from "./_routes/categories.js"
import categoryById from "./_routes/categories/[id].js"
import quotations from "./_routes/quotations.js"
import quotationsBulkDelete from "./_routes/quotations/bulk-delete.js"
import quotationById from "./_routes/quotations/[id].js"
import quotationAttachments from "./_routes/quotations/[id]/attachments.js"
import quotationConvert from "./_routes/quotations/[id]/convert.js"
import organizations from "./_routes/organizations.js"
import organizationSwitch from "./_routes/organizations/switch.js"
import organizationById from "./_routes/organizations/[id].js"
import organizationMembers from "./_routes/organizations/[id]/members.js"
import attachmentById from "./_routes/attachments/[id].js"
import quotationAttachmentById from "./_routes/quotation-attachments/[id].js"
import clientAttachmentById from "./_routes/client-attachments/[id].js"
import invitationByToken from "./_routes/invitations/[token].js"
import legalAccept from "./_routes/legal/accept.js"
import trash from "./_routes/trash.js"
import trashRestore from "./_routes/trash/restore.js"
import trashPurge from "./_routes/trash/purge.js"
import publicPricing from "./_routes/public/pricing.js"
import publicBlog from "./_routes/public/blog.js"
import publicBlogBySlug from "./_routes/public/blog/[slug].js"
import billingPricing from "./_routes/billing/pricing.js"
import billingCreateSubscription from "./_routes/billing/create-subscription.js"
import billingChangePlan from "./_routes/billing/change-plan.js"
import billingCancel from "./_routes/billing/cancel.js"
import billingResume from "./_routes/billing/resume.js"
import billingSync from "./_routes/billing/sync.js"
import billingInvoices from "./_routes/billing/invoices.js"
import billingInvoicePdf from "./_routes/billing/invoice-pdf.js"
// NOTE: billing/webhook is intentionally NOT routed here. It needs the raw
// request body for signature verification (bodyParser: false), which only works
// when it is its own function file — see api/billing/webhook.ts. The filesystem
// route serves /api/billing/webhook before the catch-all rewrite reaches this.
import adminMe from "./_routes/admin/me.js"
import adminAdmins from "./_routes/admin/admins.js"
import adminStats from "./_routes/admin/stats.js"
import adminUsers from "./_routes/admin/users.js"
import adminUserDetail from "./_routes/admin/user-detail.js"
import adminClients from "./_routes/admin/clients.js"
import adminTransactions from "./_routes/admin/transactions.js"
import adminOrganizations from "./_routes/admin/organizations.js"
import adminOrgDetail from "./_routes/admin/org-detail.js"
import adminSubscriptions from "./_routes/admin/subscriptions.js"
import adminInvoices from "./_routes/admin/invoices.js"
import adminInvitations from "./_routes/admin/invitations.js"
import adminPlans from "./_routes/admin/plans.js"
import adminBlog from "./_routes/admin/blog.js"
import adminBlogById from "./_routes/admin/blog/[id].js"
import adminReferralSettings from "./_routes/admin/referral-settings.js"
import adminReferrals from "./_routes/admin/referrals.js"
import adminPayouts from "./_routes/admin/payouts.js"
import adminPayoutById from "./_routes/admin/payouts/[id].js"
import referralsRoute from "./_routes/referrals.js"
import referralsApply from "./_routes/referrals/apply.js"
import referralPayouts from "./_routes/referrals/payouts.js"

type ApiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

// First match wins, so a static route must precede a dynamic sibling of the
// same length (see ["organizations", "switch"] before ["organizations", ":id"]).
const routes: RoutePattern<ApiHandler>[] = [
  { segments: ["profile"], handler: profile },
  { segments: ["onboarding"], handler: onboarding },

  { segments: ["clients"], handler: clients },
  { segments: ["clients", "bulk-delete"], handler: clientsBulkDelete },
  { segments: ["clients", ":id"], handler: clientById },
  { segments: ["clients", ":id", "attachments"], handler: clientAttachments },
  { segments: ["clients", ":id", "media"], handler: clientMedia },

  { segments: ["analytics"], handler: analytics },
  { segments: ["audit"], handler: audit },
  { segments: ["categories"], handler: categories },
  { segments: ["categories", ":id"], handler: categoryById },

  { segments: ["transactions"], handler: transactions },
  { segments: ["transactions", "bulk-delete"], handler: transactionsBulkDelete },
  { segments: ["transactions", ":id"], handler: transactionById },
  { segments: ["transactions", ":id", "attachments"], handler: transactionAttachments },

  { segments: ["quotations"], handler: quotations },
  { segments: ["quotations", "bulk-delete"], handler: quotationsBulkDelete },
  { segments: ["quotations", ":id"], handler: quotationById },
  { segments: ["quotations", ":id", "attachments"], handler: quotationAttachments },
  { segments: ["quotations", ":id", "convert"], handler: quotationConvert },

  { segments: ["referrals"], handler: referralsRoute },
  { segments: ["referrals", "apply"], handler: referralsApply },
  { segments: ["referrals", "payouts"], handler: referralPayouts },

  { segments: ["organizations"], handler: organizations },
  { segments: ["organizations", "switch"], handler: organizationSwitch },
  { segments: ["organizations", ":id"], handler: organizationById },
  { segments: ["organizations", ":id", "members"], handler: organizationMembers },

  { segments: ["attachments", ":id"], handler: attachmentById },
  { segments: ["quotation-attachments", ":id"], handler: quotationAttachmentById },
  { segments: ["client-attachments", ":id"], handler: clientAttachmentById },

  { segments: ["invitations", ":token"], handler: invitationByToken },
  { segments: ["legal", "accept"], handler: legalAccept },

  { segments: ["trash"], handler: trash },
  { segments: ["trash", "restore"], handler: trashRestore },
  { segments: ["trash", "purge"], handler: trashPurge },

  // Public, unauthenticated pricing for the marketing landing page.
  { segments: ["public", "pricing"], handler: publicPricing },
  // Public, unauthenticated blog reads for the marketing site (published only).
  { segments: ["public", "blog"], handler: publicBlog },
  { segments: ["public", "blog", ":slug"], handler: publicBlogBySlug },

  { segments: ["billing", "pricing"], handler: billingPricing },
  { segments: ["billing", "create-subscription"], handler: billingCreateSubscription },
  { segments: ["billing", "change-plan"], handler: billingChangePlan },
  { segments: ["billing", "cancel"], handler: billingCancel },
  { segments: ["billing", "resume"], handler: billingResume },
  { segments: ["billing", "sync"], handler: billingSync },
  { segments: ["billing", "invoices"], handler: billingInvoices },
  { segments: ["billing", "invoice-pdf"], handler: billingInvoicePdf },

  { segments: ["admin", "me"], handler: adminMe },
  { segments: ["admin", "admins"], handler: adminAdmins },
  { segments: ["admin", "stats"], handler: adminStats },
  { segments: ["admin", "users"], handler: adminUsers },
  { segments: ["admin", "user-detail"], handler: adminUserDetail },
  { segments: ["admin", "clients"], handler: adminClients },
  { segments: ["admin", "transactions"], handler: adminTransactions },
  { segments: ["admin", "organizations"], handler: adminOrganizations },
  { segments: ["admin", "org-detail"], handler: adminOrgDetail },
  { segments: ["admin", "subscriptions"], handler: adminSubscriptions },
  { segments: ["admin", "invoices"], handler: adminInvoices },
  { segments: ["admin", "invitations"], handler: adminInvitations },
  { segments: ["admin", "plans"], handler: adminPlans },
  { segments: ["admin", "blog"], handler: adminBlog },
  { segments: ["admin", "blog", ":id"], handler: adminBlogById },
  { segments: ["admin", "referral-settings"], handler: adminReferralSettings },
  { segments: ["admin", "referrals"], handler: adminReferrals },
  { segments: ["admin", "payouts"], handler: adminPayouts },
  { segments: ["admin", "payouts", ":id"], handler: adminPayoutById },
]

// Resolve the path segments after "/api". Prefer the catch-all param Vercel
// populates (req.query.path); fall back to parsing req.url so routing is robust
// across `vercel dev` and production regardless of how the param is filled.
function resolveSegments(req: VercelRequest): string[] {
  // Primary: the path forwarded by the vercel.json rewrite (?__apipath=clients/123).
  const fromRewrite = req.query.__apipath
  if (typeof fromRewrite === "string" && fromRewrite.length > 0) {
    return fromRewrite.split("/").filter(Boolean)
  }
  if (Array.isArray(fromRewrite)) {
    return fromRewrite.flatMap((s) => s.split("/")).filter(Boolean)
  }

  // Fallbacks: a catch-all filesystem param, then the raw URL.
  const raw = req.query.path
  if (Array.isArray(raw) && raw.length > 0) return raw
  if (typeof raw === "string" && raw.length > 0) return raw.split("/").filter(Boolean)

  const pathname = (req.url ?? "").split("?")[0]
  return pathname
    .replace(/^\/+/, "")       // drop leading slashes
    .replace(/^api\/?/, "")    // drop the /api prefix
    .split("/")
    .filter(Boolean)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = resolveSegments(req)

  const matched = matchRoute(routes, segments)
  if (!matched) {
    return res.status(404).json({ error: `No API route for /${segments.join("/")}` })
  }

  // Expose dynamic path params (:id, :token) on req.query exactly as the old
  // file-based routing did, so the handlers read them unchanged.
  for (const [key, value] of Object.entries(matched.params)) {
    req.query[key] = value
  }

  return matched.handler(req, res)
}
