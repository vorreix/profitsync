import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Globe } from "lucide-react"
import { cn } from "../lib/cn"
import { LANDING_LANGUAGES, getLandingLanguage } from "../i18n/languages"

export function LanguagePicker({ align = "end" }: { align?: "start" | "end" }) {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = getLandingLanguage(i18n.language)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("language.select")}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 text-sm font-medium text-foreground/80 backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
      >
        <Globe className="size-4" />
        <span className="hidden sm:inline">{current.nativeName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-[calc(100%+8px)] z-50 max-h-[60vh] w-48 overflow-auto rounded-2xl border border-border bg-popover p-1.5 shadow-xl ring-1 ring-black/5",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          {LANDING_LANGUAGES.map((lang) => {
            const active = lang.code === current.code
            return (
              <button
                key={lang.code}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  void i18n.changeLanguage(lang.code)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm transition-colors cursor-pointer",
                  active ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/70",
                )}
              >
                <span className="flex flex-col leading-tight">
                  <span>{lang.nativeName}</span>
                  <span className="text-[11px] text-muted-foreground">{lang.englishName}</span>
                </span>
                {active && <Check className="size-4 shrink-0 text-foreground" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
