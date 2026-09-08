import type { ReactNode } from "react"
import { CardVisual } from "@/components/cards/CardVisual"
import { CardChip } from "@/components/cards/CardChip"
import { CardStack } from "@/components/cards/CardStack"
import { NetworkMark, networkLabel } from "@/components/cards/NetworkMark"
import { visualPropsFromCard, type CardVisualProps } from "@/components/cards/types"
import { CARD_NETWORKS, CARD_PATTERNS } from "@/lib/cards"
import { useCards } from "@/lib/use-cards"
import type { Card, CardPattern } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * DEV-ONLY visual gallery for the card components (/dev/card-gallery). Mounted
 * from App.tsx behind `import.meta.env.DEV`, so it never ships in a build —
 * which is why its headings are plain English rather than i18n keys.
 *
 * Use it to eyeball every tier / network / status / size in both themes and
 * at phone width before touching the real Cards surfaces.
 */

const HOLDER = "MAQBOOL THOUFEEQ"

const base: CardVisualProps = {
  kind: "debit",
  network: "visa",
  tier: "standard",
  bank_name: "Federal Bank",
  brand_domain: "federalbank.co.in",
  holder_name: HOLDER,
  last4: "4821",
  expiry_month: 9,
  expiry_year: 2029,
}

const TIERS: { title: string; props: CardVisualProps }[] = [
  { title: "Standard · default navy (no brand)", props: { ...base, bank_name: "My Bank", brand_domain: null } },
  { title: "Standard · curated (kotak.com)", props: { ...base, bank_name: "Kotak Mahindra", brand_domain: "kotak.com", network: "mastercard", name: "Salary account" } },
  { title: "Standard · brand_colors #004B8B", props: { ...base, bank_name: "HDFC Bank", brand_colors: [{ hex: "#004B8B", type: "brand" }], kind: "credit", network: "rupay" } },
  { title: "Standard · light brand (dark text)", props: { ...base, bank_name: "Commerzbank", brand_domain: "commerzbank.de", network: "maestro" } },
  { title: "Gold", props: { ...base, tier: "gold", kind: "credit", bank_name: "ICICI Bank", brand_domain: "icicibank.com", network: "visa" } },
  { title: "Platinum", props: { ...base, tier: "platinum", kind: "credit", bank_name: "Intesa Sanpaolo", brand_domain: "intesasanpaolo.com", network: "mastercard" } },
  { title: "Metal", props: { ...base, tier: "metal", kind: "credit", bank_name: "Revolut", brand_domain: "revolut.com", network: "visa" } },
  { title: "Black", props: { ...base, tier: "black", kind: "credit", bank_name: "American Express", network: "amex", name: "Centurion" } },
]

function customCard(pattern: CardPattern, text: "light" | "dark"): CardVisualProps {
  return {
    ...base,
    tier: "custom",
    kind: "credit",
    network: "mastercard",
    bank_name: "Monzo",
    design: text === "light" ? { from: "#7C3AED", to: "#1E1B4B", text, pattern } : { from: "#FDE68A", to: "#F59E0B", text, pattern },
    name: `${pattern} · ${text} text`,
  }
}

const STATUSES: { title: string; props: CardVisualProps }[] = [
  { title: "Active", props: base },
  { title: "Frozen", props: { ...base, status: "frozen" } },
  { title: "Closed", props: { ...base, status: "closed" } },
  { title: "Expired (active)", props: { ...base, expiry_month: 1, expiry_year: 2024 } },
  { title: "No number / holder / expiry", props: { ...base, last4: "", holder_name: "", expiry_month: null, expiry_year: null } },
  { title: "Long names", props: { ...base, bank_name: "Banca Popolare dell'Emilia Romagna", holder_name: "MARIA ANTONIETTA DELLA ROVERE SFORZA", name: "Household expenses – shared card" } },
]

const CHIP_CARD: CardChipCard = {
  id: "demo-visa",
  kind: "credit",
  network: "visa",
  tier: "standard",
  design: null,
  brand_colors: [{ hex: "#004B8B", type: "brand" }],
  last4: "4821",
  name: "HDFC Regalia",
  account_bank_name: "HDFC Bank",
  account_brand_domain: "hdfcbank.com",
}

type CardChipCard = Parameters<typeof CardChip>[0]["card"]

const CHIPS: { title: string; card: CardChipCard; variant?: "full" | "compact"; linked?: boolean }[] = [
  { title: "Credit · full", card: CHIP_CARD },
  { title: "Debit · full", card: { ...CHIP_CARD, id: "demo-debit", kind: "debit", network: "mastercard", tier: "standard", brand_colors: null, account_bank_name: "Kotak", account_brand_domain: "kotak.com", name: "" } },
  { title: "Compact", card: CHIP_CARD, variant: "compact" },
  { title: "Gold · no last4 (name)", card: { ...CHIP_CARD, id: "demo-gold", tier: "gold", last4: "", name: "" } },
  { title: "Black · not linked", card: { ...CHIP_CARD, id: "demo-black", tier: "black", network: "amex", last4: "1007", name: "Centurion" }, linked: false },
  { title: "Custom", card: { ...CHIP_CARD, id: "demo-custom", tier: "custom", design: { from: "#7C3AED", to: "#1E1B4B", text: "light", pattern: "waves" }, network: "rupay" } },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function Tile({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <figure className={cn("min-w-0 max-w-full space-y-2", className)}>
      {children}
      <figcaption className="text-xs text-muted-foreground">{title}</figcaption>
    </figure>
  )
}

function RealCards() {
  const { cards, loading } = useCards({ includeClosed: true })
  if (loading) return <p className="text-sm text-muted-foreground">Loading cards…</p>
  if (cards.length === 0) return <p className="text-sm text-muted-foreground">No cards in this workspace.</p>
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c: Card) => (
        <Tile key={c.id} title={`${c.name || "(no name)"} · ${c.kind} · ${c.status} · logo ${c.brand_logo_url ? "yes" : "no"}`}>
          <CardVisual {...visualPropsFromCard(c)} />
        </Tile>
      ))}
    </div>
  )
}

export function CardGalleryPage({ withRealCards = true }: { withRealCards?: boolean } = {}) {
  return (
    <div className="mx-auto max-w-6xl space-y-10 p-4 pb-24 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Card gallery</h1>
        <p className="text-sm text-muted-foreground">Dev-only preview of CardVisual, NetworkMark, CardChip and CardStack.</p>
      </header>

      <Section title="Tiers">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((x) => (
            <Tile key={x.title} title={x.title}>
              <CardVisual {...x.props} />
            </Tile>
          ))}
        </div>
      </Section>

      <Section title="Custom designs · every pattern, light + dark text">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARD_PATTERNS.map((p) => (
            <Tile key={`${p}-light`} title={`${p} · light`}>
              <CardVisual {...customCard(p, "light")} />
            </Tile>
          ))}
          {CARD_PATTERNS.map((p) => (
            <Tile key={`${p}-dark`} title={`${p} · dark`}>
              <CardVisual {...customCard(p, "dark")} />
            </Tile>
          ))}
        </div>
      </Section>

      <Section title="Networks">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {CARD_NETWORKS.map((n) => (
            <Tile key={n} title={networkLabel(n)}>
              <CardVisual {...base} network={n} size="sm" holder_name="" />
            </Tile>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4">
          {CARD_NETWORKS.map((n) => (
            <div key={n} className="flex items-center gap-3">
              <span className="rounded-md bg-slate-900 p-2">
                <NetworkMark network={n} tone="light" className="h-6" />
              </span>
              <span className="rounded-md bg-white p-2 ring-1 ring-black/10">
                <NetworkMark network={n} tone="dark" className="h-6 text-slate-900" />
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Statuses">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STATUSES.map((x) => (
            <Tile key={x.title} title={x.title}>
              <CardVisual {...x.props} />
            </Tile>
          ))}
        </div>
      </Section>

      <Section title="Sizes · sm (list) / md (grid) / lg (hero)">
        <div className="flex flex-wrap items-end gap-6">
          <Tile title="sm · 150px" className="w-[150px]">
            <CardVisual {...base} size="sm" name="Salary" />
          </Tile>
          <Tile title="sm · 200px (black)" className="w-[200px]">
            <CardVisual {...base} size="sm" tier="black" kind="credit" network="amex" bank_name="American Express" />
          </Tile>
          <Tile title="md · 340px" className="w-full max-w-[340px]">
            <CardVisual {...base} size="md" name="Salary account" />
          </Tile>
          <Tile title="lg · 560px" className="w-full max-w-[560px]">
            <CardVisual {...base} size="lg" tier="platinum" kind="credit" network="mastercard" bank_name="Intesa Sanpaolo" brand_domain="intesasanpaolo.com" name="Travel card" />
          </Tile>
        </div>
      </Section>

      {withRealCards && (
        <Section title="Real cards from this workspace (brand_logo_url + bank logo)">
          <RealCards />
        </Section>
      )}

      <Section title="CardChip · on a transaction row">
        <div className="divide-y overflow-hidden rounded-2xl border bg-card">
          {CHIPS.map((x) => (
            <button
              key={x.title}
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
              onClick={() => console.info("row click", x.title)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Grocery run · {x.title}</p>
                <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>Sep 5</span>
                  <span aria-hidden="true">·</span>
                  <CardChip card={x.card} variant={x.variant} linked={x.linked} />
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums">−€42.10</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="CardStack · empty state">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed p-6 text-center sm:flex-row sm:text-left">
          <CardStack className="w-56 max-w-full shrink-0" />
          <div className="max-w-md space-y-1">
            <p className="text-base font-semibold">No cards yet</p>
            <p className="text-sm text-muted-foreground">A debit card spends straight from a bank account. A credit card lets you pay later and settle the statement.</p>
          </div>
        </div>
      </Section>
    </div>
  )
}
