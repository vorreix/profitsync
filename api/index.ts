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
import notificationsList from "./_routes/notifications.js"
import notificationsUnreadCount from "./_routes/notifications/unread-count.js"
import notificationsReadAll from "./_routes/notifications/read-all.js"
import notificationsPreferences from "./_routes/notifications/preferences.js"
import notificationsPush from "./_routes/notifications/push.js"
import notificationsPushRotate from "./_routes/notifications/push/rotate.js"
import notificationsTestPush from "./_routes/notifications/test-push.js"
import notificationsReminders from "./_routes/notifications/reminders.js"
import notificationReminderById from "./_routes/notifications/reminders/[id].js"
import notificationById from "./_routes/notifications/[id].js"
import cronNotifications from "./_routes/cron/notifications.js"
import clients from "./_routes/clients.js"
import clientsBulkDelete from "./_routes/clients/bulk-delete.js"
import clientById from "./_routes/clients/[id].js"
import clientAttachments from "./_routes/clients/[id]/attachments.js"
import clientMedia from "./_routes/clients/[id]/media.js"
import transactions from "./_routes/transactions.js"
import transactionsGroup from "./_routes/transactions/group.js"
import transactionsBulkDelete from "./_routes/transactions/bulk-delete.js"
import transactionById from "./_routes/transactions/[id].js"
import transactionAttachments from "./_routes/transactions/[id]/attachments.js"
import analytics from "./_routes/analytics.js"
import calendar from "./_routes/calendar.js"
import flow from "./_routes/flow.js"
import audit from "./_routes/audit.js"
import categories from "./_routes/categories.js"
import categoriesCombined from "./_routes/categories/combined.js"
import categoryEntities from "./_routes/categories/entities.js"
import categoryById from "./_routes/categories/[id].js"
import tagsList from "./_routes/tags.js"
import tagEntities from "./_routes/tags/entities.js"
import tagById from "./_routes/tags/[id].js"
import wealthAccounts from "./_routes/wealth/accounts.js"
import wealthAccountsReorder from "./_routes/wealth/accounts/reorder.js"
import wealthAccountById from "./_routes/wealth/accounts/[id].js"
import wealthAccountAttachments from "./_routes/wealth/accounts/[id]/attachments.js"
import wealthAccountAttachmentById from "./_routes/wealth-account-attachments/[id].js"
import wealthBankSearch from "./_routes/wealth/bank-search.js"
import wealthQuota from "./_routes/wealth/quota.js"
import recurring from "./_routes/recurring.js"
import recurringById from "./_routes/recurring/[id].js"
import wealthTransfer from "./_routes/wealth/transfer.js"
import spaces from "./_routes/spaces.js"
import spacesReorder from "./_routes/spaces/reorder.js"
import spaceById from "./_routes/spaces/[id].js"
import spaceAutoSave from "./_routes/spaces/[id]/auto-save.js"
import quotations from "./_routes/quotations.js"
import quotationsBulkDelete from "./_routes/quotations/bulk-delete.js"
import quotationById from "./_routes/quotations/[id].js"
import quotationAttachments from "./_routes/quotations/[id]/attachments.js"
import quotationConvert from "./_routes/quotations/[id]/convert.js"
import quotationPdf from "./_routes/quotations/[id]/pdf.js"
import quotationPdfFile from "./_routes/quotations/[id]/pdf/file.js"
import quotationPdfReady from "./_routes/internal/quotations/pdf-ready.js"
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
import budgets from "./_routes/budgets.js"
import budgetsOverview from "./_routes/budgets/overview.js"
import budgetsDetail from "./_routes/budgets/detail.js"
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
import adminRolesRoute from "./_routes/admin/roles.js"
import adminRoleById from "./_routes/admin/roles/[id].js"
import adminStats from "./_routes/admin/stats.js"
import adminWorker from "./_routes/admin/worker.js"
import adminUserGroups from "./_routes/admin/user-groups.js"
import adminUserGroupById from "./_routes/admin/user-groups/[id].js"
import adminUserGroupMembers from "./_routes/admin/user-groups/[id]/members.js"
import adminBroadcasts from "./_routes/admin/broadcasts.js"
import adminBroadcastRunDue from "./_routes/admin/broadcasts/run-due.js"
import adminBroadcastById from "./_routes/admin/broadcasts/[id].js"
import adminBroadcastSend from "./_routes/admin/broadcasts/[id]/send.js"
import adminUsers from "./_routes/admin/users.js"
import adminUserDetail from "./_routes/admin/user-detail.js"
import adminClients from "./_routes/admin/clients.js"
import adminTransactions from "./_routes/admin/transactions.js"
import adminOrganizations from "./_routes/admin/organizations.js"
import adminOrgsBulkDelete from "./_routes/admin/organizations/bulk-delete.js"
import adminOrgDetail from "./_routes/admin/org-detail.js"
import adminSubscriptions from "./_routes/admin/subscriptions.js"
import adminSubscriptionsActions from "./_routes/admin/subscriptions/actions.js"
import adminInvoices from "./_routes/admin/invoices.js"
import adminBillingAttempts from "./_routes/admin/billing-attempts.js"
import adminBillingAttemptById from "./_routes/admin/billing-attempts/[id].js"
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

  // Notifications. Static length-2 routes before the dynamic ":id". (preferences
  // and push routes are added in later branches and also precede ":id".)
  { segments: ["notifications"], handler: notificationsList },
  { segments: ["notifications", "unread-count"], handler: notificationsUnreadCount },
  { segments: ["notifications", "read-all"], handler: notificationsReadAll },
  { segments: ["notifications", "preferences"], handler: notificationsPreferences },
  { segments: ["notifications", "push"], handler: notificationsPush },
  { segments: ["notifications", "push", "rotate"], handler: notificationsPushRotate },
  { segments: ["notifications", "test-push"], handler: notificationsTestPush },
  { segments: ["notifications", "reminders"], handler: notificationsReminders },
  { segments: ["notifications", "reminders", ":id"], handler: notificationReminderById },
  { segments: ["notifications", ":id"], handler: notificationById },
  { segments: ["cron", "notifications"], handler: cronNotifications },
  { segments: ["internal", "quotations", "pdf-ready"], handler: quotationPdfReady },

  { segments: ["clients"], handler: clients },
  { segments: ["clients", "bulk-delete"], handler: clientsBulkDelete },
  { segments: ["clients", ":id"], handler: clientById },
  { segments: ["clients", ":id", "attachments"], handler: clientAttachments },
  { segments: ["clients", ":id", "media"], handler: clientMedia },

  { segments: ["analytics"], handler: analytics },
  { segments: ["calendar"], handler: calendar },
  { segments: ["flow"], handler: flow },
  { segments: ["audit"], handler: audit },
  { segments: ["categories"], handler: categories },
  { segments: ["categories", "combined"], handler: categoriesCombined },
  { segments: ["categories", "entities"], handler: categoryEntities },
  { segments: ["categories", ":id"], handler: categoryById },
  { segments: ["tags"], handler: tagsList },
  { segments: ["tags", "entities"], handler: tagEntities },
  { segments: ["tags", ":id"], handler: tagById },
  { segments: ["wealth", "bank-search"], handler: wealthBankSearch },
  { segments: ["wealth", "quota"], handler: wealthQuota },
  { segments: ["recurring"], handler: recurring },
  { segments: ["recurring", ":id"], handler: recurringById },
  { segments: ["wealth", "transfer"], handler: wealthTransfer },
  // Spaces (personal savings buckets). Static "reorder" before the dynamic ":id".
  { segments: ["spaces"], handler: spaces },
  { segments: ["spaces", "reorder"], handler: spacesReorder },
  { segments: ["spaces", ":id"], handler: spaceById },
  { segments: ["spaces", ":id", "auto-save"], handler: spaceAutoSave },
  { segments: ["wealth", "accounts"], handler: wealthAccounts },
  { segments: ["wealth", "accounts", "reorder"], handler: wealthAccountsReorder },
  { segments: ["wealth", "accounts", ":id"], handler: wealthAccountById },
  { segments: ["wealth", "accounts", ":id", "attachments"], handler: wealthAccountAttachments },
  { segments: ["wealth-accounts"], handler: wealthAccounts },
  { segments: ["wealth-accounts", ":id"], handler: wealthAccountById },
  { segments: ["wealth-account-attachments", ":id"], handler: wealthAccountAttachmentById },

  { segments: ["transactions"], handler: transactions },
  { segments: ["transactions", "group"], handler: transactionsGroup },
  { segments: ["transactions", "bulk-delete"], handler: transactionsBulkDelete },
  { segments: ["transactions", ":id"], handler: transactionById },
  { segments: ["transactions", ":id", "attachments"], handler: transactionAttachments },

  { segments: ["quotations"], handler: quotations },
  { segments: ["quotations", "bulk-delete"], handler: quotationsBulkDelete },
  { segments: ["quotations", ":id"], handler: quotationById },
  { segments: ["quotations", ":id", "attachments"], handler: quotationAttachments },
  { segments: ["quotations", ":id", "convert"], handler: quotationConvert },
  { segments: ["quotations", ":id", "pdf"], handler: quotationPdf },
  { segments: ["quotations", ":id", "pdf", "file"], handler: quotationPdfFile },

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

  { segments: ["budgets", "overview"], handler: budgetsOverview },
  { segments: ["budgets", "detail"], handler: budgetsDetail },
  { segments: ["budgets"], handler: budgets },
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
  { segments: ["admin", "roles"], handler: adminRolesRoute },
  { segments: ["admin", "roles", ":id"], handler: adminRoleById },
  { segments: ["admin", "stats"], handler: adminStats },
  { segments: ["admin", "worker"], handler: adminWorker },
  { segments: ["admin", "user-groups"], handler: adminUserGroups },
  { segments: ["admin", "user-groups", ":id"], handler: adminUserGroupById },
  { segments: ["admin", "user-groups", ":id", "members"], handler: adminUserGroupMembers },
  { segments: ["admin", "broadcasts"], handler: adminBroadcasts },
  { segments: ["admin", "broadcasts", "run-due"], handler: adminBroadcastRunDue },
  { segments: ["admin", "broadcasts", ":id"], handler: adminBroadcastById },
  { segments: ["admin", "broadcasts", ":id", "send"], handler: adminBroadcastSend },
  { segments: ["admin", "users"], handler: adminUsers },
  { segments: ["admin", "user-detail"], handler: adminUserDetail },
  { segments: ["admin", "clients"], handler: adminClients },
  { segments: ["admin", "transactions"], handler: adminTransactions },
  { segments: ["admin", "organizations"], handler: adminOrganizations },
  { segments: ["admin", "organizations", "bulk-delete"], handler: adminOrgsBulkDelete },
  { segments: ["admin", "org-detail"], handler: adminOrgDetail },
  { segments: ["admin", "subscriptions"], handler: adminSubscriptions },
  { segments: ["admin", "subscriptions", "actions"], handler: adminSubscriptionsActions },
  { segments: ["admin", "invoices"], handler: adminInvoices },
  { segments: ["admin", "billing-attempts"], handler: adminBillingAttempts },
  { segments: ["admin", "billing-attempts", ":id"], handler: adminBillingAttemptById },
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
