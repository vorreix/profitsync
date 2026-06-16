import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { FEATURE_HELP_CONTENT, type FeatureHelpId } from "@/lib/help/feature-help-content"
import { cn } from "@/lib/utils"

type FeatureHelpProps = {
  feature: FeatureHelpId
  className?: string
}

export function FeatureHelp({ feature, className }: FeatureHelpProps) {
  const { t } = useTranslation()
  const content = FEATURE_HELP_CONTENT[feature]
  const title = t(content.titleKey)
  const includes = content.includesKeys?.map((key) => t(key)) ?? []

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "border border-border/70 bg-background/70 text-muted-foreground shadow-xs",
            "hover:border-primary/35 hover:bg-primary/5 hover:text-foreground",
            "focus-visible:border-primary/50 focus-visible:bg-primary/5 focus-visible:text-foreground",
            className
          )}
          aria-label={t("featureHelp.open", { feature: title })}
        >
          <Info className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-4 sm:p-5">
        <DialogHeader className="gap-1.5 pr-6">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-snug">
            {t(content.bodyKey)}
          </DialogDescription>
        </DialogHeader>
        {includes.length > 0 && (
          <div className="rounded-md border bg-muted/35 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("featureHelp.includes")}
            </p>
            <ul className="mt-1.5 space-y-1 text-xs leading-snug text-muted-foreground">
              {includes.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1.5 size-1 rounded-full bg-primary/60" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-1.5 text-xs leading-snug text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{t("featureHelp.why")}: </span>
            {t(content.whyKey)}
          </p>
          {content.tipKey && (
            <p>
              <span className="font-medium text-foreground">{t("featureHelp.tip")}: </span>
              {t(content.tipKey)}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
