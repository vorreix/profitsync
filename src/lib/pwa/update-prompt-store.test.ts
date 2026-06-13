import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  acceptUpdate,
  dismissUpdate,
  getUpdatePromptState,
  offerUpdate,
  resetUpdatePromptStoreForTests,
  subscribeUpdatePrompt,
} from "./update-prompt-store"

beforeEach(() => {
  resetUpdatePromptStoreForTests()
})

describe("update-prompt-store", () => {
  it("starts hidden", () => {
    expect(getUpdatePromptState()).toEqual({ updateAvailable: false, updating: false })
  })

  it("offerUpdate shows the prompt and notifies subscribers", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeUpdatePrompt(listener)
    offerUpdate(() => {})
    expect(getUpdatePromptState().updateAvailable).toBe(true)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it("acceptUpdate flips to updating and invokes apply exactly once", () => {
    const apply = vi.fn()
    offerUpdate(apply)
    acceptUpdate()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(getUpdatePromptState()).toEqual({ updateAvailable: true, updating: true })
    // Re-accepting while updating must not re-run apply (double-click guard).
    acceptUpdate()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it("dismiss hides the prompt but a later offer (next release) re-shows it", () => {
    offerUpdate(() => {})
    dismissUpdate()
    expect(getUpdatePromptState().updateAvailable).toBe(false)
    offerUpdate(() => {})
    expect(getUpdatePromptState().updateAvailable).toBe(true)
  })

  it("dismiss is ignored while the update is being applied", () => {
    offerUpdate(() => {})
    acceptUpdate()
    dismissUpdate()
    expect(getUpdatePromptState().updating).toBe(true)
  })

  it("a new offer during an in-flight update is ignored (no double SKIP_WAITING)", () => {
    const apply1 = vi.fn()
    const apply2 = vi.fn()
    offerUpdate(apply1)
    acceptUpdate()
    expect(getUpdatePromptState().updating).toBe(true)
    // A second deploy lands while the first update is activating: the offer must
    // not re-enable the button or swap the apply callback mid-flight.
    offerUpdate(apply2)
    expect(getUpdatePromptState()).toEqual({ updateAvailable: true, updating: true })
    acceptUpdate()
    expect(apply1).toHaveBeenCalledTimes(1)
    expect(apply2).not.toHaveBeenCalled()
  })
})
