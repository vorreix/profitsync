import { LegalLayout } from "@/components/LegalLayout"
import { LEGAL_DOC_VERSION } from "@/lib/types"

export function PrivacyPolicyPage() {
  return (
    <LegalLayout title={`Privacy Policy v${LEGAL_DOC_VERSION}`}>
      <h1>Privacy Policy</h1>
      <p className="text-muted-foreground text-sm">
        Last updated: May 24, 2026 — Version {LEGAL_DOC_VERSION}
      </p>

      <h2>1. Introduction</h2>
      <p>
        ProfitSync ("we", "us", "our") provides accounting and client-tracking software ("the Service"). This
        Privacy Policy explains what personal data we collect when you use the Service, how we use it, who we
        share it with, and the rights you have over your data.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address, password hash, and authentication metadata supplied via our identity provider (Clerk).</li>
        <li><strong>Organization data:</strong> organization names, memberships, and roles you create within the Service.</li>
        <li><strong>Business data you enter:</strong> clients, transactions, quotations, notes, and file attachments.</li>
        <li><strong>Usage data:</strong> IP address, browser type, timestamps, and pages viewed for security, fraud prevention, and analytics.</li>
      </ul>

      <h2>3. How we use your data</h2>
      <ul>
        <li>To provide and maintain the Service.</li>
        <li>To authenticate you and protect your account.</li>
        <li>To process subscription payments and issue invoices.</li>
        <li>To send transactional notifications (sign-up confirmation, security alerts, billing, support).</li>
        <li>To comply with legal obligations and respond to lawful requests.</li>
      </ul>

      <h2>4. Data sharing</h2>
      <p>
        We do not sell your personal data. We share limited data with sub-processors strictly to deliver the
        Service: Clerk (authentication), Neon (database hosting), Vercel (application hosting), and Dodo Payments
        (our Merchant of Record for subscription payments, when applicable). Each sub-processor is contractually bound to handle data
        consistent with applicable privacy laws.
      </p>

      <h2>5. Data retention</h2>
      <p>
        We retain personal data while your account is active. When you delete an organization or your account,
        related business data is permanently removed within 30 days, except where retention is required by law.
      </p>

      <h2>6. Your rights</h2>
      <p>
        You have the right to access, correct, export, or delete your personal data. To exercise any of these
        rights, contact us at <a href="mailto:hello@profitsync.app">hello@profitsync.app</a>.
      </p>

      <h2>7. Security</h2>
      <p>
        We use industry-standard encryption in transit (TLS) and at rest. Passwords are never stored in plain
        text. We restrict access to personal data to employees and contractors who need it.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Your data may be processed in regions outside your country. Where required, we rely on Standard
        Contractual Clauses or other lawful mechanisms.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will update the version number above
        and notify you in-product. Continued use of the Service after a change constitutes acceptance of the
        updated policy.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions? Email <a href="mailto:hello@profitsync.app">hello@profitsync.app</a>.
      </p>
    </LegalLayout>
  )
}
