import { Navigate } from "react-router-dom"

// The reset flow is self-contained on /forgot-password (request code → enter code +
// new password in one place), so this legacy route just forwards there. Kept so old
// links to /reset-password don't 404.
export function ResetPasswordPage() {
  return <Navigate to="/forgot-password" replace />
}

export default ResetPasswordPage
