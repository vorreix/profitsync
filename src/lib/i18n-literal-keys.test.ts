// Every literal key the app passes to t() must exist in en.json.
//
// `npm run i18n:check` only compares the OTHER locales against en.json, so a key
// that was never added to en.json at all passes it — and i18next then renders
// the key itself. That is how every report screen printed the literal text
// "fx.excludedNotice" (MC-037). This scans the source for `t("…")` calls with a
// literal key and resolves each the way i18next does here: under the file's
// `useTranslation("ns")` namespaces (or an explicit `{ ns }` option), then the
// root `translation` namespace (fallbackNS), with plural forms.
//
// The landing site (src/landing) runs its own i18next instance and locale
// files, so it is out of scope. KNOWN_MISSING is the backlog this test found on
// its first run; it may only shrink.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")
const KNOWN_MISSING = new Set([
  "src/components/ClientDetailSheet.tsx: clientSince",
  "src/components/ClientDetailSheet.tsx: open",
  "src/components/ClientDetailSheet.tsx: editButton",
  "src/components/ClientOverviewModal.tsx: attachments.uploaded",
  "src/components/MobileSearchOverlay.tsx: common.close",
  "src/pages/BudgetDetailPage.tsx: common.back",
  "src/pages/BudgetDetailPage.tsx: common.moreActions",
  "src/pages/ClientBudgetDetailPage.tsx: common.back",
  "src/pages/OrgMembersPage.tsx: invitationCreatedCopyLink",
])

function flatten(obj: Record<string, unknown>, prefix = "", out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object") flatten(v as Record<string, unknown>, key, out)
    else out.add(key)
  }
  return out
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== "landing" && name !== "i18n" && name !== "node_modules") sourceFiles(path, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

describe("literal i18n keys", () => {
  it("every literal t() key used in src exists in en.json", () => {
    const en = flatten(JSON.parse(readFileSync(join(SRC, "lib/i18n/locales/en.json"), "utf8")))
    const exists = (key: string) => ["", "_one", "_other"].some((suffix) => en.has(key + suffix))
    const missing = new Set<string>()
    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, "utf8")
      if (!src.includes("react-i18next") && !src.includes("@/lib/i18n")) continue
      const namespaces = [...src.matchAll(/useTranslation\(\s*["'](\w+)["']/g)].map((m) => m[1])
      for (const m of src.matchAll(/\bt\(\s*["']([A-Za-z][\w.]*)["']\s*(?:,\s*\{([^}]*)\})?/g)) {
        const key = m[1]
        const ns = m[2]?.match(/\bns:\s*["'](\w+)["']/)?.[1]
        const prefixes = ns ? [ns, ""] : [...namespaces, ""]
        if (!prefixes.some((p) => exists(p ? `${p}.${key}` : key))) missing.add(`${relative(join(SRC, ".."), file)}: ${key}`)
      }
    }
    expect([...missing].filter((m) => !KNOWN_MISSING.has(m))).toEqual([])
    // A backlog entry that is no longer missing must leave the list, or the key
    // could later disappear again and pass unnoticed.
    expect([...KNOWN_MISSING].filter((m) => !missing.has(m))).toEqual([])
  })
})
