/**
 * Should the mobile shell's chrome be out of the way?
 *
 * The header, the tab bar and the floating action stack cost roughly a fifth of
 * a phone screen, permanently. They earn it while the user is deciding where to
 * go and lose it the moment the user is reading. So: scrolling DOWN into
 * content folds them away, scrolling UP brings them straight back.
 *
 * THE ANCHOR IS THE WHOLE TRICK. Deciding from the frame-to-frame delta makes
 * the header strobe, because a real thumb-scroll is not monotonic — it wobbles
 * a pixel either way, and every wobble would be a direction change. Instead we
 * remember where the finger last TURNED (`anchor`) and measure travel from
 * there, so the chrome only moves once a gesture has genuinely committed.
 *
 * Coming back is deliberately easier than going away (6px up vs 10px down past
 * a 72px floor): a user who wants the tab bar wants it NOW, and a user who is
 * reading rarely regrets a header that stayed one flick too long.
 *
 * Pure on purpose — the hook in `src/hooks/use-chrome-hidden.ts` only feeds it
 * scroll positions, so the awkward parts (rubber-banding, short pages, a
 * direction change mid-flick) are testable without a browser.
 */

/** Within this many pixels of the top, the chrome is always shown. */
export const CHROME_REVEAL_AT = 24
/** Never hide before the page has actually been scrolled this far. */
export const CHROME_HIDE_AFTER = 48
/** Downward travel from the last turn before the chrome folds away. */
export const CHROME_DOWN_DELTA = 10
/** Upward travel from the last turn before it comes back. Lower on purpose. */
export const CHROME_UP_DELTA = 6
/**
 * Below this much scrollable height the GESTURE path takes over (see
 * `chromeFromGesture`) — there is not enough travel for the scroll rules to
 * mean anything.
 *
 * Kept deliberately just above `CHROME_HIDE_AFTER`, not at some comfortable
 * round number: the money-flow canvas scrolls 121px and a short budgets page
 * about the same, and a higher floor locked the chrome on exactly the screens
 * where a phone has the least room. There is no flicker to protect against
 * either — the header is `sticky` and the tab bar is `fixed`, so folding them
 * away moves no layout and cannot change how far the document scrolls.
 */
export const CHROME_MIN_SCROLLABLE = 72
/** Pull-up travel that folds the chrome away on a page that cannot scroll. */
export const CHROME_GESTURE_HIDE = 28
/** ...and the shorter pull-down that brings it back. */
export const CHROME_GESTURE_SHOW = 18

export type ChromeScrollState = {
  /** Last clamped scroll position. */
  y: number
  /** Where the scroll direction last reversed. */
  anchor: number
  /** 1 = moving down the page, -1 = moving up, 0 = not yet moved. */
  dir: 1 | -1 | 0
  hidden: boolean
}

export const initialChromeState: ChromeScrollState = { y: 0, anchor: 0, dir: 0, hidden: false }

export function nextChromeState(prev: ChromeScrollState, rawY: number, maxScroll: number): ChromeScrollState {
  // iOS rubber-banding reports positions past both ends of the document, and a
  // negative delta from an overscroll at the TOP would otherwise read as "the
  // user is scrolling up" and fight the reveal rule below.
  const limit = Math.max(0, maxScroll)
  const y = Math.max(0, Math.min(rawY, limit))

  // Not "hidden: false": on a page this short the GESTURE path below owns the
  // decision, and a resize event forcing the chrome back would undo the user's
  // swipe for no reason.
  if (limit < CHROME_MIN_SCROLLABLE) return { y, anchor: y, dir: 0, hidden: prev.hidden }

  const delta = y - prev.y
  let dir = prev.dir
  let anchor = prev.anchor
  if (delta > 0 && prev.dir !== 1) {
    dir = 1
    anchor = prev.y
  } else if (delta < 0 && prev.dir !== -1) {
    dir = -1
    anchor = prev.y
  }

  let hidden = prev.hidden
  if (y <= CHROME_REVEAL_AT) hidden = false
  else if (dir === 1 && y > CHROME_HIDE_AFTER && y - anchor > CHROME_DOWN_DELTA) hidden = true
  else if (dir === -1 && anchor - y > CHROME_UP_DELTA) hidden = false

  return { y, anchor, dir, hidden }
}

/**
 * The same decision, driven by the raw gesture instead of by scrolling.
 *
 * A page with nothing to scroll never fires a scroll event, so on the money-flow
 * canvas (a fixed-height graph) or a budgets page with three budgets on it the
 * chrome could never be dismissed at all — which is exactly where a phone screen
 * is most cramped and the user most wants it gone. So when the document cannot
 * scroll, the finger itself drives it: a short pull up folds the chrome away, a
 * shorter pull down brings it back.
 *
 * `travel` is how far the CONTENT has been pulled up — a finger sliding up the
 * screen, the universal "show me more" gesture, is positive. Thresholds are
 * smaller than the scroll ones because there is no momentum here: every pixel is
 * deliberate.
 */
export function chromeFromGesture(hidden: boolean, travel: number): boolean {
  if (travel >= CHROME_GESTURE_HIDE) return true
  if (travel <= -CHROME_GESTURE_SHOW) return false
  return hidden
}
