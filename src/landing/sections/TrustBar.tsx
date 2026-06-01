import { useTranslation } from "react-i18next"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"

export function TrustBar() {
  const { t } = useTranslation()
  const items = t("trust.items", { returnObjects: true }) as string[]

  return (
    <section className="border-y border-border/70 bg-muted/30 py-10">
      <Container>
        <Reveal className="flex flex-col items-center gap-6">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {t("trust.title")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-3">
            {items.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground/80 shadow-sm"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {label}
              </span>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
