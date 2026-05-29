import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth, useClerk } from "@clerk/clerk-react"
import { apiGet, apiPatch } from "@/lib/api"
import type { UserProfile } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { ArrowLeft, Building2, Loader as Loader2, LogOut } from "lucide-react"

export function ProfilePage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { signOut } = useClerk()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState("")

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const token = await getToken()
      if (!token) { navigate("/login"); return }
      const data = await apiGet<UserProfile>("/api/profile", token)
      setProfile(data)
      setFullName(data.full_name || "")
    } catch {
      toast.error("Failed to load profile")
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<UserProfile>("/api/profile", token, { full_name: fullName })
      setProfile(updated)
      toast.success("Profile updated successfully")
    } catch {
      toast.error("Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  if (loading) {
    return (
      <div className="p-3 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-2xl">
      <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="-ml-2">
        <ArrowLeft className="size-4" />
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Email</Label>
            <div className="px-3 py-2 rounded-md border bg-muted text-sm">{profile.email}</div>
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              disabled={saving}
            />
          </div>

          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Currency</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Currency is now set per organization. Open an organization to change its currency — only owners and admins can.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/organizations">
              <Building2 className="size-4 mr-2" />
              Manage organizations
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Logout</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">Sign out of your ProfitSync account</p>
          <Button variant="destructive" onClick={handleLogout} className="w-full">
            <LogOut className="size-4 mr-2" />
            Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
