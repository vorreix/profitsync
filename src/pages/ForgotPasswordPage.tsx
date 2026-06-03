import { Navigate } from "react-router-dom"

// Intentional redirect — not unfinished. Password reset is handled by Clerk's
// built-in flow inside the <SignIn> widget (LoginPage), reachable via the
// "Forgot password?" link under /login/*. This route only exists as a safety net
// so old bookmarks/links to /forgot-password land on the sign-in page instead of 404ing.
export function ForgotPasswordPage() {
  return <Navigate to="/login" replace />
}
