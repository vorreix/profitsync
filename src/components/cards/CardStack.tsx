import { CardVisual } from "@/components/cards/CardVisual"
import { cn } from "@/lib/utils"

/**
 * Decorative empty-state illustration: three ghost cards (black, gold and a
 * plain standard one — no bank, no number) fanned on top of each other, with a
 * slow float for users who allow motion. Purely visual: aria-hidden and
 * pointer-events-none; the copy next to it carries the meaning.
 *
 * Sizing: give it a width (`w-56`, `max-w-xs`…); the stack keeps a 1.25 ratio.
 */
export function CardStack({ className }: { className?: string }) {
  return (
    <div className={cn("card-stack", className)} aria-hidden="true">
      <div className="cs-slot">
        <div className="cs-float">
          <CardVisual still size="sm" kind="credit" network="mastercard" tier="black" last4="" holder_name="" />
        </div>
      </div>
      <div className="cs-slot">
        <div className="cs-float">
          <CardVisual still size="sm" kind="credit" network="visa" tier="gold" last4="" holder_name="" />
        </div>
      </div>
      <div className="cs-slot">
        <div className="cs-float">
          <CardVisual still size="sm" kind="debit" network="other" tier="standard" last4="" holder_name="" />
        </div>
      </div>
    </div>
  )
}
