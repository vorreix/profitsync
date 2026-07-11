// Transaction tags — historical entry point. The logic now lives in the generic
// `src/lib/tags.ts` (shared across transactions, clients and quotations); this
// module re-exports it under the original transaction-specific names so existing
// call sites (tx form, API routes, tests) keep working unchanged.

import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normalizeTag,
  cleanTags,
  parseTagDraft,
  mergeTags,
  entityTags,
} from "./tags.js"

export const MAX_TRANSACTION_TAGS = MAX_TAGS
export const MAX_TRANSACTION_TAG_LENGTH = MAX_TAG_LENGTH

/** @deprecated use normalizeTag from ./tags */
export const normalizeTransactionTag = normalizeTag
/** @deprecated use cleanTags from ./tags */
export const cleanTransactionTags = cleanTags
/** @deprecated use entityTags from ./tags */
export const txTags = entityTags

export { parseTagDraft, mergeTags }
