import { SignIn } from "@clerk/clerk-react"

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <SignIn path="/login" routing="path" signUpUrl="/signup" fallbackRedirectUrl="/dashboard" />
    </div>
  )
}
