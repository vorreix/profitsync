import { useTranslation } from "react-i18next"
import { Quote, Star } from "lucide-react"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"
import { SectionHeading } from "../components/SectionHeading"

// NOTE: illustrative personas / placeholder quotes — swap for real customer
// quotes before launch. No real names or companies are implied.
type Item = { quote: string; name: string; role: string }

export function Testimonials() {
  const { t } = useTranslation()
  const items = t("testimonials.items", { returnObjects: true }) as Item[]

  return (
    <section id="testimonials" className="border-t border-border bg-muted/30 py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow={t("testimonials.eyebrow")}
          title={t("testimonials.title")}
          subtitle={t("testimonials.subtitle")}
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item.name} delay={i * 90}>
              <figure className="flex h-full flex-col rounded-2xl border border-border bg-card p-7 shadow-sm">
                <Quote className="size-7 text-foreground/15" />
                <div className="mt-3 flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className="size-4 fill-emerald-500 text-emerald-500" />
                  ))}
                </div>
                <blockquote className="mt-4 flex-1 text-pretty text-[15px] leading-relaxed text-foreground/90">
                  “{item.quote}”
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-border pt-5">
                  <span className="grid size-10 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                    {item.name.charAt(0)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold text-foreground">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.role}</span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}
