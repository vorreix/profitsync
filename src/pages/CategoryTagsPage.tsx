import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Tag, Hash } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CategoriesPanel } from "@/components/categories/CategoriesPanel"
import { TagsPanel } from "@/components/categories/TagsPanel"

const TABS = ["category", "tags"]

/**
 * Category & Tags — a tabbed shell replacing the old standalone Categories page.
 * The active tab is reflected in the URL (?tab=tags) so it's deep-linkable.
 */
export function CategoryTagsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get("tab")
  const activeTab = tabParam && TABS.includes(tabParam) ? tabParam : "category"
  const setActiveTab = (tab: string) =>
    setSearchParams(
      (prev) => {
        if (tab === "category") prev.delete("tab")
        else prev.set("tab", tab)
        return prev
      },
      { replace: true },
    )

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("categoryTags.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">{t("categoryTags.subtitle")}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="category" className="gap-1.5">
            <Tag className="size-4" />
            {t("categoryTags.categoryTab")}
          </TabsTrigger>
          <TabsTrigger value="tags" className="gap-1.5">
            <Hash className="size-4" />
            {t("categoryTags.tagsTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="category" className="mt-4">
          <CategoriesPanel />
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <TagsPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
