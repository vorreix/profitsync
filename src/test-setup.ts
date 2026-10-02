// Vitest setup: make the UI language deterministic before anything reads it.
//
// `formatMoney` follows the reader's language (src/lib/wealth.ts moneyLocale),
// and i18next's browser detector falls back to the HOST's locale when there is
// no browser to ask. So the same assertion passed on a US CI runner and failed
// on an Italian laptop ("€2,061.00" vs "2.061,00 €"). Pinning the language
// after the fact is not enough: src/lib/i18n re-applies the detected language
// asynchronously at import. Pin the DETECTION source first, then import the
// module, so it never has a non-English language to re-apply.
//
// A test that cares about another language calls i18n.changeLanguage itself.
import { vi } from "vitest"

vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] })
await import("@/lib/i18n")
