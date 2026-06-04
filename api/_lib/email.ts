// Lightweight transactional email via Resend's HTTP API — no SDK dependency, so
// it fits the serverless runtime with zero extra install. Configured by env:
//   RESEND_API_KEY  — your Resend API key (https://resend.com)
//   EMAIL_FROM      — a verified sender, e.g. "ProfitSync <noreply@profitsync.net>"
//
// Everything here is BEST-EFFORT: callers must not fail their main action when
// email is unavailable. Org invitations, for example, always also return a
// shareable link the inviter can copy, so a missing RESEND_API_KEY (e.g. in
// local dev) degrades gracefully to "copy the link" instead of breaking.

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

function emailFrom(): string {
  // Resend's shared onboarding@resend.dev sender works without domain setup,
  // which keeps local/dev usable; production should set EMAIL_FROM to a verified
  // domain sender.
  return process.env.EMAIL_FROM || "ProfitSync <onboarding@resend.dev>"
}

export type SendResult = { ok: boolean; id?: string; error?: string }

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: "email_not_configured" }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, error: `resend_${res.status}: ${body.slice(0, 200)}` }
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, id: body.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send_failed" }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/**
 * Branded organization-invitation email. The `link` is the shareable accept URL
 * (`/invitations/:token`). Returns the send result (never throws).
 */
export async function sendInvitationEmail(opts: {
  to: string
  orgName: string
  inviterName?: string | null
  role: string
  link: string
  expiresAt?: Date | string | null
}): Promise<SendResult> {
  const org = escapeHtml(opts.orgName)
  const inviter = opts.inviterName ? escapeHtml(opts.inviterName) : null
  const role = escapeHtml(opts.role)
  const link = opts.link // our own origin + token — safe to use directly
  const expires = opts.expiresAt
    ? new Date(opts.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null

  const subject = `You're invited to ${opts.orgName} on ProfitSync`
  const introText = inviter ? `${opts.inviterName} invited you to join` : "You've been invited to join"
  const introHtml = inviter ? `<strong>${inviter}</strong> invited you to join` : "You've been invited to join"

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid #e4e4e7;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:18px;font-weight:700;color:#0a0a0a;">ProfitSync</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#0a0a0a;">You're invited to ${org}</h1>
            <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#52525b;">
              ${introHtml} <strong>${org}</strong> on ProfitSync as <strong>${role}</strong>.
            </p>
          </td></tr>
          <tr><td style="padding:24px 32px 8px;">
            <a href="${link}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;">Accept invitation</a>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">Or paste this link into your browser:</p>
            <p style="margin:4px 0 0;font-size:12px;line-height:1.6;color:#3f3f46;word-break:break-all;"><a href="${link}" style="color:#2563eb;">${link}</a></p>
          </td></tr>
          ${expires ? `<tr><td style="padding:16px 32px 0;"><p style="margin:0;font-size:12px;color:#a1a1aa;">This invitation expires on ${expires}.</p></td></tr>` : ""}
          <tr><td style="padding:24px 32px 28px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px;">
              If you weren't expecting this invitation, you can safely ignore this email.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  const text = `${introText} ${opts.orgName} on ProfitSync as ${opts.role}.

Accept your invitation:
${link}
${expires ? `\nThis invitation expires on ${expires}.\n` : ""}
If you weren't expecting this invitation, you can safely ignore this email.`

  return sendEmail({ to: opts.to, subject, html, text })
}
