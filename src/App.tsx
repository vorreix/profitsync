import { lazy, Suspense, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Loader as Loader2 } from "lucide-react"
import { AppErrorBoundary } from "@/components/AppErrorBoundary"
import { AppLayout } from "@/components/AppLayout"
import { AdminLayout } from "@/pages/admin/AdminLayout"
import { RequireAdminCap } from "@/pages/admin/RequireAdminCap"
import { BusinessOnlyRoute } from "@/components/BusinessOnlyRoute"
import { PersonalOnlyRoute } from "@/components/PersonalOnlyRoute"
import { Toaster } from "@/components/ui/sonner"
import { UpdatePrompt } from "@/components/UpdatePrompt"
import { isNativeApp, nativeAuthLog, nativeAuthUrlLog, toInternalOAuthCallbackPath } from "@/lib/native-auth"
import { useShouldRedirectToApp } from "@/lib/use-redirect-to-app"
import { isStandalonePwa } from "@/lib/pwa/is-standalone"

// Route-level code splitting: each page becomes its own chunk so the initial
// bundle stays small. Heavy deps (recharts on the Dashboard, the whole admin
// console) are only fetched when their route is visited.
const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })))
const ClientsPage = lazy(() => import("@/pages/ClientsPage").then((m) => ({ default: m.ClientsPage })))
const ClosedClientsPage = lazy(() => import("@/pages/ClosedClientsPage").then((m) => ({ default: m.ClosedClientsPage })))
const ClientDetailPage = lazy(() => import("@/pages/ClientDetailPage").then((m) => ({ default: m.ClientDetailPage })))
const ClientFilesPage = lazy(() => import("@/pages/ClientFilesPage").then((m) => ({ default: m.ClientFilesPage })))
const TransactionsPage = lazy(() => import("@/pages/TransactionsPage").then((m) => ({ default: m.TransactionsPage })))
const RecurringPage = lazy(() => import("@/pages/RecurringPage").then((m) => ({ default: m.RecurringPage })))
const CalendarPage = lazy(() => import("@/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })))
const MoneyFlowPage = lazy(() => import("@/pages/MoneyFlowPage").then((m) => ({ default: m.MoneyFlowPage })))
const WealthPage = lazy(() => import("@/pages/WealthPage").then((m) => ({ default: m.WealthPage })))
const WealthAccountDetailPage = lazy(() => import("@/pages/WealthAccountDetailPage").then((m) => ({ default: m.WealthAccountDetailPage })))
const SpacesPage = lazy(() => import("@/pages/SpacesPage").then((m) => ({ default: m.SpacesPage })))
const SpaceDetailPage = lazy(() => import("@/pages/SpaceDetailPage").then((m) => ({ default: m.SpaceDetailPage })))
const CategoryTagsPage = lazy(() => import("@/pages/CategoryTagsPage").then((m) => ({ default: m.CategoryTagsPage })))
const BudgetsPage = lazy(() => import("@/pages/BudgetsPage").then((m) => ({ default: m.BudgetsPage })))
const BudgetDetailPage = lazy(() => import("@/pages/BudgetDetailPage").then((m) => ({ default: m.BudgetDetailPage })))
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })))
const ReferralPage = lazy(() => import("@/pages/ReferralPage").then((m) => ({ default: m.ReferralPage })))
const QuotationsPage = lazy(() => import("@/pages/QuotationsPage").then((m) => ({ default: m.QuotationsPage })))
const TrashPage = lazy(() => import("@/pages/TrashPage").then((m) => ({ default: m.TrashPage })))
const ProfilePage = lazy(() => import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })))
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })))
const OrganizationsPage = lazy(() => import("@/pages/OrganizationsPage").then((m) => ({ default: m.OrganizationsPage })))
const OrgMembersPage = lazy(() => import("@/pages/OrgMembersPage").then((m) => ({ default: m.OrgMembersPage })))
const SubscriptionPage = lazy(() => import("@/pages/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })))
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })))
const OrgSetupPage = lazy(() => import("@/pages/OrgSetupPage").then((m) => ({ default: m.OrgSetupPage })))
const InvitationPage = lazy(() => import("@/pages/InvitationPage").then((m) => ({ default: m.InvitationPage })))
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage").then((m) => ({ default: m.PrivacyPolicyPage })))
const TermsOfServicePage = lazy(() => import("@/pages/TermsOfServicePage").then((m) => ({ default: m.TermsOfServicePage })))
const RefundPolicyPage = lazy(() => import("@/pages/RefundPolicyPage").then((m) => ({ default: m.RefundPolicyPage })))

// Public marketing landing — fully self-contained in src/landing/ (its own
// components, styles, i18n). Lazy-loaded so it never bloats the app bundle.
const LandingApp = lazy(() => import("@/landing/LandingApp"))

// Public blog (marketing) — uses the landing's design system + isolated i18n.
const BlogIndexPage = lazy(() => import("@/landing/blog/BlogIndexPage"))
const BlogArticlePage = lazy(() => import("@/landing/blog/BlogArticlePage"))

const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })))
const SignupPage = lazy(() => import("@/pages/SignupPage").then((m) => ({ default: m.SignupPage })))
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })))
const OAuthCallbackPage = lazy(() => import("@/pages/OAuthCallbackPage").then((m) => ({ default: m.OAuthCallbackPage })))

const AdminOverviewPage = lazy(() => import("@/pages/admin/AdminOverviewPage").then((m) => ({ default: m.AdminOverviewPage })))
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })))
const AdminOrgsPage = lazy(() => import("@/pages/admin/AdminOrgsPage").then((m) => ({ default: m.AdminOrgsPage })))
const AdminOrgDetailPage = lazy(() => import("@/pages/admin/AdminOrgDetailPage").then((m) => ({ default: m.AdminOrgDetailPage })))
const AdminSubscriptionsPage = lazy(() => import("@/pages/admin/AdminSubscriptionsPage").then((m) => ({ default: m.AdminSubscriptionsPage })))
const AdminInvoicesPage = lazy(() => import("@/pages/admin/AdminInvoicesPage").then((m) => ({ default: m.AdminInvoicesPage })))
const AdminBillingAttemptsPage = lazy(() => import("@/pages/admin/AdminBillingAttemptsPage").then((m) => ({ default: m.AdminBillingAttemptsPage })))
const AdminPlansPage = lazy(() => import("@/pages/admin/AdminPlansPage").then((m) => ({ default: m.AdminPlansPage })))
const AdminBlogPage = lazy(() => import("@/pages/admin/AdminBlogPage").then((m) => ({ default: m.AdminBlogPage })))
const AdminReferralsPage = lazy(() => import("@/pages/admin/AdminReferralsPage").then((m) => ({ default: m.AdminReferralsPage })))
const AdminAdminsPage = lazy(() => import("@/pages/admin/AdminAdminsPage").then((m) => ({ default: m.AdminAdminsPage })))
const AdminWorkerPage = lazy(() => import("@/pages/admin/AdminWorkerPage").then((m) => ({ default: m.AdminWorkerPage })))
const AdminUserGroupsPage = lazy(() => import("@/pages/admin/AdminUserGroupsPage").then((m) => ({ default: m.AdminUserGroupsPage })))
const AdminBroadcastStudioPage = lazy(() => import("@/pages/admin/AdminBroadcastStudioPage").then((m) => ({ default: m.AdminBroadcastStudioPage })))

function RouteFallback() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

// Public landing at "/".
//
// In a normal browser the landing is ALWAYS shown — including to signed-in users
// (they get a "Go to dashboard" CTA in the navbar). This lets logged-in people
// revisit the marketing site, which the old "always redirect signed-in users"
// behavior prevented.
//
// The app surfaces — the installed PWA AND the native apps (Android + iOS) — are
// the product, not a website: they never render the marketing landing at "/", and
// instead boot straight into the app — the dashboard when signed in (AppLayout
// forwards to /onboarding if the account isn't set up yet), or the login screen
// when signed out. The Capacitor WebView loads the bundle at "/", so this is the
// single gate that keeps the marketing landing out of the native apps.
function LandingRoute() {
  const signedIn = useShouldRedirectToApp()
  if (isStandalonePwa() || isNativeApp()) {
    return <Navigate to={signedIn ? "/dashboard" : "/login"} replace />
  }
  return <LandingApp />
}

export function App() {
  useEffect(() => {
    let removeListener: (() => void) | undefined

    async function installNativeUrlListener() {
      // Web never needs the deep-link listener — bail before the dynamic
      // imports so browsers don't fetch the capacitor chunk at all. Covers
      // android AND ios (the custom OAuth scheme is shared across platforms).
      if (!isNativeApp()) return
      try {
        const [{ App: CapacitorApp }, { Browser }] = await Promise.all([
          import("@capacitor/app"),
          import("@capacitor/browser"),
        ])

        const handle = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
          nativeAuthUrlLog("callback_url_received", url)
          const callbackPath = toInternalOAuthCallbackPath(url)
          if (!callbackPath) return

          try {
            await Browser.close()
          } catch (cause) {
            nativeAuthLog("browser_close_failed", { message: cause instanceof Error ? cause.message : String(cause) })
          }

          nativeAuthLog("callback_route_navigation", { to: callbackPath })
          window.history.replaceState(null, "", callbackPath)
          window.dispatchEvent(new PopStateEvent("popstate"))
        })

        removeListener = () => {
          void handle.remove()
        }
      } catch (cause) {
        nativeAuthLog("app_url_listener_install_failed", { message: cause instanceof Error ? cause.message : String(cause) })
      }
    }

    void installNativeUrlListener()

    return () => {
      removeListener?.()
    }
  }, [])

  return (
    <BrowserRouter>
      <AppErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public legal routes */}
          <Route path="privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="terms-of-service" element={<TermsOfServicePage />} />
          <Route path="refund-policy" element={<RefundPolicyPage />} />

          {/* Public blog (marketing) — open to everyone, signed in or not */}
          <Route path="blog" element={<BlogIndexPage />} />
          <Route path="blog/:slug" element={<BlogArticlePage />} />

          {/* Invitation accept page (public landing — handles sign-in flow inline) */}
          <Route path="invitations/:token" element={<InvitationPage />} />

          {/* Auth Routes — /* glob required for Clerk's multi-step routing */}
          <Route path="login/*" element={<LoginPage />} />
          <Route path="signup/*" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="sso-callback" element={<OAuthCallbackPage />} />

          {/* Onboarding — full-screen, no app shell. Shown until account type is chosen. */}
          <Route path="onboarding" element={<OnboardingPage />} />
          {/* New-organization setup — full-screen wizard (money + plan) after creating an org. */}
          <Route path="organization-setup" element={<OrgSetupPage />} />

          {/* Admin Routes — distinct shell, admin guard + per-route capability gating */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<RequireAdminCap cap="read"><AdminOverviewPage /></RequireAdminCap>} />
            <Route path="users" element={<RequireAdminCap cap="read"><AdminUsersPage /></RequireAdminCap>} />
            <Route path="organizations" element={<RequireAdminCap cap="read"><AdminOrgsPage /></RequireAdminCap>} />
            <Route path="organizations/:id" element={<RequireAdminCap cap="read"><AdminOrgDetailPage /></RequireAdminCap>} />
            <Route path="subscriptions" element={<RequireAdminCap cap="read"><AdminSubscriptionsPage /></RequireAdminCap>} />
            <Route path="invoices" element={<RequireAdminCap cap="read"><AdminInvoicesPage /></RequireAdminCap>} />
            <Route path="billing-attempts" element={<RequireAdminCap cap="read"><AdminBillingAttemptsPage /></RequireAdminCap>} />
            <Route path="plans" element={<RequireAdminCap cap="settings"><AdminPlansPage /></RequireAdminCap>} />
            <Route path="blog" element={<RequireAdminCap cap="blog"><AdminBlogPage /></RequireAdminCap>} />
            <Route path="referrals" element={<RequireAdminCap cap="read"><AdminReferralsPage /></RequireAdminCap>} />
            <Route path="worker" element={<RequireAdminCap cap="read"><AdminWorkerPage /></RequireAdminCap>} />
            <Route path="broadcasts" element={<RequireAdminCap cap="broadcast"><AdminBroadcastStudioPage /></RequireAdminCap>} />
            <Route path="user-groups" element={<RequireAdminCap cap="broadcast"><AdminUserGroupsPage /></RequireAdminCap>} />
            <Route path="admins" element={<RequireAdminCap cap="manage_admins"><AdminAdminsPage /></RequireAdminCap>} />
          </Route>

          {/* Public marketing landing at the root domain (profitsync.net).
              Signed-in visitors are redirected to the app before it loads. */}
          <Route path="/" element={<LandingRoute />} />

          {/* App Routes — pathless layout so /dashboard, /clients, … keep working. */}
          <Route element={<AppLayout />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="clients" element={<BusinessOnlyRoute feature="clients"><ClientsPage /></BusinessOnlyRoute>} />
            <Route path="clients/closed" element={<BusinessOnlyRoute feature="clients"><ClosedClientsPage /></BusinessOnlyRoute>} />
            <Route path="clients/:id" element={<BusinessOnlyRoute feature="clients"><ClientDetailPage /></BusinessOnlyRoute>} />
            <Route path="clients/:id/files" element={<BusinessOnlyRoute feature="clients"><ClientFilesPage /></BusinessOnlyRoute>} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="recurring" element={<RecurringPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="flow" element={<MoneyFlowPage />} />
            <Route path="wealth" element={<WealthPage />} />
            <Route path="wealth/:id" element={<WealthAccountDetailPage />} />
            <Route path="spaces" element={<PersonalOnlyRoute feature="spaces"><SpacesPage /></PersonalOnlyRoute>} />
            <Route path="spaces/:id" element={<PersonalOnlyRoute feature="spaces"><SpaceDetailPage /></PersonalOnlyRoute>} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="categories" element={<CategoryTagsPage />} />
            <Route path="budgets" element={<BudgetsPage />} />
            <Route path="budgets/:key" element={<BudgetDetailPage />} />
            <Route path="referrals" element={<ReferralPage />} />
            <Route path="quotations" element={<BusinessOnlyRoute feature="quotations"><QuotationsPage /></BusinessOnlyRoute>} />
            <Route path="organizations" element={<OrganizationsPage />} />
            <Route path="organizations/:id/members" element={<BusinessOnlyRoute feature="members"><OrgMembersPage /></BusinessOnlyRoute>} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </Suspense>
      </AppErrorBoundary>
      <Toaster />
      <UpdatePrompt />
    </BrowserRouter>
  )
}

export default App
