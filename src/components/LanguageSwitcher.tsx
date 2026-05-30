import { useTranslation } from "react-i18next"
import { Languages, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/lib/i18n/use-language"

type Props = {
  // "icon": compact square button for the sidebar.
  // "full": full-width button showing the current language, for settings pages.
  variant?: "icon" | "full"
  align?: "start" | "center" | "end"
}

export function LanguageSwitcher({ variant = "icon", align = "end" }: Props) {
  const { t } = useTranslation()
  const { current, languages, changeLanguage } = useLanguage()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "icon" ? (
          <Button
            variant="outline"
            size="icon"
            className="group-data-[collapsible=icon]:size-10"
            aria-label={t("language.label")}
          >
            <Languages className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <Languages className="size-4" />
              {current.nativeName}
            </span>
            <span className="text-xs text-muted-foreground">{current.englishName}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel>{t("language.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => changeLanguage(lang.code)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex flex-col">
              <span className="text-sm">{lang.nativeName}</span>
              <span className="text-xs text-muted-foreground">{lang.englishName}</span>
            </span>
            {lang.code === current.code && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
