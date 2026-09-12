// Shared prop shape for the wizard steps (kept out of the components so React
// Fast Refresh only sees component exports there).
import type { CardWizardForm, CardWizardMode } from "@/lib/card-wizard"

export type { Card, CardKind, WealthAccount } from "@/lib/types"

export type CardWizardModeProps = {
  form: CardWizardForm
  onChange: (patch: Partial<CardWizardForm>) => void
  mode: CardWizardMode
}
