import { lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Loader as Loader2 } from "lucide-react"
import { AppLayout } from "@/components/AppLayout"
import { AdminLayout } from "@/pages/admin/AdminLayout"
import { Toaster } from "@/components/ui/sonner"

// Route-level code splitting: each page becomes its own chunk so the initial
// bundle stays small. Heavy deps (recharts on the Dashboard, the whole admin
// console) are only fetched when their route is visited.
const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })))
const ClientsPage = lazy(() => import("@/pages/ClientsPage").then((m) => ({ default: m.ClientsPage })))
const ClientDetailPage = lazy(() => import("@/pages/ClientDetailPage").then((m) => ({ default: m.ClientDetailPage })))
const TransactionsPage = lazy(() => import("@/pages/TransactionsPage").then((m) => ({ default: m.TransactionsPage })))
const QuotationsPage = lazy(() => import("@/pages/QuotationsPage").then((m) => ({ default: m.QuotationsPage })))
const TrashPage = lazy(() => import("@/pages/TrashPage").then((m) => ({ default: m.TrashPage })))
const ProfilePage = lazy(() => import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })))
const OrganizationsPage = lazy(() => import("@/pages/OrganizationsPage").then((m) => ({ default: m.OrganizationsPage })))
const OrgMembersPage = lazy(() => import("@/pages/OrgMembersPage").then((m) => ({ default: m.OrgMembersPage })))
const SubscriptionPage = lazy(() => import("@/pages/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })))
const InvitationPage = lazy(() => import("@/pages/InvitationPage").then((m) => ({ default: m.InvitationPage })))
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage").then((m) => ({ default: m.PrivacyPolicyPage })))
const TermsOfServicePage = lazy(() => import("@/pages/TermsOfServicePage").then((m) => ({ default: m.TermsOfServicePage })))

const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })))
const SignupPage = lazy(() => import("@/pages/SignupPage").then((m) => ({ default: m.SignupPage })))
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })))

const AdminOverviewPage = lazy(() => import("@/pages/admin/AdminOverviewPage").then((m) => ({ default: m.AdminOverviewPage })))
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })))
const AdminOrgsPage = lazy(() => import("@/pages/admin/AdminOrgsPage").then((m) => ({ default: m.AdminOrgsPage })))
const AdminOrgDetailPage = lazy(() => import("@/pages/admin/AdminOrgDetailPage").then((m) => ({ default: m.AdminOrgDetailPage })))
const AdminSubscriptionsPage = lazy(() => import("@/pages/admin/AdminSubscriptionsPage").then((m) => ({ default: m.AdminSubscriptionsPage })))
const AdminInvoicesPage = lazy(() => import("@/pages/admin/AdminInvoicesPage").then((m) => ({ default: m.AdminInvoicesPage })))
const AdminPlansPage = lazy(() => import("@/pages/admin/AdminPlansPage").then((m) => ({ default: m.AdminPlansPage })))

function RouteFallback() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public legal routes */}
          <Route path="privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="terms-of-service" element={<TermsOfServicePage />} />

          {/* Invitation accept page (public landing — handles sign-in flow inline) */}
          <Route path="invitations/:token" element={<InvitationPage />} />

          {/* Auth Routes — /* glob required for Clerk's multi-step routing */}
          <Route path="login/*" element={<LoginPage />} />
          <Route path="signup/*" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />

          {/* Admin Routes — distinct shell, admin guard */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="organizations" element={<AdminOrgsPage />} />
            <Route path="organizations/:id" element={<AdminOrgDetailPage />} />
            <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
            <Route path="invoices" element={<AdminInvoicesPage />} />
            <Route path="plans" element={<AdminPlansPage />} />
          </Route>

          {/* App Routes */}
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:id" element={<ClientDetailPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="quotations" element={<QuotationsPage />} />
            <Route path="organizations" element={<OrganizationsPage />} />
            <Route path="organizations/:id/members" element={<OrgMembersPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
