import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Container } from "../components/Container"
import { Logo } from "../components/Logo"
import { Button } from "../components/Button"
import { SmartLink } from "../components/SmartLink"
import { ThemeToggle } from "../components/ThemeToggle"
import { LanguagePicker } from "../components/LanguagePicker"
import { Footer } from "../sections/Footer"

// Marketing chrome (header + footer) for the public blog pages. Mirrors the
// landing's look but with a simple route-based header instead of the in-page
// scroll nav. Rendered inside the landing's <I18nextProvider> by the page
// components, so useTranslation() resolves against the landing locale.
export function BlogShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="ps-landing flex min-h-dvh flex-col bg-background text-foreground antialiased">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <Container>
          <div className="flex h-16 items-center justify-between gap-4">
            <Logo />
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex">
                <LanguagePicker />
                <ThemeToggle />
              </div>
              <SmartLink
                href="/login"
                className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground md:inline-flex"
              >
                {t("nav.login")}
              </SmartLink>
              <Button href="/signup" size="sm">
                {t("nav.getStarted")}
              </Button>
            </div>
          </div>
        </Container>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
