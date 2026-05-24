import { SignUp } from "@clerk/clerk-react"

export function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <SignUp path="/signup" routing="path" signInUrl="/login" afterSignUpUrl="/dashboard" />
    </div>
  )
}
