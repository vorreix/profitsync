import { describe, expect, it } from "vitest"
import {
  CHROME_HIDE_AFTER,
  CHROME_MIN_SCROLLABLE,
  chromeFromGesture,
  initialChromeState,
  nextChromeState,
  type ChromeScrollState,
} from "./scroll-chrome"

const TALL = 4000

/** Feed a run of scroll positions through the model and return the end state. */
function scrollThrough(positions: number[], max = TALL, from: ChromeScrollState = initialChromeState) {
  return positions.reduce((s, y) => nextChromeState(s, y, max), from)
}

describe("nextChromeState", () => {
  it("starts visible and stays visible near the top", () => {
    expect(scrollThrough([0, 10, 20]).hidden).toBe(false)
  })

  it("hides once a downward scroll commits past the floor", () => {
    expect(scrollThrough([0, 40, 90, 140]).hidden).toBe(true)
  })

  it("does not hide inside the floor, however far the travel", () => {
    const justInside = CHROME_HIDE_AFTER - 2
    expect(scrollThrough([0, 20, justInside]).hidden).toBe(false)
  })

  it("hides on a page with only a little to scroll (the money-flow canvas)", () => {
    // /flow scrolls ~121px. A floor set for comfortable pages locked the chrome
    // on exactly the screens with the least room to spare.
    expect(scrollThrough([0, 60, 121], 121).hidden).toBe(true)
  })

  it("comes back on a small upward flick", () => {
    const down = scrollThrough([0, 90, 300, 600])
    expect(down.hidden).toBe(true)
    // Only 8px back up — deliberately easier than the 10px that hid it.
    expect(nextChromeState(down, 592, TALL).hidden).toBe(false)
  })

  it("ignores a wobble smaller than the thresholds", () => {
    const down = scrollThrough([0, 90, 300, 600])
    // A 3px jitter up mid-scroll must not flash the chrome back on.
    const wobbled = scrollThrough([597, 599, 601], TALL, down)
    expect(wobbled.hidden).toBe(true)
  })

  it("always reveals within 24px of the top, even while scrolling down", () => {
    const hidden = scrollThrough([0, 90, 400])
    expect(hidden.hidden).toBe(true)
    // A jump to the top (tab tap, anchor link) reveals regardless of direction.
    expect(nextChromeState(hidden, 0, TALL).hidden).toBe(false)
  })

  it("never hides from SCROLLING on a page that barely scrolls", () => {
    const short = CHROME_MIN_SCROLLABLE - 1
    expect(scrollThrough([0, 40, 90, short], short).hidden).toBe(false)
  })

  it("leaves a short page's state alone so a swipe is not undone by a resize", () => {
    // The gesture path owns an unscrollable page; a stray resize must not
    // silently put the chrome back.
    const swiped: ChromeScrollState = { y: 0, anchor: 0, dir: 0, hidden: true }
    expect(nextChromeState(swiped, 0, 40).hidden).toBe(true)
  })

  it("re-arms when a page with nothing to scroll grows into a scrollable one", () => {
    const onShort = scrollThrough([0, 30], 40)
    expect(onShort.hidden).toBe(false)
    expect(scrollThrough([90, 200, 400], TALL, onShort).hidden).toBe(true)
  })

  it("clamps rubber-banding past the top so an overscroll is not read as scrolling up", () => {
    const s = nextChromeState(initialChromeState, -120, TALL)
    expect(s.y).toBe(0)
    expect(s.hidden).toBe(false)
  })

  it("clamps rubber-banding past the bottom", () => {
    const s = scrollThrough([0, 90, TALL + 300])
    expect(s.y).toBe(TALL)
    expect(s.hidden).toBe(true)
  })

  it("hides again after a reveal when the user turns back down", () => {
    const down = scrollThrough([0, 90, 600])
    const up = nextChromeState(down, 580, TALL)
    expect(up.hidden).toBe(false)
    // Turning around: the anchor resets to 580, so 12px down re-hides.
    expect(scrollThrough([585, 592], TALL, up).hidden).toBe(true)
  })

  it("keeps the anchor at the turning point, not the newest frame", () => {
    const s = scrollThrough([0, 100, 300])
    const turned = nextChromeState(s, 295, TALL)
    expect(turned.dir).toBe(-1)
    expect(turned.anchor).toBe(300)
  })
})

describe("chromeFromGesture", () => {
  it("folds away on a committed pull up", () => {
    expect(chromeFromGesture(false, 40)).toBe(true)
  })

  it("ignores a pull too small to be deliberate", () => {
    expect(chromeFromGesture(false, 12)).toBe(false)
    expect(chromeFromGesture(true, -6)).toBe(true)
  })

  it("comes back on a shorter pull down than it took to hide", () => {
    expect(chromeFromGesture(true, -20)).toBe(false)
  })

  it("is a no-op when the gesture agrees with the current state", () => {
    expect(chromeFromGesture(true, 60)).toBe(true)
    expect(chromeFromGesture(false, -60)).toBe(false)
  })
})
