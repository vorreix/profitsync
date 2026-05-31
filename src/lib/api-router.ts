// Minimal path router for the consolidated Vercel function (api/[...path].ts).
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, but each
// file under api/ becomes its own function. To stay under the limit, every
// route handler lives in api/_routes/** (ignored by Vercel because of the "_"
// prefix) and a single api/[...path].ts function dispatches to them using the
// table below. This module holds only the pure matching logic so it can be
// unit-tested without importing the handlers (which open DB connections).

export type RoutePattern<H> = {
  /** Path segments after `/api`. Use ":name" for a dynamic segment, e.g. ["clients", ":id"]. */
  segments: string[]
  handler: H
}

export type RouteMatch<H> = {
  handler: H
  params: Record<string, string>
}

/**
 * Match a request path (array of segments) against an ordered list of route
 * patterns. Patterns are tested in order and the first whose length and literal
 * segments all match wins — so list a static route before a dynamic sibling of
 * the same length (e.g. ["organizations", "switch"] before ["organizations", ":id"]).
 * Dynamic segments (":name") are captured into `params`.
 */
export function matchRoute<H>(routes: RoutePattern<H>[], path: string[]): RouteMatch<H> | null {
  for (const route of routes) {
    if (route.segments.length !== path.length) continue
    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i]
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = path[i]
      } else if (seg !== path[i]) {
        matched = false
        break
      }
    }
    if (matched) return { handler: route.handler, params }
  }
  return null
}
