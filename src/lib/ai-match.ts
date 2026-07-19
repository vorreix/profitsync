// Pure, import-free entity-matching helpers for the AI quick-add feature.
// The model returns a raw client-name guess; the SERVER resolves it against the
// org's real clients here (normalize → exact → prefix/contains → Jaro-Winkler).
// The model never emits IDs, so a hallucinated or injected name can only ever
// map to a real, org-scoped client — or to nothing.

export type MatchCandidate = { id: string; name: string }

export type ClientMatchResult =
  | { kind: "match"; id: string }
  | { kind: "ambiguous"; candidates: MatchCandidate[] }
  | { kind: "none" }

// Lowercase, strip LATIN diacritics (U+0300–U+036F after NFKD), collapse
// whitespace, drop punctuation. Non-Latin scripts survive intact: their
// combining marks (Indic vowel signs, Arabic harakat, …) are \p{M} and are
// deliberately kept by the allowlist below.
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC")
}

// Jaro-Winkler similarity (0..1). Standard implementation; prefix bonus 0.1.
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (la === 0 || lb === 0) return 0
  const matchWindow = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aMatched = new Array<boolean>(la).fill(false)
  const bMatched = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchWindow)
    const end = Math.min(i + matchWindow + 1, lb)
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = true
      bMatched[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < la; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const jaro = (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  for (let i = 0; i < Math.min(4, la, lb); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

const STRONG = 0.93 // unambiguous single winner
const CANDIDATE = 0.86 // close enough to offer as a "did you mean" chip

/**
 * Resolve a raw name guess against the org's clients.
 * - exact normalized match → match
 * - one clearly-best fuzzy hit (≥STRONG, with a gap to #2) → match
 * - several close hits → ambiguous with up to 3 candidates (UI shows chips)
 * - nothing close → none (field left empty; abstain over guessing)
 */
export function resolveClientName(raw: string | null | undefined, clients: MatchCandidate[]): ClientMatchResult {
  if (!raw) return { kind: "none" }
  const q = normalizeName(raw)
  if (!q) return { kind: "none" }

  const scored = clients.map((c) => {
    const n = normalizeName(c.name)
    let score = jaroWinkler(q, n)
    // Substring/prefix containment is a strong signal fuzzy distance undervalues
    // for short queries ("acme" vs "Acme Corp GmbH").
    if (n === q) score = 1
    else if (n.startsWith(q) || q.startsWith(n)) score = Math.max(score, 0.95)
    else if (n.includes(q) || q.includes(n)) score = Math.max(score, 0.9)
    return { c, score }
  }).sort((x, y) => y.score - x.score)

  const best = scored[0]
  if (!best || best.score < CANDIDATE) return { kind: "none" }
  const second = scored[1]
  const clearWinner = best.score >= STRONG && (!second || second.score < CANDIDATE || best.score - second.score >= 0.05)
  if (clearWinner) return { kind: "match", id: best.c.id }
  const candidates = scored.filter((s) => s.score >= CANDIDATE).slice(0, 3).map((s) => s.c)
  if (candidates.length === 1) return { kind: "match", id: candidates[0].id }
  return { kind: "ambiguous", candidates }
}

/** Case-insensitive exact category resolution — anything less exact stays null. */
export function resolveCategory(raw: string | null | undefined, categories: string[]): string | null {
  if (!raw) return null
  const q = normalizeName(raw)
  return categories.find((c) => normalizeName(c) === q) ?? null
}
