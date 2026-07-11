import { sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"

// Cross-entity tag mutations. A tag lives as a string inside each row's `tags`
// jsonb array on transactions / clients / quotations. These helpers rewrite
// those arrays org-scoped and case-insensitively (an inline-typed tag can differ
// in casing from the registry spelling), keeping the array a deduped set.
//
// Transactions are org-scoped through their client (no organization_id column);
// clients and quotations carry organization_id directly.

/**
 * Rename `oldName` → `newName` everywhere it appears (case-insensitive match).
 * Elements that collapse onto an existing element are deduped away.
 */
export async function renameTagEverywhere(orgId: string, oldName: string, newName: string): Promise<void> {
  await db.execute(sql`
    update transactions t
    set tags = (
      select coalesce(jsonb_agg(distinct elem), '[]'::jsonb)
      from (
        select case when lower(e) = lower(${oldName}) then ${newName} else e end as elem
        from jsonb_array_elements_text(t.tags) e
      ) x
    )
    from clients c
    where c.id = t.client_id and c.organization_id = ${orgId}
      and exists (select 1 from jsonb_array_elements_text(t.tags) e where lower(e) = lower(${oldName}))`)

  for (const table of ["clients", "quotations"] as const) {
    await db.execute(sql`
      update ${sql.identifier(table)}
      set tags = (
        select coalesce(jsonb_agg(distinct elem), '[]'::jsonb)
        from (
          select case when lower(e) = lower(${oldName}) then ${newName} else e end as elem
          from jsonb_array_elements_text(tags) e
        ) x
      )
      where organization_id = ${orgId}
        and exists (select 1 from jsonb_array_elements_text(tags) e where lower(e) = lower(${oldName}))`)
  }
}
