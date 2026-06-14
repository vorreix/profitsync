import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, Link } from "react-router-dom"
import { useAuth, useClerk } from "@clerk/clerk-react"
import { apiGet, apiPatch } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import type { UserProfile } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NotificationPreferencesForm } from "@/components/notifications/NotificationPreferencesForm"
import { Skeleton } from "@/components/ui/skeleton"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { CountryCombobox, CountryCodeCombobox } from "@/components/CountryCombobox"
import { toast } from "sonner"
import { ArrowLeft, Building2, FileText, ImagePlus, Loader as Loader2, LogOut, ScrollText, ShieldCheck, UserRound, X } from "lucide-react"
import { EntityAvatar } from "@/components/EntityAvatar"
import { fileToResizedDataUrl } from "@/lib/image-upload"

export function ProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { signOut } = useClerk()
  // Keep the shared OrgProvider profile in sync, so the sidebar/menu avatar
  // (which reads it) updates the instant a photo is saved — no reload.
  const { updateProfile } = useOrg()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState("")
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [stateRegion, setStateRegion] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [country, setCountry] = useState("")
  const [phoneCode, setPhoneCode] = useState("")
  const [phone, setPhone] = useState("")

  useEffect(() => {
    loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [])

  const loadProfile = async () => {
    try {
      const token = await getToken()
      if (!token) { navigate("/login"); return }
      const data = await apiGet<UserProfile>("/api/profile", token)
      setProfile(data)
      setFullName(data.full_name || "")
      setAddress(data.address || "")
      setCity(data.city || "")
      setStateRegion(data.state || "")
      setPostalCode(data.postal_code || "")
      setCountry(data.country || "")
      setPhoneCode(data.phone_country_code || "")
      setPhone(data.phone || "")
    } catch {
      toast.error(t("toast.profileLoadFailed"))
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
      const updated = await apiPatch<UserProfile>("/api/profile", token, {
        full_name: fullName,
        address,
        city,
        state: stateRegion,
        postal_code: postalCode,
        country,
        phone_country_code: phoneCode,
        phone,
      })
      setProfile(updated)
      updateProfile(updated) // refresh the navbar/menu name in place
      toast.success(t("toast.profileUpdated"))
    } catch {
      toast.error(t("toast.profileSaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  // Avatar saves immediately on pick/remove (no separate Save step). Pushing
  // the result into the OrgProvider updates the sidebar/menu avatar in place —
  // OrgProvider holds `profile` in its own state from boot, so clearing the
  // GET cache alone would NOT refresh it without this.
  const handleAvatarChange = async (next: string | "") => {
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<UserProfile>("/api/profile", token, { avatar_data: next })
      setProfile(updated)
      updateProfile(updated)
      toast.success(t("profile.photoUpdated"))
    } catch {
      toast.error(t("toast.profileSaveFailed"))
    }
  }

  const handlePickAvatar = async (file: File | undefined) => {
    if (!file) return
    try {
      await handleAvatarChange(await fileToResizedDataUrl(file))
    } catch {
      toast.error(t("profile.photoInvalid"))
    }
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
          <CardTitle>{t("profile.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Profile photo */}
          <div className="flex items-center gap-4">
            <EntityAvatar
              name={fullName || profile.email}
              src={profile.avatar_src}
              className="size-16 text-xl"
              rounded="rounded-full"
              fallbackIcon={<UserRound className="size-7" />}
            />
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <label className="cursor-pointer">
                    <ImagePlus className="size-4" /> {t("profile.uploadPhoto")}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => { handlePickAvatar(e.target.files?.[0]); e.target.value = "" }}
                    />
                  </label>
                </Button>
                {profile.avatar_src && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => handleAvatarChange("")}>
                    <X className="size-4" /> {t("profile.removePhoto")}
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("profile.photoHint")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("profile.email")}</Label>
            <div className="px-3 py-2 rounded-md border bg-muted text-sm">{profile.email}</div>
            <p className="text-xs text-muted-foreground">{t("profile.emailCannotChange")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">{t("profile.fullName")}</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("profile.yourName")}
              disabled={saving}
            />
          </div>

          {/* Contact details — all optional. */}
          <div className="space-y-4 border-t pt-4">
            <p className="text-sm font-medium">{t("profile.contactDetails")} <span className="text-xs font-normal text-muted-foreground">({t("profile.optional")})</span></p>

            <div className="space-y-2">
              <Label>{t("profile.phone")}</Label>
              <div className="flex gap-2">
                <CountryCodeCombobox value={phoneCode} onValueChange={setPhoneCode} disabled={saving} />
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("profile.phonePlaceholder")}
                  inputMode="tel"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">{t("profile.address")}</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("profile.addressPlaceholder")} disabled={saving} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="city">{t("profile.city")}</Label>
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">{t("profile.state")}</Label>
                <Input id="state" value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} disabled={saving} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="postal">{t("profile.postalCode")}</Label>
                <Input id="postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label>{t("profile.country")}</Label>
                <CountryCombobox value={country} onValueChange={setCountry} disabled={saving} placeholder={t("profile.selectCountry")} />
              </div>
            </div>
          </div>

          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("language.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("language.description")}</p>
          <LanguageSwitcher variant="full" align="start" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.currency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            {t("profile.currencyDescription")}
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/organizations">
              <Building2 className="size-4 mr-2" />
              {t("org.manageOrganizations")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("notifications:settings.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("notifications:settings.user_description")}</p>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesForm scope="user" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.legalTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button asChild variant="outline" className="justify-start">
            <Link to="/privacy-policy">
              <ShieldCheck className="size-4 mr-2" />
              {t("nav.privacyPolicy")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-start">
            <Link to="/terms-of-service">
              <ScrollText className="size-4 mr-2" />
              {t("nav.termsOfService")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-start">
            <Link to="/refund-policy">
              <FileText className="size-4 mr-2" />
              {t("nav.refundPolicy")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">{t("profile.logoutTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{t("profile.logoutDescription")}</p>
          <Button variant="destructive" onClick={handleLogout} className="w-full">
            <LogOut className="size-4 mr-2" />
            {t("profile.logoutTitle")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
