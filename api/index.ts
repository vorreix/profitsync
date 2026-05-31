import type { VercelRequest, VercelResponse } from "@vercel/node"
import { matchRoute, type RoutePattern } from "../src/lib/api-router"

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

import profile from "./_routes/profile"
import clients from "./_routes/clients"
import clientById from "./_routes/clients/[id]"
import transactions from "./_routes/transactions"
import transactionById from "./_routes/transactions/[id]"
import transactionAttachments from "./_routes/transactions/[id]/attachments"
import quotations from "./_routes/quotations"
import quotationById from "./_routes/quotations/[id]"
import quotationAttachments from "./_routes/quotations/[id]/attachments"
import quotationConvert from "./_routes/quotations/[id]/convert"
import organizations from "./_routes/organizations"
import organizationSwitch from "./_routes/organizations/switch"
import organizationById from "./_routes/organizations/[id]"
import organizationMembers from "./_routes/organizations/[id]/members"
import attachmentById from "./_routes/attachments/[id]"
import quotationAttachmentById from "./_routes/quotation-attachments/[id]"
import invitationByToken from "./_routes/invitations/[token]"
import legalAccept from "./_routes/legal/accept"
import trash from "./_routes/trash"
import trashRestore from "./_routes/trash/restore"
import trashPurge from "./_routes/trash/purge"
import billingPricing from "./_routes/billing/pricing"
import billingCreateSubscription from "./_routes/billing/create-subscription"
import billingCancel from "./_routes/billing/cancel"
import billingSync from "./_routes/billing/sync"
// NOTE: billing/webhook is intentionally NOT routed here. It needs the raw
// request body for signature verification (bodyParser: false), which only works
// when it is its own function file — see api/billing/webhook.ts. The filesystem
// route serves /api/billing/webhook before the catch-all rewrite reaches this.
import adminMe from "./_routes/admin/me"
import adminStats from "./_routes/admin/stats"
import adminUsers from "./_routes/admin/users"
import adminUserDetail from "./_routes/admin/user-detail"
import adminClients from "./_routes/admin/clients"
import adminTransactions from "./_routes/admin/transactions"
import adminOrganizations from "./_routes/admin/organizations"
import adminOrgDetail from "./_routes/admin/org-detail"
import adminSubscriptions from "./_routes/admin/subscriptions"
import adminInvoices from "./_routes/admin/invoices"
import adminInvitations from "./_routes/admin/invitations"
import adminPlans from "./_routes/admin/plans"

type ApiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

// First match wins, so a static route must precede a dynamic sibling of the
// same length (see ["organizations", "switch"] before ["organizations", ":id"]).
const routes: RoutePattern<ApiHandler>[] = [
  { segments: ["profile"], handler: profile },

  { segments: ["clients"], handler: clients },
  { segments: ["clients", ":id"], handler: clientById },

  { segments: ["transactions"], handler: transactions },
  { segments: ["transactions", ":id"], handler: transactionById },
  { segments: ["transactions", ":id", "attachments"], handler: transactionAttachments },

  { segments: ["quotations"], handler: quotations },
  { segments: ["quotations", ":id"], handler: quotationById },
  { segments: ["quotations", ":id", "attachments"], handler: quotationAttachments },
  { segments: ["quotations", ":id", "convert"], handler: quotationConvert },

  { segments: ["organizations"], handler: organizations },
  { segments: ["organizations", "switch"], handler: organizationSwitch },
  { segments: ["organizations", ":id"], handler: organizationById },
  { segments: ["organizations", ":id", "members"], handler: organizationMembers },

  { segments: ["attachments", ":id"], handler: attachmentById },
  { segments: ["quotation-attachments", ":id"], handler: quotationAttachmentById },

  { segments: ["invitations", ":token"], handler: invitationByToken },
  { segments: ["legal", "accept"], handler: legalAccept },

  { segments: ["trash"], handler: trash },
  { segments: ["trash", "restore"], handler: trashRestore },
  { segments: ["trash", "purge"], handler: trashPurge },

  { segments: ["billing", "pricing"], handler: billingPricing },
  { segments: ["billing", "create-subscription"], handler: billingCreateSubscription },
  { segments: ["billing", "cancel"], handler: billingCancel },
  { segments: ["billing", "sync"], handler: billingSync },

  { segments: ["admin", "me"], handler: adminMe },
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
