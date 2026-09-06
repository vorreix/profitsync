import { useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { Archive, Landmark, Snowflake } from "lucide-react"
import { cardTail, expiryLabel, isCardExpired, isCardTier, lighten, maskedNumber, maskedTail, resolveCardPalette } from "@/lib/cards"
import type { CardVisualProps } from "@/components/cards/types"
import { ContactlessIcon, EmvChip } from "@/components/cards/ChipIcon"
import { NetworkMark, networkLabel } from "@/components/cards/NetworkMark"
import { cn } from "@/lib/utils"
import "@/components/cards/card-visual.css"

/**
 * What is PRINTED on the plastic. A physical card carries these in Latin
 * capitals whatever the holder's language, so they are deliberately not
 * localized — and they are aria-hidden: the accessible name of the whole card
 * (built from the `wealth.cardVisual` strings) is what a screen reader gets.
 */
const PRINT = {
  debit: "DEBIT",
  credit: "CREDIT",
  holder: "CARD HOLDER",
  validThru: "VALID THRU",
  tiers: { gold: "GOLD", platinum: "PLATINUM", metal: "METAL", black: "BLACK" } as Record<string, string>,
}

function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * A realistic payment card, rendered from plain values so the add-card wizard
 * can preview a card that does not exist yet (`visualPropsFromCard` maps an
 * API row onto these props).
 *
 * Fluid: the parent sets the width, the intrinsic 1.586 aspect ratio sets the
 * height, and every detail scales with container-query units (card-visual.css).
 * `size` only changes the density — `sm` drops the holder / expiry / nickname
 * lines and shortens the number to its tail.
 *
 * Accessibility: one `role="img"` with a localized name ("Federal Visa debit
 * card ending 1234, expires 09/27"); everything inside is aria-hidden. The root
 * is `dir="ltr"` + bidi-isolated so an Arabic UI keeps the card's layout.
 */
export function CardVisual({
  kind,
  network,
  tier,
  design,
  brand_colors,
  brand_domain,
  brand_logo_url,
  bank_logo_src,
  bank_name,
  name,
  holder_name,
  last4,
  expiry_month,
  expiry_year,
  status = "active",
  size = "md",
  className,
  still,
  onLogoError,
}: CardVisualProps) {
  const { t } = useTranslation("wealth")
  const palette = resolveCardPalette({ tier, design, brand_colors, brand_domain })

  // Remember WHICH url failed so a new url (wizard re-pick) gets a fresh try.
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  const logoUrl = (brand_logo_url ?? "").trim()
  const iconSrc = (bank_logo_src ?? "").trim()
  // Brandfetch wordmarks are made for a dark surface — only trust them when
  // the card's text is light; on gold/platinum/light brand colours the icon +
  // bank name fallback is what reads.
  const showWordmark = palette.text === "light" && !!logoUrl && failedLogo !== logoUrl
  const showIcon = !!iconSrc && failedIcon !== iconSrc

  const bank = (bank_name ?? "").trim()
  const nick = (name ?? "").trim()
  const holder = (holder_name ?? "").trim()
  const tail = (last4 ?? "").trim()
  const expiry = expiryLabel(expiry_month, expiry_year)
  const expired = status !== "closed" && isCardExpired(expiry_month, expiry_year, todayIso())
  const tierKey = isCardTier(tier) ? tier : "standard"
  const tierPrint = PRINT.tiers[tierKey] ?? null

  // Accessible name: "{bank} {network} {kind} card, ending 1234, expires 09/27, frozen".
  const kindWord = t(kind === "credit" ? "cardVisual.credit" : "cardVisual.debit")
  const issuer = [bank, network !== "other" ? networkLabel(network) : ""].filter(Boolean).join(" ")
  const parts = [t("cardVisual.a11yCard", { issuer, kind: kindWord }).replace(/\s+/g, " ").trim()]
  if (cardTail(tail)) parts.push(t("cardVisual.cardEnding", { last4: cardTail(tail) }))
  if (expiry) parts.push(t("cardVisual.expires", { expiry }))
  if (status === "frozen") parts.push(t("cardVisual.frozen"))
  if (status === "closed") parts.push(t("cardVisual.closed"))
  if (expired) parts.push(t("cardVisual.expired"))
  const ariaLabel = parts.join(", ")

  const style = {
    "--cv-from": palette.from,
    "--cv-to": palette.to,
    "--cv-text": palette.text === "light" ? "#FFFFFF" : "#111827",
    "--cv-accent": palette.accent,
    "--cv-ink": palette.text === "light" ? "255 255 255" : "17 24 39",
    "--cv-mesh": lighten(palette.from, 0.45),
    // A black card prints the holder line in gold, like the real thing.
    ...(palette.texture === "matte" ? { "--cv-holder-color": palette.accent } : {}),
  } as CSSProperties

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      dir="ltr"
      data-size={size}
      data-status={status}
      data-tier={tierKey}
      data-still={still ? "" : undefined}
      className={cn("card-visual", className)}
      style={style}
    >
      <div className="cv-inner">
        <div className="cv-face" data-closed={status === "closed" ? "" : undefined}>
          <div className="cv-layer cv-base" />
          <div className="cv-layer cv-light" />
          {palette.texture !== "none" && <div className="cv-layer cv-texture" data-texture={palette.texture} />}
          {palette.pattern !== "none" && <div className="cv-layer cv-pattern" data-pattern={palette.pattern} />}
          <div className="cv-layer cv-sheen" />

          <div className="cv-content" data-tone={palette.text} aria-hidden="true">
            {/* Top: issuer wordmark (or icon + name) · kind/tier label */}
            <div className="cv-top">
              <div className="cv-brand">
                {showWordmark ? (
                  <img
                    className="cv-logo"
                    src={logoUrl}
                    alt=""
                    draggable={false}
                    onError={() => {
                      setFailedLogo(logoUrl)
                      onLogoError?.()
                    }}
                  />
                ) : bank || showIcon ? (
                  <div className="cv-bankrow">
                    <span className="cv-bankicon">
                      {showIcon ? (
                        <img src={iconSrc} alt="" draggable={false} onError={() => setFailedIcon(iconSrc)} />
                      ) : (
                        <Landmark />
                      )}
                    </span>
                    {bank && <span className="cv-bankname">{bank}</span>}
                  </div>
                ) : null}
                {nick && <span className="cv-nick">{nick}</span>}
              </div>
              <div className="cv-kind">
                <span className="cv-kindtext">
                  {kind === "credit" ? PRINT.credit : PRINT.debit}
                  {tierPrint ? ` · ${tierPrint}` : ""}
                </span>
                {expired && <span className="cv-pill cv-pill--expired">{t("cardVisual.expired")}</span>}
              </div>
            </div>

            {/* Middle: chip + contactless, then the number line */}
            <div className="cv-mid">
              <div className="cv-chiprow">
                <EmvChip className="cv-chip" />
                <ContactlessIcon className="cv-nfc" />
              </div>
              <div className="cv-number">{size === "sm" ? maskedTail(tail) : maskedNumber(tail)}</div>
            </div>

            {/* Bottom: holder + expiry · network mark */}
            <div className="cv-bottom">
              <div className="cv-fields">
                {holder && (
                  <div className="cv-field">
                    <div className="cv-label">{PRINT.holder}</div>
                    <div className="cv-value">{holder}</div>
                  </div>
                )}
                {expiry && (
                  <div className="cv-field cv-field--expiry">
                    <div className="cv-label">{PRINT.validThru}</div>
                    <div className="cv-value cv-value--num">{expiry}</div>
                  </div>
                )}
              </div>
              <NetworkMark network={network} tone={palette.text} className="cv-mark" />
            </div>
          </div>
        </div>

        {(status === "frozen" || status === "closed") && (
          <div className="cv-overlay" data-status={status} aria-hidden="true">
            <span className={cn("cv-pill", status === "frozen" ? "cv-pill--frozen" : "cv-pill--closed")}>
              {status === "frozen" ? <Snowflake /> : <Archive />}
              {t(status === "frozen" ? "cardVisual.frozen" : "cardVisual.closed")}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
