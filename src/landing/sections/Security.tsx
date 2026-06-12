import type { LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ArchiveRestore, Building2, CreditCard, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"

type Item = { title: string; desc: string }

// Order matches security.items in the locale files.
const ICONS: LucideIcon[] = [Lock, CreditCard, Building2, KeyRound, EyeOff, ArchiveRestore]

/**
 * Security & privacy — the trust section. Sits right before Pricing on
 * purpose: the last question before someone pays is "can I trust you with my
 * money data?". Every claim here is true of the product (TLS + encrypted
 * storage, MoR checkout so cards never touch us, org isolation + member
 * roles, MFA-capable auth, no data selling, trash/restore) — no invented
 * certifications.
 */
export function Security() {
  const { t } = useTranslation()
  const items = t("security.items", { returnObjects: true }) as Item[]

  return (
    <section id="security" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="size-3.5" />
              {t("security.badge")}
            </span>
            <h2 className="ps-display mt-4 text-balance text-3xl font-bold leading-tight sm:text-4xl">
              {t("security.title")}
            </h2>
            <p className="mt-4 text-pretty text-base text-muted-foreground sm:text-lg">{t("security.subtitle")}</p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => {
            const Icon = ICONS[i]
            return (
              <Reveal key={item.title} delay={i * 60}>
                <div className="group h-full rounded-2xl border bg-card p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg">
                  <span className="grid size-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 transition-colors group-hover:bg-emerald-500/15 dark:text-emerald-400">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              </Reveal>
            )
          })}
        </div>

        <Reveal delay={120}>
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("security.legalLead")}{" "}
            <a href="/privacy-policy" className="font-medium text-foreground underline underline-offset-4 hover:text-emerald-600 dark:hover:text-emerald-400">
              {t("security.privacyLink")}
            </a>{" "}
            ·{" "}
            <a href="/terms-of-service" className="font-medium text-foreground underline underline-offset-4 hover:text-emerald-600 dark:hover:text-emerald-400">
              {t("security.termsLink")}
            </a>
          </p>
        </Reveal>
      </Container>
    </section>
  )
}
