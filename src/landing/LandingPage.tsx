import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Navbar } from "./sections/Navbar"
import { Hero } from "./sections/Hero"
import { TrustBar } from "./sections/TrustBar"
import { Features } from "./sections/Features"
import { HowItWorks } from "./sections/HowItWorks"
import { AnalyticsTeaser } from "./sections/AnalyticsTeaser"
import { ValueBand } from "./sections/ValueBand"
import { Pricing } from "./sections/Pricing"
import { Referral } from "./sections/Referral"
import { Testimonials } from "./sections/Testimonials"
import { FAQ } from "./sections/FAQ"
import { CTA } from "./sections/CTA"
import { Footer } from "./sections/Footer"

export function LandingPage() {
  const { t, i18n } = useTranslation()

  // Keep the document title in sync with the active language.
  useEffect(() => {
    document.title = t("meta.title")
    const desc = document.querySelector('meta[name="description"]')
    if (desc) desc.setAttribute("content", t("meta.description"))
  }, [t, i18n.language])

  return (
    <div className="ps-landing min-h-dvh bg-background text-foreground antialiased">
      <Navbar />
      <main>
        <Hero />
        <TrustBar />
        <Features />
        <HowItWorks />
        <AnalyticsTeaser />
        <ValueBand />
        <Pricing />
        <Referral />
        <Testimonials />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
