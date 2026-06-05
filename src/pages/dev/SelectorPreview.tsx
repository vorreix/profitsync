// DEV-ONLY harness to diagnose category-dropdown scrolling inside the dialog.
// Served at /dev/selector (no auth). Remove when done.
import { useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const CATS = Array.from({ length: 40 }, (_, i) => `Category ${i + 1}`)

export function SelectorPreview() {
  const [value, setValue] = useState("")
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-dvh bg-muted/40">
      <Dialog open>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
            <div className="space-y-1.5">
              <Label>Category (current structure: flex-col max-h parent + flex-1 child)</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {value || <span className="text-muted-foreground">Select…</span>}
                    <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[--radix-popover-trigger-width] flex-col overflow-hidden p-0" align="start">
                  <div className="p-2 border-b shrink-0"><Input placeholder="Search…" className="h-8 text-sm" /></div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-1" data-testid="cat-scroll">
                    {CATS.map((c) => (
                      <button key={c} type="button" className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={() => { setValue(c); setOpen(false) }}>
                        {c}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="h-40 rounded-lg border border-dashed" />
          </div>
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline">Cancel</Button>
            <Button>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
