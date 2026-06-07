import { useTranslation } from "react-i18next"
import { RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The recovery card shown by AppErrorBoundary. A separate (function) component so
 * it can use the `useTranslation` hook a class boundary can't — i18n is
 * initialised in main.tsx before <App/>, so the hook is safe here.
 */
export function AppErrorFallback({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-lg font-semibold">{t("errorBoundary.title")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("errorBoundary.message")}</p>
      </div>
      <Button onClick={onReload} className="gap-2">
        <RotateCw className="size-4" />
        {t("errorBoundary.reload")}
      </Button>
    </div>
  )
}
