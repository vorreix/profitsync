import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useAuth, useClerk, useUser } from "@clerk/clerk-react"
import { toast } from "sonner"
import { setActiveOrgId } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Building2, Check, Loader as Loader2, LogIn, UserPlus, X } from "lucide-react"

type Invitation = {
  organization: { id: string; name: string; slug: string }
  role: string
  email: string
  expires_at: string | null
}

export function InvitationPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<"accept" | "decline" | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/invitations/${token}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || "Failed to load invitation")
        setInvitation(body)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  // Carry the invitation back through the auth flow so the user returns here,
  // signed in, ready to accept. New users also get their email pre-filled.
  const loginLink = `/login?redirect=${encodeURIComponent(`/invitations/${token}`)}`
  const signupLink = invitation
    ? `/signup?redirect=${encodeURIComponent(`/invitations/${token}`)}&email=${encodeURIComponent(invitation.email)}`
    : `/signup?redirect=${encodeURIComponent(`/invitations/${token}`)}`

  const currentEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null
  const emailMismatch =
    isSignedIn && !!currentEmail && !!invitation && currentEmail !== invitation.email.toLowerCase()

  const accept = async () => {
    if (!token || !isSignedIn) return
    setActing("accept")
    try {
      const authToken = await getToken()
      if (!authToken) throw new Error("Authentication failed")
      const res = await fetch(`/api/invitations/${token}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "Failed to accept")
      // Switch the user into the joined org so the dashboard shows it.
      if (body.organization?.id) setActiveOrgId(body.organization.id)
      toast.success(`You joined ${body.organization?.name ?? "the organization"}`)
      navigate("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept")
    } finally {
      setActing(null)
    }
  }

  const decline = async () => {
    if (!token || !isSignedIn) return
    setActing("decline")
    try {
      const authToken = await getToken()
      if (!authToken) throw new Error("Authentication failed")
      const res = await fetch(`/api/invitations/${token}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Invitation declined")
      navigate("/")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setActing(null)
    }
  }

  if (loading || !isLoaded) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invitation problem</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-destructive">{error}</p>
            <Button asChild className="w-full"><Link to="/">Go home</Link></Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!invitation) return null

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-6" />
          </div>
          <div>
            <CardTitle className="text-xl">You're invited to {invitation.organization.name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Invited as <Badge variant="outline" className="capitalize ml-1">{invitation.role}</Badge> · for {invitation.email}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isSignedIn ? (
            <>
              <p className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 rounded-md p-2">
                Sign in or create your account with <span className="font-medium">{invitation.email}</span> to accept this invitation.
              </p>
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={() => navigate(loginLink)}>
                  <LogIn className="size-4 mr-1.5" /> Sign in to accept
                </Button>
                <Button variant="outline" onClick={() => navigate(signupLink)}>
                  <UserPlus className="size-4 mr-1.5" /> Create an account
                </Button>
              </div>
            </>
          ) : emailMismatch ? (
            <>
              <p className="text-xs bg-destructive/10 border border-destructive/30 text-destructive rounded-md p-2">
                This invitation is for <span className="font-medium">{invitation.email}</span>, but you're signed in as{" "}
                <span className="font-medium">{currentEmail}</span>. Sign in with the invited account to accept.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => signOut({ redirectUrl: `/invitations/${token}` })}
              >
                <LogIn className="size-4 mr-1.5" /> Use a different account
              </Button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={decline} variant="outline" disabled={!!acting}>
                {acting === "decline" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <X className="size-3.5 mr-1.5" />}
                Decline
              </Button>
              <Button onClick={accept} disabled={!!acting}>
                {acting === "accept" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Check className="size-3.5 mr-1.5" />}
                Accept
              </Button>
            </div>
          )}
          {invitation.expires_at && (
            <p className="text-xs text-muted-foreground text-center">
              Expires {new Date(invitation.expires_at).toLocaleDateString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
