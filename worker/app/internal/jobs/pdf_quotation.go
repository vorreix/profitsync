package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/johnfercher/maroto/v2"
	"github.com/johnfercher/maroto/v2/pkg/components/text"
	"github.com/johnfercher/maroto/v2/pkg/config"
	"github.com/johnfercher/maroto/v2/pkg/consts/align"
	"github.com/johnfercher/maroto/v2/pkg/consts/fontstyle"
	"github.com/johnfercher/maroto/v2/pkg/consts/pagesize"
	"github.com/johnfercher/maroto/v2/pkg/props"
)

// pdf.quotation — compute-style job. The app enqueues it with a full data
// snapshot (so the worker never touches the app DB — the isolation invariant)
// plus the target S3 object key. The handler renders a PDF with maroto (pure Go,
// CGO-free — fits the CGO_ENABLED=0 Alpine image), uploads it to the private
// bucket at the given key, and calls back to mark the quotation's PDF ready.
//
// Idempotent by design: the key is a stable content-hash path, so a retry/reap
// re-uploads byte-identical content, and the app-side callback is an id+org
// scoped upsert. The app never trusts a URL from here — it re-presigns the key
// on each access.

// quotationSnapshot is the render input. The APP owns currency formatting and
// passes `AmountLabel` pre-rendered (e.g. "₹ 1,200.00"), so the worker needs no
// currency/locale logic and avoids symbol-rendering pitfalls.
type quotationSnapshot struct {
	OrgName      string `json:"org_name"`
	OrgEmail     string `json:"org_email"`
	Reference    string `json:"reference"`
	Title        string `json:"title"`
	ProspectName string `json:"prospect_name"`
	Company      string `json:"company"`
	Email        string `json:"email"`
	Phone        string `json:"phone"`
	AmountLabel  string `json:"amount_label"`
	Currency     string `json:"currency"`
	Amount       string `json:"amount"`
	Date         string `json:"date"`
	Status       string `json:"status"`
	Notes        string `json:"notes"`
	GeneratedAt  string `json:"generated_at"`
}

type pdfQuotationPayload struct {
	QuotationID    string            `json:"quotation_id"`
	OrganizationID string            `json:"organization_id"`
	ObjectKey      string            `json:"object_key"`
	SourceHash     string            `json:"source_hash"`
	Snapshot       quotationSnapshot `json:"snapshot"`
}

func pdfQuotationHandler(d Deps) Handler {
	return func(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
		var p pdfQuotationPayload
		if err := json.Unmarshal(payload, &p); err != nil {
			return nil, fmt.Errorf("pdf.quotation: bad payload: %w", err)
		}
		if p.QuotationID == "" || p.ObjectKey == "" {
			return nil, errors.New("pdf.quotation: quotation_id and object_key are required")
		}
		if d.Storage == nil {
			return nil, errors.New("pdf.quotation: storage not configured")
		}
		if d.ProfitSync == nil || !d.ProfitSync.Configured() {
			return nil, errors.New("pdf.quotation: ProfitSync client not configured")
		}

		pdfBytes, err := renderQuotationPDF(p.Snapshot)
		if err != nil {
			return nil, fmt.Errorf("pdf.quotation: render: %w", err)
		}

		// Upload to the stable key. We ignore the returned URL — the app persists
		// only the key and mints its own short-lived presigned URLs on access.
		if _, err := d.Storage.Put(ctx, p.ObjectKey, bytes.NewReader(pdfBytes), int64(len(pdfBytes)), "application/pdf", 0); err != nil {
			return nil, fmt.Errorf("pdf.quotation: upload: %w", err)
		}

		// Mark ready (service-token-authed on the app side; id+org scoped).
		cb, _ := json.Marshal(map[string]any{
			"quotation_id":    p.QuotationID,
			"organization_id": p.OrganizationID,
			"object_key":      p.ObjectKey,
			"source_hash":     p.SourceHash,
			"size_bytes":      len(pdfBytes),
		})
		if _, err := d.ProfitSync.Call(ctx, "POST", "/api/internal/quotations/pdf-ready", cb); err != nil {
			return nil, fmt.Errorf("pdf.quotation: ready callback: %w", err)
		}

		out, _ := json.Marshal(map[string]any{"object_key": p.ObjectKey, "size_bytes": len(pdfBytes)})
		return out, nil
	}
}

// renderQuotationPDF lays out a clean A4 quotation. Rows for empty optional
// fields are skipped so the document stays tight.
func renderQuotationPDF(s quotationSnapshot) ([]byte, error) {
	cfg := config.NewBuilder().
		WithPageSize(pagesize.A4).
		WithLeftMargin(18).
		WithTopMargin(18).
		WithRightMargin(18).
		Build()
	m := maroto.New(cfg)

	orgName := s.OrgName
	if orgName == "" {
		orgName = "Quotation"
	}

	// Header: org name (left) / QUOTATION (right).
	m.AddRow(16,
		text.NewCol(7, orgName, props.Text{Size: 18, Style: fontstyle.Bold, Align: align.Left}),
		text.NewCol(5, "QUOTATION", props.Text{Size: 18, Style: fontstyle.Bold, Align: align.Right}),
	)
	if s.OrgEmail != "" {
		m.AddRow(6, text.NewCol(12, s.OrgEmail, props.Text{Size: 9, Align: align.Left}))
	}

	// Meta line: reference (left) / date (right).
	metaLeft := "Reference: " + firstNonEmpty(s.Reference, "—")
	metaRight := "Date: " + firstNonEmpty(s.Date, "—")
	m.AddRow(9,
		text.NewCol(6, metaLeft, props.Text{Size: 10, Align: align.Left}),
		text.NewCol(6, metaRight, props.Text{Size: 10, Align: align.Right}),
	)
	m.AddRow(6, text.NewCol(12, "", props.Text{})) // spacer

	// "Prepared for" block.
	m.AddRow(7, text.NewCol(12, "PREPARED FOR", props.Text{Size: 9, Style: fontstyle.Bold, Align: align.Left}))
	m.AddRow(9, text.NewCol(12, firstNonEmpty(s.ProspectName, "—"), props.Text{Size: 13, Style: fontstyle.Bold, Align: align.Left}))
	if s.Company != "" {
		m.AddRow(7, text.NewCol(12, s.Company, props.Text{Size: 10, Align: align.Left}))
	}
	if s.Email != "" || s.Phone != "" {
		m.AddRow(7,
			text.NewCol(6, s.Email, props.Text{Size: 10, Align: align.Left}),
			text.NewCol(6, s.Phone, props.Text{Size: 10, Align: align.Right}),
		)
	}
	m.AddRow(8, text.NewCol(12, "", props.Text{})) // spacer

	// Subject / title.
	if s.Title != "" {
		m.AddRow(7, text.NewCol(12, "SUBJECT", props.Text{Size: 9, Style: fontstyle.Bold, Align: align.Left}))
		m.AddRow(9, text.NewCol(12, s.Title, props.Text{Size: 12, Align: align.Left}))
		m.AddRow(4, text.NewCol(12, "", props.Text{}))
	}

	// Notes (auto-height for long content).
	if s.Notes != "" {
		m.AddRow(7, text.NewCol(12, "NOTES", props.Text{Size: 9, Style: fontstyle.Bold, Align: align.Left}))
		m.AddAutoRow(text.NewCol(12, s.Notes, props.Text{Size: 10, Align: align.Left}))
		m.AddRow(4, text.NewCol(12, "", props.Text{}))
	}

	// Total — the headline figure.
	amount := firstNonEmpty(s.AmountLabel, currencyFallback(s.Currency, s.Amount))
	m.AddRow(14,
		text.NewCol(6, "TOTAL", props.Text{Size: 13, Style: fontstyle.Bold, Align: align.Left}),
		text.NewCol(6, amount, props.Text{Size: 15, Style: fontstyle.Bold, Align: align.Right}),
	)

	// Footer.
	footer := "Generated by ProfitSync"
	if s.GeneratedAt != "" {
		footer += " · " + s.GeneratedAt
	}
	if s.Status != "" {
		footer += " · Status: " + s.Status
	}
	m.AddRow(10, text.NewCol(12, "", props.Text{}))
	m.AddRow(6, text.NewCol(12, footer, props.Text{Size: 8, Align: align.Center}))

	doc, err := m.Generate()
	if err != nil {
		return nil, err
	}
	return doc.GetBytes(), nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// currencyFallback joins a currency code and amount into a fallback label when
// the app didn't pre-format one (e.g. "USD 1200.00").
func currencyFallback(currency, amount string) string {
	amount = firstNonEmpty(amount, "0")
	if currency == "" {
		return amount
	}
	return currency + " " + amount
}
