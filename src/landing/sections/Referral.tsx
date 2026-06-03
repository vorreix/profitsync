import { ArrowRight, Link2, UserPlus, BadgeCheck, Gift } from "lucide-react"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { Reveal } from "../components/Reveal"

const STEPS = [
  { icon: Link2, title: "Share your link", body: "Send your unique referral link to friends and clients." },
  { icon: UserPlus, title: "They sign up", body: "They create an account using your link." },
  { icon: BadgeCheck, title: "They upgrade", body: "When they purchase a paid plan, you qualify." },
  { icon: Gift, title: "You earn", body: "Earn a commission on every successful payment." },
]

export function Referral() {
  return (
    <section id="referral" className="py-16 sm:py-24">
      <Container>
        <Reveal>
          <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-12">
            <div className="grid items-center gap-8 lg:grid-cols-2">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  <Gift className="size-3.5 text-primary" /> Referral program
                </span>
                <h2 className="ps-display mt-4 text-balance text-3xl font-bold leading-[1.1] sm:text-[2.5rem]">
                  Invite friends. Earn rewards.
                </h2>
                <p className="mt-4 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
                  Share ProfitSync with your network and earn a commission when they upgrade to a paid plan.
                </p>
                <div className="mt-7">
                  <Button href="/signup" size="lg" className="group">
                    Get your referral link
                    <ArrowRight className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  </Button>
                </div>
              </div>
              <ol className="grid gap-3 sm:grid-cols-2">
                {STEPS.map((s, i) => (
                  <li key={i} className="rounded-2xl border border-border bg-background p-4">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <s.icon className="size-4" />
                    </div>
                    <p className="mt-3 text-sm font-semibold">{s.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
