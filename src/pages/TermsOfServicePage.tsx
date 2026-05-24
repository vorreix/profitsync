import { LegalLayout } from "@/components/LegalLayout"
import { LEGAL_DOC_VERSION } from "@/lib/types"

export function TermsOfServicePage() {
  return (
    <LegalLayout title={`Terms of Service v${LEGAL_DOC_VERSION}`}>
      <h1>Terms of Service</h1>
      <p className="text-muted-foreground text-sm">
        Last updated: May 24, 2026 — Version {LEGAL_DOC_VERSION}
      </p>

      <h2>1. Acceptance of terms</h2>
      <p>
        By creating an account or using ProfitSync ("the Service") you agree to these Terms of Service and our
        Privacy Policy. If you do not agree, do not use the Service.
      </p>

      <h2>2. Account responsibilities</h2>
      <ul>
        <li>You must provide accurate information when registering.</li>
        <li>You are responsible for safeguarding your credentials and all activity under your account.</li>
        <li>You must be at least 18 years old or have legal capacity to enter into a contract.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>
        You agree not to (a) use the Service for any unlawful purpose, (b) attempt to gain unauthorized access to
        systems or data of other users, (c) reverse engineer or scrape the Service, (d) upload malicious content
        or content that infringes intellectual property rights.
      </p>

      <h2>4. Subscriptions and billing</h2>
      <p>
        Paid plans are billed in advance on a recurring monthly or yearly basis through Razorpay. You can cancel
        at any time; cancellation takes effect at the end of the current billing period. Refunds are provided in
        line with applicable consumer protection law.
      </p>

      <h2>5. Free plan limits</h2>
      <p>
        The Free plan has usage limits (clients, transactions per client, quotations, attachments per
        transaction, attachment size, note length). Limits are listed in-product and may change with notice. Exceeding
        a limit requires upgrading to a paid plan.
      </p>

      <h2>6. Your data ownership</h2>
      <p>
        You retain ownership of the business data you enter into the Service. You grant us a limited license to
        process this data solely to provide the Service. We will not access your data except for support,
        security, or as required by law.
      </p>

      <h2>7. Organization roles</h2>
      <p>
        Each organization has owners, admins, editors, and viewers. The organization owner is responsible for
        managing memberships and the organization's subscription.
      </p>

      <h2>8. Service availability</h2>
      <p>
        We aim for high availability but do not guarantee uninterrupted access. We may perform maintenance,
        updates, or take the Service offline temporarily.
      </p>

      <h2>9. Termination</h2>
      <p>
        We may suspend or terminate accounts that violate these Terms or applicable law. You may close your
        account at any time. Upon termination, your data will be deleted as described in our Privacy Policy.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, ProfitSync is not liable for indirect, incidental, special,
        consequential, or punitive damages, or for loss of profits, revenue, data, or goodwill.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of India, without regard to conflict-of-law principles. Disputes
        will be resolved in courts of competent jurisdiction in Bengaluru, India.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may amend these Terms occasionally. We will update the version above and notify you in-product when
        we do. Continued use after a change constitutes acceptance of the new Terms.
      </p>

      <h2>13. Contact</h2>
      <p>
        Email us at <a href="mailto:support@profitsync.app">support@profitsync.app</a>.
      </p>
    </LegalLayout>
  )
}
