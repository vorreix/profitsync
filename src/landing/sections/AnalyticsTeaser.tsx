import { useTranslation } from "react-i18next"
import { ArrowRight, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { Reveal } from "../components/Reveal"

// Static, illustrative bars (relative heights) — purely decorative marketing.
const BARS = [
  { in: 62, out: 40 },
  { in: 78, out: 52 },
  { in: 55, out: 48 },
  { in: 90, out: 60 },
  { in: 72, out: 44 },
  { in: 100, out: 66 },
]

export function AnalyticsTeaser() {
  const { t } = useTranslation()
  return (
    <section id="analytics" className="py-16 sm:py-24">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <TrendingUp className="size-3.5 text-emerald-500" /> {t("analyticsTeaser.badge")}
              </span>
              <h2 className="ps-display mt-4 text-balance text-3xl font-bold leading-[1.1] sm:text-[2.5rem]">
                {t("analyticsTeaser.title")}
              </h2>
              <p className="mt-4 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
                {t("analyticsTeaser.subtitle")}
              </p>
              <div className="mt-7">
                <Button href="/login" size="lg" className="group">
                  {t("analyticsTeaser.cta")}
                  <ArrowRight className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </Button>
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            {/* Compact analytics card — sized to feel right on a phone first. */}
            <div className="mx-auto w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{t("analyticsTeaser.cardTitle")}</p>
                <span className="text-[11px] text-muted-foreground">{t("analyticsTeaser.cardRange")}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ArrowUpRight className="size-3 text-emerald-500" />{t("analyticsTeaser.income")}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">$48.2k</p>
                </div>
                <div className="rounded-xl border border-border p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ArrowDownRight className="size-3 text-red-500" />{t("analyticsTeaser.expense")}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums text-red-600 dark:text-red-400">$19.6k</p>
                </div>
                <div className="rounded-xl border border-border p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("analyticsTeaser.profit")}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">$28.6k</p>
                </div>
              </div>
              <div className="mt-5 flex h-28 items-end justify-between gap-2">
                {BARS.map((b, i) => (
                  <div key={i} className="flex flex-1 items-end justify-center gap-0.5">
                    <div className="w-1.5 rounded-t bg-emerald-500/80" style={{ height: `${b.in}%` }} />
                    <div className="w-1.5 rounded-t bg-red-500/70" style={{ height: `${b.out}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500/80" />{t("analyticsTeaser.income")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500/70" />{t("analyticsTeaser.expense")}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}
