import { Link } from "react-router-dom"
import { LegalLayout } from "@/components/LegalLayout"
import { LEGAL_DOC_VERSION } from "@/lib/types"

export function TermsOfServicePage() {
  return (
    <LegalLayout title={`Terms of Service v${LEGAL_DOC_VERSION}`}>
      <h1>Terms of Service</h1>
      <p className="text-muted-foreground text-sm">
        Last updated: June 3, 2026 — Version {LEGAL_DOC_VERSION}
      </p>

      <h2>1. Acceptance of terms</h2>
      <p>
        By creating an account or using ProfitSync ("the Service", "we", "us", "our") you agree to these Terms of
        Service, our <Link to="/privacy-policy">Privacy Policy</Link>, and our{" "}
        <Link to="/refund-policy">Refund Policy</Link>, which are incorporated here by reference. If you do not
        agree, do not use the Service.
      </p>

      <h2>2. Eligibility &amp; accounts</h2>
      <ul>
        <li>You must be at least 18 years old, or have the legal capacity to enter into a binding contract.</li>
        <li>You must provide accurate registration information and keep it up to date.</li>
        <li>You are responsible for safeguarding your credentials and for all activity under your account.</li>
        <li>Notify us promptly of any unauthorized use of your account.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service for any unlawful, fraudulent, or harmful purpose;</li>
        <li>attempt to gain unauthorized access to systems, accounts, or data of other users;</li>
        <li>reverse engineer, scrape, or place undue load on the Service;</li>
        <li>upload malware or content that infringes intellectual-property or privacy rights;</li>
        <li>resell or sublicense the Service without our written permission.</li>
      </ul>
      <p>We may suspend access to protect the Service or other users from abuse.</p>

      <h2>4. Subscriptions, renewals &amp; cancellation</h2>
      <ul>
        <li>Paid plans are billed in advance on a recurring monthly or yearly cycle through Dodo Payments, our Merchant of Record.</li>
        <li>Subscriptions renew automatically at the then-current price until cancelled.</li>
        <li>You may cancel anytime from the Subscription page; cancellation stops future renewals and your plan stays active until the end of the current paid period.</li>
        <li>Plan changes (e.g. monthly → yearly, or upgrades) take effect as described at checkout; scheduled changes apply at the next billing date.</li>
        <li>Prices and plan limits may change with reasonable notice; changes never apply retroactively to a period you've already paid for.</li>
      </ul>

      <h2>5. Refunds</h2>
      <p>
        Refunds are governed by our <Link to="/refund-policy">Refund Policy</Link>, which includes a 7-day refund
        window on subscription charges and the handling of duplicate or erroneous charges.
      </p>

      <h2>6. Free plan limits</h2>
      <p>
        The Free plan has usage limits (clients, transactions per client, quotations, attachments per record,
        attachment size, note length). Limits are listed in-product and may change with notice. Exceeding a limit
        requires upgrading to a paid plan.
      </p>

      <h2>7. Referral program</h2>
      <p>
        If you participate in our referral program, you may earn a reward when a person you refer subscribes to a
        paid plan. Rewards, holding periods, minimum payouts, and eligibility are set by us and shown in your
        account; they are rewards, not purchases, and may be changed or discontinued prospectively. Self-referral,
        fraud, or abuse voids rewards. A refund or chargeback of a referred payment may reverse the related reward.
        Payouts are made manually to the details you provide; you are responsible for any taxes on rewards.
      </p>

      <h2>8. Your data &amp; ownership</h2>
      <p>
        You retain ownership of the business data you enter into the Service. You grant us a limited license to
        host and process this data solely to provide and secure the Service. You can export or delete your data;
        we access it only for support, security, or as required by law. See the{" "}
        <Link to="/privacy-policy">Privacy Policy</Link> for details and sub-processors.
      </p>

      <h2>9. Organization roles</h2>
      <p>
        Each organization has owners, admins, editors, and viewers. The organization owner is responsible for
        managing memberships, permissions, and the organization's subscription. Org owners are responsible for the
        actions of members they invite.
      </p>

      <h2>10. Third-party services</h2>
      <p>
        The Service relies on third parties — Clerk (authentication), Neon (database), Vercel (hosting), and Dodo
        Payments (Merchant of Record for billing). Your use of those features is also subject to those providers'
        terms. We are not responsible for third-party outages or actions outside our control.
      </p>

      <h2>11. Service availability</h2>
      <p>
        We aim for high availability but do not guarantee uninterrupted access. We may perform maintenance,
        updates, or take the Service offline temporarily, and will try to minimize disruption.
      </p>

      <h2>12. Disclaimer of warranties</h2>
      <p>
        The Service is provided "as is" and "as available" without warranties of any kind, express or implied,
        including merchantability, fitness for a particular purpose, and non-infringement. ProfitSync helps you
        record financial information but is not a substitute for professional accounting, tax, or legal advice.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, ProfitSync is not liable for indirect, incidental, special,
        consequential, or punitive damages, or for loss of profits, revenue, data, or goodwill. Our total
        aggregate liability for any claim relating to the Service is limited to the amounts you paid us in the
        twelve months before the event giving rise to the claim.
      </p>

      <h2>14. Indemnification</h2>
      <p>
        You agree to indemnify and hold ProfitSync harmless from claims, damages, and expenses arising out of your
        misuse of the Service, your data, or your violation of these Terms or applicable law.
      </p>

      <h2>15. Termination</h2>
      <p>
        We may suspend or terminate accounts that violate these Terms or applicable law. You may close your
        account at any time. Upon termination, your data is deleted as described in our Privacy Policy, subject to
        records we must retain by law.
      </p>

      <h2>16. Governing law</h2>
      <p>
        These Terms are governed by the laws of India, without regard to conflict-of-law principles. Disputes will
        be resolved in courts of competent jurisdiction in Bengaluru, India.
      </p>

      <h2>17. Changes</h2>
      <p>
        We may amend these Terms occasionally. We will update the version above and notify you in-product when we
        make material changes. Continued use after a change constitutes acceptance of the updated Terms.
      </p>

      <h2>18. Contact</h2>
      <p>
        Email us at <a href="mailto:hello@profitsync.net">hello@profitsync.net</a>.
      </p>
    </LegalLayout>
  )
}
