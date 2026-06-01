import { useTranslation } from "react-i18next"
import { Container } from "../components/Container"
import { Logo } from "../components/Logo"
import { LanguagePicker } from "../components/LanguagePicker"
import { SmartLink } from "../components/SmartLink"

export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  const columns: { heading: string; links: { label: string; href: string }[] }[] = [
    {
      heading: t("footer.productHeading"),
      links: [
        { label: t("footer.links.features"), href: "#features" },
        { label: t("footer.links.pricing"), href: "#pricing" },
        { label: t("footer.links.faq"), href: "#faq" },
      ],
    },
    {
      heading: t("footer.companyHeading"),
      links: [
        { label: t("footer.links.login"), href: "/login" },
        { label: t("footer.links.signup"), href: "/signup" },
      ],
    },
    {
      heading: t("footer.legalHeading"),
      links: [
        { label: t("footer.links.privacy"), href: "/privacy-policy" },
        { label: t("footer.links.terms"), href: "/terms-of-service" },
      ],
    },
  ]

  return (
    <footer className="border-t border-border bg-muted/30">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("footer.tagline")}</p>
            <div className="mt-6">
              <LanguagePicker align="start" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.heading}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{col.heading}</h3>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <SmartLink
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </SmartLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-8 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {year} ProfitSync. {t("footer.rights")}
          </p>
          <div className="flex items-center gap-4">
            <SmartLink href="/privacy-policy" className="text-xs text-muted-foreground hover:text-foreground">
              {t("footer.links.privacy")}
            </SmartLink>
            <SmartLink href="/terms-of-service" className="text-xs text-muted-foreground hover:text-foreground">
              {t("footer.links.terms")}
            </SmartLink>
          </div>
        </div>
      </Container>
    </footer>
  )
}
