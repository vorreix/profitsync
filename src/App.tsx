import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/AppLayout"
import { Dashboard } from "@/pages/Dashboard"
import { ClientsPage } from "@/pages/ClientsPage"
import { ClientDetailPage } from "@/pages/ClientDetailPage"
import { TransactionsPage } from "@/pages/TransactionsPage"
import { QuotationsPage } from "@/pages/QuotationsPage"
import { TrashPage } from "@/pages/TrashPage"
import { LoginPage } from "@/pages/LoginPage"
import { SignupPage } from "@/pages/SignupPage"
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage"
import { ResetPasswordPage } from "@/pages/ResetPasswordPage"
import { ProfilePage } from "@/pages/ProfilePage"
import { OrganizationsPage } from "@/pages/OrganizationsPage"
import { PrivacyPolicyPage } from "@/pages/PrivacyPolicyPage"
import { TermsOfServicePage } from "@/pages/TermsOfServicePage"
import { Toaster } from "@/components/ui/sonner"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public legal routes */}
        <Route path="privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="terms-of-service" element={<TermsOfServicePage />} />

        {/* Auth Routes — /* glob required for Clerk's multi-step routing */}
        <Route path="login/*" element={<LoginPage />} />
        <Route path="signup/*" element={<SignupPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        {/* App Routes */}
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientDetailPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="quotations" element={<QuotationsPage />} />
          <Route path="organizations" element={<OrganizationsPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
