import { useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Button } from "@/components/ui/button"
import { ArrowLeft, TrendingUp } from "lucide-react"
import type { ReactNode } from "react"

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    // No-op: legal pages are public.
  }, [isLoaded, isSignedIn])

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight">ProfitSync</span>
          </Link>
          <span className="ml-auto text-xs text-muted-foreground">{title}</span>
          {isSignedIn && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="size-3.5 mr-1.5" />
              Back to app
            </Button>
          )}
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <article className="prose prose-sm dark:prose-invert max-w-none">
          {children}
        </article>
      </main>
      <footer className="border-t bg-background mt-12">
        <div className="max-w-3xl mx-auto px-6 py-4 text-xs text-muted-foreground flex flex-wrap gap-4 items-center">
          <Link to="/privacy-policy" className="hover:text-foreground">Privacy Policy</Link>
          <Link to="/terms-of-service" className="hover:text-foreground">Terms of Service</Link>
          <span className="ml-auto">© {new Date().getFullYear()} ProfitSync</span>
        </div>
      </footer>
    </div>
  )
}
