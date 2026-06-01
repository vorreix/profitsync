import { useEffect, useRef, useState } from "react"

// Reveal-on-scroll using IntersectionObserver. Respects prefers-reduced-motion
// by showing content immediately (no animation) for users who ask for less motion.
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}
