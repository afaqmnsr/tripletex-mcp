import { SkillDefinition } from "./types.js";

export const registerSupplierInvoiceSkill: SkillDefinition = {
  id: "register-supplier-invoice",
  title: "Registrer leverandørfaktura",
  description:
    "Step-by-step guide for registering an incoming supplier invoice in Tripletex, including bilagsmottak (voucher reception) when appropriate",
  triggers: [
    "leverandørfaktura",
    "supplier invoice",
    "innkommende faktura",
    "inngående faktura",
    "kjøpsfaktura",
    "bilagsmottak",
  ],
  requiredTools: [
    "search_suppliers",
    "create_supplier",
    "get_supplier",
    "update_supplier",
    "search_accounts",
    "search_vat_types",
    "search_voucher_types",
    "create_supplier_invoice",
    "attach_voucher_document",
    "import_ledger_voucher_document",
    "send_voucher_to_ledger",
    "search_vouchers",
    "create_voucher",
    "get_supplier_invoice",
    "get_supplier_invoices_for_approval",
    "approve_supplier_invoice",
  ],
  buildMessages: () => [
    {
      role: "assistant" as const,
      content: {
        type: "text" as const,
        text: `## Skill: Registrer leverandørfaktura (Register Supplier Invoice)

### Norsk regnskapslov / Norwegian GAAP Context
- Incoming invoices from suppliers represent a cost and a liability (leverandørgjeld)
- Inngående MVA (input VAT) on business purchases can be deducted from utgående MVA (output VAT)
- Tripletex exposes registered supplier invoices via \`search_supplier_invoices\` / \`get_supplier_invoice\`

### Preferred: Bilagsmottak (voucher reception)
When the user wants the invoice to appear in **bilagsmottak** for review/approval before posting, use **\`create_supplier_invoice\`** with:
- \`invoiceDate\`, \`description\`, \`supplierId\`, \`costAccountId\`, \`vatTypeId\`, \`amountExVat\`, \`vatAmount\` (single line), or \`lines[]\` for multiple cost lines (each line needs \`amountExVat\`, \`vatAmount\`, \`vatTypeId\`, \`costAccountId\`)
- Optional: \`invoiceNumber\` (leverandørens fakturanummer), \`dueDate\`, \`kid\`, \`voucherTypeId\`, \`supplierPayableAccountNumber\` (default 2400)
- The tool calls \`POST /ledger/voucher?sendToLedger=false\` and builds debit cost line(s) plus a balancing credit on leverandørgjeld with the supplier reference.

Then use **\`get_supplier_invoices_for_approval\`** / **\`approve_supplier_invoice\`** when Tripletex already exposes a **supplier invoice id** (some api-test companies may not list API-created vouchers under \`GET /supplierInvoice\`; see \`PHASE1-RESULTS.md\`).

\`create_supplier_invoice\` defaults the **Leverandørfaktura** voucher type when found. Use **\`search_voucher_types\`** to override or verify the type id.

### Alternative: Manual journal (\`create_voucher\`)
Use **\`create_voucher\`** when posting a **fully manual** balanced journal in one step (e.g. explicit lines on 6800, 2710, 2400), or when the user explicitly wants immediate posting. Set **\`sendToLedger: false\`** if the voucher should stay in bilagsmottak instead of posting at once (default \`sendToLedger\` is **true**).

### Steps

**Step 1 — Find the supplier**
Call \`search_suppliers\` with the supplier name or org.nr.
- If found: use that supplier ID
- If not found: ask user "Leverandøren finnes ikke. Skal jeg opprette den?"

**Step 1b — Fix missing org.nr. or address (existing supplier)**
Use \`get_supplier\` then \`update_supplier\` on **the same id** (e.g. set \`organizationNumber\`). Do **not** create a new supplier for corrections — that splits history. Pass \`version\` from \`get_supplier\` if Tripletex requires it.

**Step 2 — Create supplier (only if needed)**
Call \`create_supplier\` with:
- name (required)
- organizationNumber (recommended)
- email, bankAccountNumber (if available)

**Step 3 — Determine cost account and VAT**
Ask the user or infer from context:
- What type of expense is this? (goods, rent, office supplies, etc.)
- What VAT rate is on the invoice? (typically 25%, check the invoice)
Call \`search_accounts\` to find the correct cost account ID.
Call \`search_vat_types\` if unsure about VAT rates.

**Step 4 — Register the invoice**
- **Bilagsmottak path:** Call \`create_supplier_invoice\` with amounts **excluding** and **VAT** separately; the tool sends **including VAT** to Tripletex as \`amountGross\` per posting line.
- **Manual path:** Call \`create_voucher\` with balanced postings (and optional \`sendToLedger\`).
- **Har brukeren en PDF/bilde:** \`import_ledger_voucher_document\` (nytt bilag fra fil) eller \`attach_voucher_document\` (vedlegg til eksisterende \`voucherId\`) med Base64-innhold (maks ca. 8 MB).

**Step 5 — Confirm**
Show the user: supplier name, totals, VAT, cost account used, and whether the voucher awaits approval.

### When the Supplier Invoice is Paid
This is a separate step (not part of registration). Payment is recorded as a payment voucher (e.g. debit 2400, credit bank).

### Common Errors & Fixes
- Wrong VAT rate — Check the physical invoice. Not all purchases have 25% MVA.
- Supplier not found — Search by org.nr as well as name (names can vary).
- Approval errors — Check permissions and use \`get_supplier_invoice\` for current status.

### Validation Checklist
- [ ] Supplier exists (searched first, not assumed)
- [ ] Cost account matches the type of expense
- [ ] VAT type matches the invoice
- [ ] Totals reconcile with the source document
- [ ] If using bilagsmottak: user knows the invoice may need \`approve_supplier_invoice\``,
      },
    },
  ],
};
