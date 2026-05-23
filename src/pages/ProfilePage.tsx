import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { supabase, type UserProfile, CURRENCIES } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { ArrowLeft, Loader as Loader2, LogOut } from "lucide-react"

export function ProfilePage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState("")
  const [currency, setCurrency] = useState("USD")

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      navigate("/login")
      return
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle()

    if (error) {
      toast.error("Failed to load profile")
      return
    }

    if (data) {
      setProfile(data)
      setFullName(data.full_name || "")
      setCurrency(data.currency || "USD")
    }

    setLoading(false)
  }

  const handleSave = async () => {
    if (!profile) return

    setSaving(true)
    const { error } = await supabase
      .from("user_profiles")
      .update({ full_name: fullName, currency })
      .eq("id", profile.id)

    setSaving(false)

    if (error) {
      toast.error("Failed to save profile")
      return
    }

    setProfile({ ...profile, full_name: fullName, currency })
    toast.success("Profile updated successfully")
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success("Logged out successfully")
    navigate("/login")
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Back Button */}
      <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="-ml-2">
        <ArrowLeft className="size-4" />
      </Button>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email (Read-only) */}
          <div className="space-y-2">
            <Label>Email</Label>
            <div className="px-3 py-2 rounded-md border bg-muted text-sm">{profile.email}</div>
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          {/* Full Name */}
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

          {/* Currency Selection */}
          <div className="space-y-2">
            <Label htmlFor="currency">Default Currency</Label>
            <p className="text-xs text-muted-foreground">This currency will be used for all transactions and dashboards</p>
            <Select value={currency} onValueChange={setCurrency} disabled={saving}>
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((curr) => (
                  <SelectItem key={curr} value={curr}>
                    {curr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Save Button */}
          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Logout Card */}
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
