import { Moon, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useTheme } from "../lib/useTheme"

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const { t } = useTranslation()
  const isDark = theme === "dark"
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? t("theme.toLight") : t("theme.toDark")}
      title={isDark ? t("theme.toLight") : t("theme.toDark")}
      className="grid size-9 place-items-center rounded-full border border-border bg-background/60 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
    >
      {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  )
}
