import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { Menu, X } from "lucide-react"
import { cn } from "../lib/cn"
import { Container } from "../components/Container"
import { Logo } from "../components/Logo"
import { Button } from "../components/Button"
import { SmartLink } from "../components/SmartLink"
import { ThemeToggle } from "../components/ThemeToggle"
import { LanguagePicker } from "../components/LanguagePicker"
import { InstallButton } from "@/components/InstallButton"

const LINKS = [
  { id: "features", key: "nav.features" },
  { id: "how", key: "nav.how" },
  { id: "pricing", key: "nav.pricing" },
  { id: "faq", key: "nav.faq" },
] as const

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}

export function Navbar() {
  const { t } = useTranslation()
  const { isSignedIn } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  const onNav = (id: string) => {
    setOpen(false)
    // Wait for the menu to close before scrolling on mobile.
    requestAnimationFrame(() => scrollToId(id))
  }

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-border bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent bg-background/0",
      )}
    >
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          <Logo />

          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <button
                key={l.id}
                onClick={() => onNav(l.id)}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
              >
                {t(l.key)}
              </button>
            ))}
            <SmartLink
              href="/blog"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {t("nav.blog")}
            </SmartLink>
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex">
              <LanguagePicker />
              <ThemeToggle />
            </div>
            <InstallButton
              label={t("install.button")}
              iosTitle={t("install.iosTitle")}
              iosBody={t("install.iosBody")}
              closeLabel={t("install.close")}
              variant="outline"
              className="hidden md:inline-flex"
            />
            {isSignedIn ? (
              <Button href="/dashboard" size="sm" className="hidden md:inline-flex">
                {t("nav.goToDashboard", { defaultValue: "Go to dashboard" })}
              </Button>
            ) : (
              <>
                <SmartLink
                  href="/login"
                  className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground md:inline-flex"
                >
                  {t("nav.login")}
                </SmartLink>
                <Button href="/signup" size="sm" className="hidden md:inline-flex">
                  {t("nav.getStarted")}
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
              aria-expanded={open}
              className="grid size-9 place-items-center rounded-full border border-border bg-background/60 text-foreground md:hidden cursor-pointer"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
      </Container>

      {/* Mobile menu */}
      <div
        className={cn(
          "overflow-hidden border-b border-border bg-background/95 backdrop-blur-xl transition-[max-height,opacity] duration-300 md:hidden",
          open ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <Container className="py-4">
          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <button
                key={l.id}
                onClick={() => onNav(l.id)}
                className="rounded-xl px-3 py-3 text-start text-base font-medium text-foreground/90 transition-colors hover:bg-muted cursor-pointer"
              >
                {t(l.key)}
              </button>
            ))}
            <SmartLink
              href="/blog"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-start text-base font-medium text-foreground/90 transition-colors hover:bg-muted"
            >
              {t("nav.blog")}
            </SmartLink>
          </nav>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-4">
            <LanguagePicker align="start" />
            <ThemeToggle />
          </div>
          <InstallButton
            label={t("install.button")}
            iosTitle={t("install.iosTitle")}
            iosBody={t("install.iosBody")}
            closeLabel={t("install.close")}
            className="mt-3 h-11 w-full justify-center"
          />
          {isSignedIn ? (
            <Button href="/dashboard" size="md" className="mt-3 w-full justify-center">
              {t("nav.goToDashboard", { defaultValue: "Go to dashboard" })}
            </Button>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button href="/login" variant="outline" size="md">
                {t("nav.login")}
              </Button>
              <Button href="/signup" size="md">
                {t("nav.getStarted")}
              </Button>
            </div>
          )}
        </Container>
      </div>
    </header>
  )
}
