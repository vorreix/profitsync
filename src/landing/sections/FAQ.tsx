import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import { cn } from "../lib/cn"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"
import { SectionHeading } from "../components/SectionHeading"

type Item = { q: string; a: string }

export function FAQ() {
  const { t } = useTranslation()
  const items = t("faq.items", { returnObjects: true }) as Item[]
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faq" className="scroll-mt-24 py-20 sm:py-28">
      <Container>
        <SectionHeading eyebrow={t("faq.eyebrow")} title={t("faq.title")} subtitle={t("faq.subtitle")} />

        <Reveal className="mx-auto mt-12 max-w-3xl">
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {items.map((item, i) => {
              const isOpen = open === i
              return (
                <div key={item.q}>
                  <h3>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-4 px-5 py-5 text-start transition-colors hover:bg-muted/50 cursor-pointer sm:px-6"
                    >
                      <span className="text-[15px] font-semibold text-foreground sm:text-base">{item.q}</span>
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-full border border-border text-foreground transition-transform duration-300",
                          isOpen && "rotate-45 bg-foreground text-background",
                        )}
                      >
                        <Plus className="size-4" />
                      </span>
                    </button>
                  </h3>
                  <div
                    className={cn(
                      "grid transition-all duration-300 ease-out",
                      isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-6 text-[15px] leading-relaxed text-muted-foreground sm:px-6">{item.a}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
