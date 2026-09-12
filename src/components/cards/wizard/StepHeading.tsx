/**
 * One question per step, plus the single line that answers "why am I being
 * asked this?". Every step opens with it, so the wizard has one rhythm instead
 * of four different ones — and the heading doubles as the accessible label of
 * the step's first control (pass its `id` to the radiogroup's aria-labelledby).
 */
export function StepHeading({ id, title, help }: { id: string; title: string; help?: string }) {
  return (
    <div className="space-y-1">
      <h3 id={id} className="text-[15px] font-semibold leading-snug">
        {title}
      </h3>
      {help ? <p className="text-xs leading-relaxed text-muted-foreground">{help}</p> : null}
    </div>
  )
}
