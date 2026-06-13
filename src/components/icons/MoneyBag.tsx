import { createLucideIcon } from "lucide-react"

/**
 * Money-bag glyph in lucide's line-art style. Lucide ships no sack/money-bag
 * icon, so this is built with `createLucideIcon` — making it a genuine
 * `LucideIcon` (same props, `size`, ref, and `icon: typeof SomeLucideIcon`
 * type-compatibility) so it drops in anywhere a lucide icon is used.
 */
export const MoneyBag = createLucideIcon("MoneyBag", [
  // tied neck of the sack
  ["path", { d: "M9 3h6l-1 3.5h-4z", key: "neck" }],
  // sack body
  ["path", { d: "M10 6.5C6 8 4 12 4 15c0 3.3 3.6 5.5 8 5.5s8-2.2 8-5.5c0-3-2-7-6-8.5", key: "body" }],
  // dollar mark
  ["path", { d: "M12 10.5v6", key: "bar" }],
  ["path", { d: "M13.8 11.4c-.8-.7-2.8-.7-2.8.6 0 1.2 2 1.2 2 2.5 0 1.4-2 1.4-2.8.7", key: "curve" }],
])
