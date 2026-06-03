import { LegalLayout } from "@/components/LegalLayout"

export function RefundPolicyPage() {
  return (
    <LegalLayout title="Refund Policy">
      <h1>Refund Policy</h1>
      <p className="text-muted-foreground text-sm">Last updated: June 3, 2026</p>

      <h2>1. Overview</h2>
      <p>
        ProfitSync ("we", "us", "our") offers subscription plans for our accounting and client-tracking
        software ("the Service"). This policy explains when subscription fees are, and are not, refundable.
        Subscription payments are processed by Dodo Payments, our Merchant of Record.
      </p>

      <h2>2. Free plan</h2>
      <p>
        The Service includes a free plan so you can evaluate it before paying. We encourage you to use it to
        decide whether a paid plan is right for you before subscribing.
      </p>

      <h2>3. Subscriptions and renewals</h2>
      <ul>
        <li>Paid plans are billed in advance on a recurring monthly or yearly cycle.</li>
        <li>Your subscription renews automatically until you cancel it.</li>
        <li>You can cancel anytime from the Subscription page; cancellation stops future renewals and your plan stays active until the end of the current paid period.</li>
        <li>We do not provide automatic, prorated refunds for the unused portion of a billing period after a cancellation.</li>
      </ul>

      <h2>4. 7-day refund window</h2>
      <p>
        If you are charged for a paid plan and are not satisfied, you may request a full refund within
        <strong> 7 days</strong> of that charge by contacting us at the email below. This applies to the first
        payment of a new subscription and to each renewal charge within its own 7-day window. Refunds are issued
        to the original payment method via Dodo Payments.
      </p>

      <h2>5. What is not refundable</h2>
      <ul>
        <li>Charges older than 7 days at the time of your request.</li>
        <li>Accounts suspended or terminated for violating our Terms of Service.</li>
        <li>Taxes or fees that are non-refundable by law or by the payment processor.</li>
      </ul>

      <h2>6. Duplicate or erroneous charges</h2>
      <p>
        If you believe you were charged in error or charged more than once for the same period, contact us and
        we will investigate and refund any verified duplicate or erroneous charge regardless of the 7-day window.
      </p>

      <h2>7. Referral rewards</h2>
      <p>
        Referral commissions are a reward, not a purchase, and are governed by the referral program terms shown
        in your account. A refund of a referred customer's payment may reverse any related referral reward.
      </p>

      <h2>8. How to request a refund</h2>
      <p>
        Email <a href="mailto:support@profitsync.net">support@profitsync.net</a> from the address associated with
        your account, including the charge date and amount. We aim to respond within 3 business days. Approved
        refunds are processed by Dodo Payments and may take several business days to appear, depending on your
        bank or card issuer.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this Refund Policy from time to time. Material changes will be reflected by the "last
        updated" date above and, where appropriate, communicated in the app.
      </p>
    </LegalLayout>
  )
}
