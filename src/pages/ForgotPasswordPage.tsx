import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth, useSignIn } from "@clerk/clerk-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader as Loader2,
  Mail,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Step = "request" | "reset"

const emailSchema = z.object({
  email: z.string().email(),
})
const resetSchema = z.object({
  code: z.string().min(1),
  password: z.string().min(8),
})
type EmailValues = z.infer<typeof emailSchema>
type ResetValues = z.infer<typeof resetSchema>

/** Pull the most useful message out of a Clerk error, else a translated fallback. */
function clerkMessage(err: unknown, fallback: string): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] }
  const first = e?.errors?.[0]
  return first?.longMessage || first?.message || (err instanceof Error ? err.message : fallback)
}

/** True when Clerk reports the identifier has no account (account-not-found). */
function isAccountNotFound(err: unknown): boolean {
  const e = err as { errors?: { code?: string }[] }
  return e?.errors?.[0]?.code === "form_identifier_not_found"
}

/**
 * Custom forgot/reset password flow built on Clerk's `useSignIn()` primitives.
 * Two steps on one route:
 *   1. request — enter email → `signIn.create({ strategy: "reset_password_email_code" })`
 *   2. reset   — enter code + new password → `attemptFirstFactor` → activate session
 *
 * Requires the Clerk instance to have password + email-code reset enabled
 * (Dashboard → User & authentication → Password → "Sign-up with password").
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded, signIn, setActive } = useSignIn()

  const [step, setStep] = useState<Step>("request")
  const [email, setEmail] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  })
  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: "", password: "" },
  })

  // Already signed in → nothing to reset here.
  useEffect(() => {
    if (authLoaded && isSignedIn) navigate("/dashboard", { replace: true })
  }, [authLoaded, isSignedIn, navigate])

  // Advance to the code-entry step and show the same generic message whether or
  // not the account exists — see the account-enumeration note in requestCode.
  const advanceToReset = (addr: string) => {
    setEmail(addr)
    setStep("reset")
    resetForm.reset({ code: "", password: "" })
    toast.success(t("forgotPassword.codeSent"))
  }

  const requestCode = async ({ email: addr }: EmailValues) => {
    if (!isLoaded || !signIn || submitting) return
    setSubmitting(true)
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: addr })
      advanceToReset(addr)
    } catch (err) {
      // Account-enumeration protection: never reveal whether an email has an
      // account. On "not found", advance with the same generic message as success
      // (a non-existent account simply won't have a valid code). Surface only
      // other errors (e.g. rate limiting, malformed input).
      if (isAccountNotFound(err)) {
        advanceToReset(addr)
        return
      }
      toast.error(clerkMessage(err, t("forgotPassword.requestFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  const resetPassword = async ({ code, password }: ResetValues) => {
    if (!isLoaded || !signIn || submitting) return
    setSubmitting(true)
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password,
      })
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId })
        toast.success(t("forgotPassword.success"))
        navigate("/dashboard", { replace: true })
        return
      }
      // e.g. needs_second_factor when the account has MFA — out of scope for the
      // custom reset UI. The password was reset; route them to the normal sign-in
      // to complete the second factor.
      toast.error(t("forgotPassword.needsMfa"))
      navigate("/login", { replace: true })
    } catch (err) {
      toast.error(clerkMessage(err, t("forgotPassword.resetFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  const resendCode = async () => {
    if (!isLoaded || !signIn || !email || submitting) return
    setSubmitting(true)
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email })
      toast.success(t("forgotPassword.codeSent"))
    } catch (err) {
      // Same enumeration-safe behavior as requestCode.
      if (isAccountNotFound(err)) {
        toast.success(t("forgotPassword.codeSent"))
        return
      }
      toast.error(clerkMessage(err, t("forgotPassword.requestFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      {/* Subtle background atmosphere, consistent with onboarding. */}
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/10 to-transparent blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">ProfitSync</span>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
              {step === "request" ? <KeyRound className="size-5" /> : <Mail className="size-5" />}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{t("forgotPassword.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === "request"
                ? t("forgotPassword.requestSubtitle")
                : t("forgotPassword.resetSubtitle", { email })}
            </p>
          </div>

          {step === "request" ? (
            <form onSubmit={emailForm.handleSubmit(requestCode)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="fp-email">{t("forgotPassword.emailLabel")}</Label>
                <Input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="name@example.com"
                  className="h-11"
                  disabled={submitting}
                  aria-invalid={!!emailForm.formState.errors.email}
                  {...emailForm.register("email")}
                />
                {emailForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{t("forgotPassword.emailInvalid")}</p>
                )}
              </div>
              <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting || !isLoaded}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : t("forgotPassword.sendCode")}
              </Button>
            </form>
          ) : (
            <form onSubmit={resetForm.handleSubmit(resetPassword)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="fp-code">{t("forgotPassword.codeLabel")}</Label>
                <Input
                  id="fp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  className="h-11 tracking-widest"
                  disabled={submitting}
                  aria-invalid={!!resetForm.formState.errors.code}
                  {...resetForm.register("code")}
                />
                {resetForm.formState.errors.code && (
                  <p className="text-xs text-destructive">{t("forgotPassword.codeRequired")}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-password">{t("forgotPassword.newPasswordLabel")}</Label>
                <div className="relative">
                  <Input
                    id="fp-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="h-11 pr-10"
                    disabled={submitting}
                    aria-invalid={!!resetForm.formState.errors.password}
                    {...resetForm.register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? t("forgotPassword.hidePassword") : t("forgotPassword.showPassword")}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {resetForm.formState.errors.password ? (
                  <p className="text-xs text-destructive">{t("forgotPassword.passwordTooShort")}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("forgotPassword.passwordHint")}</p>
                )}
              </div>
              <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting || !isLoaded}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : t("forgotPassword.resetButton")}
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setStep("request")
                    setEmail("")
                    emailForm.reset({ email: "" })
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  disabled={submitting}
                >
                  {t("forgotPassword.changeEmail")}
                </button>
                <button
                  type="button"
                  onClick={resendCode}
                  className="text-muted-foreground hover:text-foreground"
                  disabled={submitting}
                >
                  {t("forgotPassword.resend")}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-5 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> {t("forgotPassword.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
