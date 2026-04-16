/**
 * Maps MCP tool payloads to Tripletex v2 JSON bodies.
 */

export type OrderLineInput = {
  description?: string;
  count?: number;
  unitPriceExcludingVatCurrency?: number;
  unitPriceIncludingVatCurrency?: number;
  vatTypeId?: number;
  productId?: number;
  discount?: number;
};

export function transformOrderLine(line: OrderLineInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (line.description !== undefined) out.description = line.description;
  if (line.count !== undefined) out.count = line.count;
  if (line.unitPriceExcludingVatCurrency !== undefined) {
    out.unitPriceExcludingVatCurrency = line.unitPriceExcludingVatCurrency;
  }
  if (line.unitPriceIncludingVatCurrency !== undefined) {
    out.unitPriceIncludingVatCurrency = line.unitPriceIncludingVatCurrency;
  }
  if (line.vatTypeId !== undefined) out.vatType = { id: line.vatTypeId };
  if (line.productId !== undefined) out.product = { id: line.productId };
  if (line.discount !== undefined) out.discount = line.discount;
  return out;
}

export type CreateOrderInput = {
  customerId: number;
  orderDate: string;
  deliveryDate: string;
  orderLines?: OrderLineInput[];
  isPrioritizeAmountsIncludingVat?: boolean;
  currencyId?: number;
  ourReference?: string;
  yourReference?: string;
  invoiceComment?: string;
  receiverEmail?: string;
  invoicesDueIn?: number;
};

export function buildOrderBody(input: CreateOrderInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    customer: { id: input.customerId },
    orderDate: input.orderDate,
    deliveryDate: input.deliveryDate,
  };
  if (input.orderLines !== undefined && input.orderLines.length > 0) {
    body.orderLines = input.orderLines.map(transformOrderLine);
  }
  if (input.isPrioritizeAmountsIncludingVat !== undefined) {
    body.isPrioritizeAmountsIncludingVat = input.isPrioritizeAmountsIncludingVat;
  }
  if (input.currencyId !== undefined) body.currency = { id: input.currencyId };
  if (input.ourReference !== undefined) body.ourReference = input.ourReference;
  if (input.yourReference !== undefined) body.yourReference = input.yourReference;
  if (input.invoiceComment !== undefined) body.invoiceComment = input.invoiceComment;
  if (input.receiverEmail !== undefined) body.receiverEmail = input.receiverEmail;
  if (input.invoicesDueIn !== undefined) body.invoicesDueIn = input.invoicesDueIn;
  return body;
}

export type VoucherPostingInput = {
  accountId: number;
  amountGross: number;
  amountGrossCurrency?: number;
  date: string;
  vatTypeId?: number;
  row?: number;
  description?: string;
  supplierId?: number;
  customerId?: number;
  projectId?: number;
  departmentId?: number;
  termOfPayment?: string;
  invoiceNumber?: string;
};

export function transformVoucherPosting(p: VoucherPostingInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    account: { id: p.accountId },
    amountGross: p.amountGross,
    date: p.date,
  };
  if (p.amountGrossCurrency !== undefined) out.amountGrossCurrency = p.amountGrossCurrency;
  if (p.vatTypeId !== undefined) out.vatType = { id: p.vatTypeId };
  if (p.row !== undefined) out.row = p.row;
  if (p.description !== undefined) out.description = p.description;
  if (p.supplierId !== undefined) out.supplier = { id: p.supplierId };
  if (p.customerId !== undefined) out.customer = { id: p.customerId };
  if (p.projectId !== undefined) out.project = { id: p.projectId };
  if (p.departmentId !== undefined) out.department = { id: p.departmentId };
  if (p.termOfPayment !== undefined) out.termOfPayment = p.termOfPayment;
  if (p.invoiceNumber !== undefined) out.invoiceNumber = p.invoiceNumber;
  return out;
}

export type SupplierInvoiceLineInput = {
  costAccountId: number;
  amountExVat: number;
  vatAmount: number;
  vatTypeId: number;
  description?: string;
  projectId?: number;
  departmentId?: number;
};

export type BuildSupplierInvoiceVoucherInput = {
  invoiceDate: string;
  description: string;
  supplierId: number;
  supplierAccountId: number;
  invoiceNumber?: string;
  voucherTypeId?: number;
  dueDate?: string;
  kid?: string;
  costAccountId: number;
  vatTypeId: number;
  amountExVat: number;
  vatAmount: number;
  projectId?: number;
  departmentId?: number;
  lines?: SupplierInvoiceLineInput[];
};

/**
 * Builds the JSON body for POST /ledger/voucher (supplier-style bilag).
 * Uses amount including VAT per line on debit postings (amountExVat + vatAmount)
 * and a balancing credit on supplierAccountId with supplier reference.
 */
export function buildSupplierInvoiceVoucherBody(
  input: BuildSupplierInvoiceVoucherInput
): Record<string, unknown> {
  const lines: SupplierInvoiceLineInput[] =
    input.lines && input.lines.length > 0
      ? input.lines
      : [
          {
            costAccountId: input.costAccountId,
            amountExVat: input.amountExVat,
            vatAmount: input.vatAmount,
            vatTypeId: input.vatTypeId,
            projectId: input.projectId,
            departmentId: input.departmentId,
          },
        ];

  const postings: Record<string, unknown>[] = [];
  let totalIncl = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const incl = line.amountExVat + line.vatAmount;
    totalIncl += incl;
    const lineDesc = line.description ?? input.description;
    const row: Record<string, unknown> = {
      row: i + 1,
      date: input.invoiceDate,
      description: lineDesc,
      account: { id: line.costAccountId },
      amountGross: incl,
      amountGrossCurrency: incl,
      vatType: { id: line.vatTypeId },
    };
    if (line.projectId !== undefined) row.project = { id: line.projectId };
    if (line.departmentId !== undefined) row.department = { id: line.departmentId };
    postings.push(row);
  }

  const creditRow = lines.length + 1;
  const creditDescParts = [input.description];
  if (input.kid !== undefined && input.kid !== "")
    creditDescParts.push(`KID: ${input.kid}`);
  const creditPosting: Record<string, unknown> = {
    row: creditRow,
    date: input.invoiceDate,
    description: creditDescParts.join(" — "),
    account: { id: input.supplierAccountId },
    amountGross: -totalIncl,
    amountGrossCurrency: -totalIncl,
    supplier: { id: input.supplierId },
  };
  if (input.dueDate !== undefined && input.dueDate !== "")
    creditPosting.termOfPayment = input.dueDate;
  postings.push(creditPosting);

  const body: Record<string, unknown> = {
    date: input.invoiceDate,
    description: input.description,
    postings,
  };
  if (input.invoiceNumber !== undefined && input.invoiceNumber !== "")
    body.vendorInvoiceNumber = input.invoiceNumber;
  if (input.voucherTypeId !== undefined)
    body.voucherType = { id: input.voucherTypeId };
  return body;
}

export type SupplierInvoicePostingUpdateInput = {
  id?: number;
  row: number;
  accountId: number;
  amountGross: number;
  amountGrossCurrency?: number;
  date?: string;
  vatTypeId?: number;
  description?: string;
  supplierId?: number;
  customerId?: number;
  projectId?: number;
  departmentId?: number;
};

/**
 * PUT /supplierInvoice/voucher/{id}/postings expects an array of OrderLinePosting
 * ({ posting: Posting }) per OpenAPI.
 */
export function wrapPostingsForSupplierInvoiceUpdate(
  voucherDate: string,
  items: SupplierInvoicePostingUpdateInput[]
): Record<string, unknown>[] {
  return items.map((p) => {
    const posting: Record<string, unknown> = {
      row: p.row,
      account: { id: p.accountId },
      amountGross: p.amountGross,
      date: p.date ?? voucherDate,
    };
    if (p.id !== undefined) posting.id = p.id;
    const agc = p.amountGrossCurrency ?? p.amountGross;
    posting.amountGrossCurrency = agc;
    if (p.vatTypeId !== undefined) posting.vatType = { id: p.vatTypeId };
    if (p.description !== undefined) posting.description = p.description;
    if (p.supplierId !== undefined) posting.supplier = { id: p.supplierId };
    if (p.customerId !== undefined) posting.customer = { id: p.customerId };
    if (p.projectId !== undefined) posting.project = { id: p.projectId };
    if (p.departmentId !== undefined) posting.department = { id: p.departmentId };
    return { posting };
  });
}
