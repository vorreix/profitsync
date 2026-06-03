import { Navigate } from "react-router-dom"

// Intentional redirect — not unfinished. Clerk's reset flow (enter code → set new
// password) runs inside the <SignIn> widget under /login/*, so it never routes here.
// This route only exists as a safety net so old links to /reset-password land on the
// sign-in page instead of 404ing.
export function ResetPasswordPage() {
  return <Navigate to="/login" replace />
}
