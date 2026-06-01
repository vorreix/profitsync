import type { LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Coins,
  FileText,
  Languages,
  Paperclip,
  Users,
  UsersRound,
} from "lucide-react"
import { cn } from "../lib/cn"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"
import { SectionHeading } from "../components/SectionHeading"

type Item = { title: string; desc: string }

// Icon per feature, in the same order as features.items in the locale files.
const ICONS: LucideIcon[] = [Users, ArrowLeftRight, FileText, Coins, UsersRound, BarChart3, Paperclip, Languages]

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  )
}

function IconBadge({ Icon }: { Icon: LucideIcon }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background text-foreground transition-colors duration-300 group-hover:border-emerald-500/40 group-hover:bg-emerald-500/10 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
      <Icon className="size-5" />
    </span>
  )
}

export function Features() {
  const { t } = useTranslation()
  const items = t("features.items", { returnObjects: true }) as Item[]
  const big = items.slice(0, 2)
  const rest = items.slice(2)

  return (
    <section id="features" className="scroll-mt-24 py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow={t("features.eyebrow")}
          title={t("features.title")}
          subtitle={t("features.subtitle")}
        />

        <div className="mt-14 space-y-4">
          {/* Two highlight cards with small live-style visuals */}
          <div className="grid gap-4 sm:grid-cols-2">
            {big.map((item, i) => {
              const Icon = ICONS[i]
              return (
                <Reveal key={item.title} delay={i * 80}>
                  <CardShell className="sm:min-h-[15rem]">
                    <div className="flex items-start gap-4">
                      <IconBadge Icon={Icon} />
                      <div>
                        <h3 className="ps-display text-lg font-semibold text-foreground">{item.title}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                    {i === 0 ? <ClientsVisual /> : <MoneyVisual />}
                  </CardShell>
                </Reveal>
              )
            })}
          </div>

          {/* Compact feature cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((item, i) => {
              const Icon = ICONS[i + 2]
              return (
                <Reveal key={item.title} delay={(i % 3) * 70}>
                  <CardShell>
                    <IconBadge Icon={Icon} />
                    <h3 className="ps-display mt-4 text-base font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                  </CardShell>
                </Reveal>
              )
            })}
          </div>
        </div>
      </Container>
    </section>
  )
}

function ClientsVisual() {
  const { t } = useTranslation()
  return (
    <div className="mt-auto space-y-2 pt-6">
      {["Northwind Studio", "Lumen & Co.", "Atlas Freelance"].map((name, i) => (
        <div
          key={name}
          className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
              {name.charAt(0)}
            </span>
            <span className="text-[13px] font-medium text-foreground/90">{name}</span>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              i === 0
                ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {i === 0 ? t("features.visual.active") : t("features.visual.inactive")}
          </span>
        </div>
      ))}
    </div>
  )
}

function MoneyVisual() {
  const { t } = useTranslation()
  return (
    <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <ArrowDownLeft className="size-3.5" /> {t("features.visual.incoming")}
        </span>
        <p className="ps-tnum mt-1 text-lg font-bold text-foreground">$32,900</p>
      </div>
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <ArrowUpRight className="size-3.5" /> {t("features.visual.outgoing")}
        </span>
        <p className="ps-tnum mt-1 text-lg font-bold text-foreground/80">$11,360</p>
      </div>
    </div>
  )
}
