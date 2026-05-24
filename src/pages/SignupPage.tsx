import { useState } from "react"
import { Link } from "react-router-dom"
import { SignUp } from "@clerk/clerk-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight, TrendingUp } from "lucide-react"

export function SignupPage() {
  const [agreed, setAgreed] = useState(false)
  const [continued, setContinued] = useState(false)

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      {continued ? (
        <div className="flex flex-col items-center gap-4">
          <SignUp
            path="/signup"
            routing="path"
            signInUrl="/login"
            unsafeMetadata={{ acceptedLegalAt: new Date().toISOString() }}
          />
          <p className="text-xs text-muted-foreground">
            By signing up you confirm you accept the{" "}
            <Link to="/terms-of-service" className="underline">Terms of Service</Link>{" "}
            and{" "}
            <Link to="/privacy-policy" className="underline">Privacy Policy</Link>.
          </p>
        </div>
      ) : (
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <TrendingUp className="size-5" />
            </div>
            <CardTitle className="text-xl">Create your ProfitSync account</CardTitle>
            <p className="text-sm text-muted-foreground">
              Before you continue, please review and accept our legal documents.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm space-y-2">
              <li className="flex items-center justify-between">
                <span>Terms of Service</span>
                <Link to="/terms-of-service" className="text-xs underline text-primary">View</Link>
              </li>
              <li className="flex items-center justify-between">
                <span>Privacy Policy</span>
                <Link to="/privacy-policy" className="text-xs underline text-primary">View</Link>
              </li>
            </ul>
            <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/40">
              <Checkbox
                id="legal-agree"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(!!v)}
                aria-describedby="legal-agree-desc"
              />
              <Label htmlFor="legal-agree" className="text-sm font-normal cursor-pointer leading-snug">
                I have read and agree to the{" "}
                <Link to="/terms-of-service" className="underline">Terms of Service</Link>{" "}
                and the{" "}
                <Link to="/privacy-policy" className="underline">Privacy Policy</Link>.
              </Label>
            </div>
            <Button
              className="w-full"
              disabled={!agreed}
              onClick={() => setContinued(true)}
            >
              Continue to sign up
              <ArrowRight className="size-4 ml-1.5" />
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="underline">Sign in</Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
