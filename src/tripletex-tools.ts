/**
 * All Tripletex MCP tool registrations.
 * Shared with Regnskapsagent (`registerAllTools(server, client)`); stdio MCP bruker `new TripletexClient()`.
 */

import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TripletexApiError, TripletexClient } from "./tripletex-client.js";
import {
  buildOrderBody,
  buildSupplierInvoiceVoucherBody,
  transformVoucherPosting,
  wrapPostingsForSupplierInvoiceUpdate,
  type OrderLineInput,
} from "./tripletex-transform.js";
import { registerSkills } from "./skills/registry.js";

/** Appended to create_supplier_invoice JSON so users know how Tripletex behaves. */
const CREATE_SUPPLIER_INVOICE_RESULT_NOTE =
  "—\n" +
  "Bilaget er opprettet i Tripletex (kan fortsatt ligge uavklart / ikke bokført). " +
  "Sjekk bilagsmottak og leverandørfaktura i Tripletex-UI.\n" +
  "Merk: `GET /supplierInvoice` kan returnere tom liste selv med riktig bilagstype. " +
  "Bruk `search_vouchers` med `typeId` fra `search_voucher_types` (f.eks. Leverandørfaktura) for å finne bilaget via API.\n" +
  "The voucher was created; the SupplierInvoice list may be empty even when the voucher type is correct.";

const MAX_BASE64_DOCUMENT_BYTES = 8 * 1024 * 1024;

function formatResult(data: unknown): string {
  return JSON.stringify(data);
}

function formatTripletexError(e: TripletexApiError): string {
  let parsed: unknown = e.bodyText;
  try {
    parsed = JSON.parse(e.bodyText) as unknown;
  } catch {
    /* keep raw string */
  }
  return JSON.stringify(
    { httpStatus: e.status, tripletexResponse: parsed },
    null,
    2
  );
}

async function run<T>(fn: () => Promise<T>, resultNote?: string) {
  try {
    const data = await fn();
    let text = formatResult(data);
    if (resultNote) text = `${text}\n\n${resultNote}`;
    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    if (e instanceof TripletexApiError) {
      return {
        content: [{ type: "text" as const, text: formatTripletexError(e) }],
      };
    }
    throw e;
  }
}

function optionalParams(
  obj: Record<string, string | number | boolean | undefined | null>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "boolean" ? String(v) : String(v);
  }
  return out;
}

function readValueId(data: unknown): number | undefined {
  if (data && typeof data === "object" && "value" in data) {
    const v = (data as { value?: { id?: number } }).value;
    return v?.id;
  }
  return undefined;
}

function firstLedgerAccountId(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const values = (data as { values?: { id?: number }[] }).values;
  if (Array.isArray(values) && values[0]?.id !== undefined)
    return values[0].id;
  const nested = (data as { value?: { values?: { id?: number }[] } }).value
    ?.values;
  if (Array.isArray(nested) && nested[0]?.id !== undefined) return nested[0].id;
  return undefined;
}

async function lookupLedgerAccountIdByNumber(
  client: TripletexClient,
  accountNumber: number
): Promise<number> {
  const data = await client.get("/ledger/account", {
    number: String(accountNumber),
    count: "1",
    fields: "id,number",
  });
  const id = firstLedgerAccountId(data);
  if (id === undefined) {
    throw new Error(
      `Ledger account number ${accountNumber} not found. Use search_accounts or create the account in Tripletex.`
    );
  }
  return id;
}

function listValues(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.values)) return o.values;
  const inner = o.value as Record<string, unknown> | undefined;
  if (inner && Array.isArray(inner.values)) return inner.values;
  return [];
}

/**
 * Resolves the ledger voucher type id for "Leverandørfaktura" (Norwegian UI name).
 */
async function resolveLeverandorVoucherTypeId(
  client: TripletexClient
): Promise<number | undefined> {
  const data = await client.get("/ledger/voucherType", {
    name: "Leverandørfaktura",
    count: "15",
    fields: "id,name,displayName",
  });
  const rows = listValues(data) as { id?: number; name?: string }[];
  const exact = rows.find((x) => x.name === "Leverandørfaktura");
  const pick = exact ?? rows[0];
  return typeof pick?.id === "number" ? pick.id : undefined;
}

const postalAddressSchema = z
  .object({
    addressLine1: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    country: z.object({ id: z.number() }).optional(),
  })
  .optional();

const orderLineSchema: z.ZodType<OrderLineInput> = z.object({
  description: z.string().optional(),
  count: z.number().optional(),
  unitPriceExcludingVatCurrency: z.number().optional(),
  unitPriceIncludingVatCurrency: z.number().optional(),
  vatTypeId: z.number().optional(),
  productId: z.number().optional(),
  discount: z.number().optional(),
});

const createCustomerSchema = z.object({
  name: z.string(),
  organizationNumber: z.string().optional(),
  email: z.string().optional(),
  invoiceEmail: z.string().optional(),
  phoneNumber: z.string().optional(),
  phoneNumberMobile: z.string().optional(),
  invoiceSendMethod: z.string().optional(),
  language: z.string().optional(),
  currencyId: z.number().optional(),
  postalAddress: postalAddressSchema,
});

function buildCustomerBody(
  input: z.infer<typeof createCustomerSchema>
): Record<string, unknown> {
  const body: Record<string, unknown> = { name: input.name };
  if (input.organizationNumber !== undefined)
    body.organizationNumber = input.organizationNumber;
  if (input.email !== undefined) body.email = input.email;
  if (input.invoiceEmail !== undefined) body.invoiceEmail = input.invoiceEmail;
  if (input.phoneNumber !== undefined) body.phoneNumber = input.phoneNumber;
  if (input.phoneNumberMobile !== undefined)
    body.phoneNumberMobile = input.phoneNumberMobile;
  if (input.invoiceSendMethod !== undefined)
    body.invoiceSendMethod = input.invoiceSendMethod;
  if (input.language !== undefined) body.language = input.language;
  if (input.currencyId !== undefined)
    body.currency = { id: input.currencyId };
  if (input.postalAddress !== undefined)
    body.postalAddress = input.postalAddress;
  return body;
}

/**
 * Registers all 56 Tripletex MCP tools + skills on the given server,
 * using the provided client for API calls.
 */
export function registerAllTools(server: McpServer, client: TripletexClient) {
  // ==================== ORDERS ====================

  server.tool(
    "search_orders",
    "Search orders (ordrer) in Tripletex. Open orders are unfinished invoices. Use isSubscription=true to find repeating invoices (abonnementer/repeterende fakturaer). Use isClosed=false for open/unsent orders. Use fields=*,orderLines(*) to include order lines.",
    {
      orderDateFrom: z.string().describe("YYYY-MM-DD"),
      orderDateTo: z.string().describe("YYYY-MM-DD"),
      customerId: z.number().optional().describe("Filter by customer ID"),
      isClosed: z.boolean().optional().describe("false = open/unsent orders, true = closed/invoiced orders"),
      isSubscription: z.boolean().optional().describe("true = repeating invoices (abonnementer)"),
      fields: z.string().optional().describe("Comma-separated fields. Use '*,orderLines(*)' to include lines."),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/order",
          optionalParams({
            orderDateFrom: args.orderDateFrom,
            orderDateTo: args.orderDateTo,
            customerId: args.customerId,
            isClosed: args.isClosed,
            isSubscription: args.isSubscription,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "get_order",
    "Get a single order by ID. Use fields=*,orderLines(*) to include order lines.",
    {
      id: z.number(),
      fields: z.string().optional().describe("Comma-separated fields. Use '*,orderLines(*)' for full detail."),
    },
    async ({ id, fields }) =>
      run(() => client.get(`/order/${id}`, optionalParams({ fields })))
  );

  // ==================== INVOICES ====================

  server.tool(
    "create_order",
    "Create an order in Tripletex. Use invoice_order to convert to invoice.",
    {
      customerId: z.number().describe("Customer ID"),
      orderDate: z.string().describe("YYYY-MM-DD"),
      deliveryDate: z.string().describe("YYYY-MM-DD"),
      orderLines: z.array(orderLineSchema).optional(),
      isPrioritizeAmountsIncludingVat: z.boolean().optional(),
      currencyId: z.number().optional(),
      ourReference: z.string().optional(),
      yourReference: z.string().optional(),
      invoiceComment: z.string().optional(),
      receiverEmail: z.string().optional(),
      invoicesDueIn: z.number().optional(),
    },
    async (args) => run(() => client.post("/order", buildOrderBody(args)))
  );

  server.tool(
    "invoice_order",
    "Convert an order to an invoice.",
    {
      orderId: z.number(),
      invoiceDate: z.string().describe("YYYY-MM-DD"),
      sendToCustomer: z.boolean().optional(),
    },
    async ({ orderId, invoiceDate, sendToCustomer }) =>
      run(() => {
        const params = optionalParams({
          invoiceDate,
          ...(sendToCustomer !== undefined ? { sendToCustomer } : {}),
        });
        return client.put(`/order/${orderId}/:invoice`, {}, params);
      })
  );

  server.tool(
    "create_invoice",
    "Create order then invoice in one flow. Always search for the customer first to get their ID. Set sendToCustomer=true to email the invoice.",
    {
      customerId: z.number(),
      invoiceDate: z.string().describe("YYYY-MM-DD"),
      orderLines: z.array(orderLineSchema),
      isPrioritizeAmountsIncludingVat: z.boolean().optional(),
      currencyId: z.number().optional(),
      ourReference: z.string().optional(),
      invoiceComment: z.string().optional(),
      receiverEmail: z.string().optional().describe("Email to send invoice to"),
      sendToCustomer: z.boolean().optional().describe("Set true to email the invoice after creation"),
    },
    async (args) =>
      run(async () => {
        const orderBody = buildOrderBody({
          customerId: args.customerId,
          orderDate: args.invoiceDate,
          deliveryDate: args.invoiceDate,
          orderLines: args.orderLines,
          isPrioritizeAmountsIncludingVat: args.isPrioritizeAmountsIncludingVat,
          currencyId: args.currencyId,
          ourReference: args.ourReference,
          invoiceComment: args.invoiceComment,
          receiverEmail: args.receiverEmail,
        });
        const orderResult = await client.post("/order", orderBody);
        const orderId = readValueId(orderResult);
        if (orderId === undefined) {
          throw new Error(
            "create_invoice: order created but no value.id in response:\n" +
              formatResult(orderResult)
          );
        }
        const params = optionalParams({
          invoiceDate: args.invoiceDate,
          ...(args.sendToCustomer !== undefined
            ? { sendToCustomer: args.sendToCustomer }
            : {}),
        });
        return client.put(`/order/${orderId}/:invoice`, {}, params);
      })
  );

  server.tool(
    "get_invoice",
    "Get invoice by ID.",
    {
      id: z.number(),
      fields: z.string().optional(),
    },
    async ({ id, fields }) =>
      run(() => client.get(`/invoice/${id}`, optionalParams({ fields })))
  );

  server.tool(
    "search_invoices",
    "Search outgoing invoices by date range, customer, or invoice number. Use fields to limit response size.",
    {
      invoiceDateFrom: z.string().describe("YYYY-MM-DD"),
      invoiceDateTo: z.string().describe("YYYY-MM-DD"),
      customerId: z.number().optional(),
      invoiceNumber: z.string().optional().describe("Filter by invoice number"),
      isCredited: z.boolean().optional(),
      fields: z.string().optional().describe("Comma-separated fields, e.g. 'id,invoiceNumber,amount,customer(id,name)'"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/invoice",
          optionalParams({
            invoiceDateFrom: args.invoiceDateFrom,
            invoiceDateTo: args.invoiceDateTo,
            customerId: args.customerId,
            invoiceNumber: args.invoiceNumber,
            isCredited: args.isCredited,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "search_supplier_invoices",
    "Search incoming supplier invoices (leverandørfakturaer) by date range or supplier. Tripletex: invoiceDateTo is exclusive (to and excluding) — use the day after the last day you want included (e.g. whole April: from 2026-04-01 to 2026-05-01).",
    {
      invoiceDateFrom: z.string().describe("YYYY-MM-DD (inclusive)"),
      invoiceDateTo: z.string().describe("YYYY-MM-DD (exclusive end)"),
      supplierId: z.number().optional(),
      fields: z.string().optional().describe("Comma-separated fields to return"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/supplierInvoice",
          optionalParams({
            invoiceDateFrom: args.invoiceDateFrom,
            invoiceDateTo: args.invoiceDateTo,
            supplierId: args.supplierId,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "get_supplier_invoice",
    "Get one supplier invoice (leverandørfaktura) by ID with voucher and approval details. Use fields=*,voucher(*),approvalListElements(*) for full data.",
    {
      id: z.number().describe("Supplier invoice ID"),
      fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields, e.g. '*,voucher(*),approvalListElements(*)'"
        ),
    },
    async ({ id, fields }) =>
      run(() =>
        client.get(`/supplierInvoice/${id}`, optionalParams({ fields }))
      )
  );

  server.tool(
    "get_supplier_invoices_for_approval",
    "List supplier invoices pending approval (attest) in Tripletex.",
    {
      searchText: z
        .string()
        .optional()
        .describe("Search department, employee, project, etc."),
      showAll: z
        .boolean()
        .optional()
        .describe("false = own items only (default), true = all"),
      employeeId: z.number().optional(),
      fields: z.string().optional(),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/supplierInvoice/forApproval",
          optionalParams({
            searchText: args.searchText,
            showAll: args.showAll,
            employeeId: args.employeeId,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "get_voucher_inbox_count",
    "Get the number of items in the Tripletex voucher inbox (bilagsmottak queue).",
    {
      fields: z.string().optional(),
    },
    async ({ fields }) =>
      run(() =>
        client.get("/voucherInbox/inboxCount", optionalParams({ fields }))
      )
  );

  server.tool(
    "approve_supplier_invoice",
    "Approve a supplier invoice (attestation). Optional comment as query parameter per Tripletex API.",
    {
      invoiceId: z.number().describe("Supplier invoice ID"),
      comment: z.string().optional(),
    },
    async ({ invoiceId, comment }) =>
      run(() =>
        client.put(
          `/supplierInvoice/${invoiceId}/:approve`,
          {},
          optionalParams({ comment })
        )
      )
  );

  server.tool(
    "reject_supplier_invoice",
    "Reject a supplier invoice. comment is required by Tripletex.",
    {
      invoiceId: z.number().describe("Supplier invoice ID"),
      comment: z.string().describe("Rejection reason"),
    },
    async ({ invoiceId, comment }) =>
      run(() =>
        client.put(
          `/supplierInvoice/${invoiceId}/:reject`,
          {},
          optionalParams({ comment })
        )
      )
  );

  server.tool(
    "update_supplier_invoice_postings",
    "[BETA] Update debit/credit postings on a supplier invoice voucher. voucherId is the ledger voucher id (from get_supplier_invoice → voucher.id). Body uses Tripletex OrderLinePosting shape (wrapped posting objects).",
    {
      voucherId: z.number().describe("Ledger voucher ID"),
      voucherDate: z
        .string()
        .optional()
        .describe("If set, changes voucher and supplier invoice date"),
      sendToLedger: z
        .boolean()
        .optional()
        .describe(
          "Tripletex: true may require special setup; default leave unset/false"
        ),
      postings: z
        .array(
          z.object({
            id: z
              .number()
              .optional()
              .describe("Existing posting id when updating a row"),
            row: z.number(),
            accountId: z.number(),
            amountGross: z.number(),
            amountGrossCurrency: z.number().optional(),
            date: z
              .string()
              .optional()
              .describe("Posting date YYYY-MM-DD; defaults to voucherDate"),
            vatTypeId: z.number().optional(),
            description: z.string().optional(),
            supplierId: z.number().optional(),
            customerId: z.number().optional(),
            projectId: z.number().optional(),
            departmentId: z.number().optional(),
          })
        )
        .describe("Posting rows to send (Tripletex may regenerate guiRow 0)"),
    },
    async ({ voucherId, voucherDate, sendToLedger, postings }) => {
      const fromLine = postings.map((p) => p.date).find((d) => d !== undefined);
      const dateForRows = voucherDate ?? fromLine;
      if (dateForRows === undefined) {
        throw new Error(
          "Provide voucherDate (YYYY-MM-DD) or a date on each posting."
        );
      }
      const body = wrapPostingsForSupplierInvoiceUpdate(
        dateForRows,
        postings.map((p) => ({
          id: p.id,
          row: p.row,
          accountId: p.accountId,
          amountGross: p.amountGross,
          amountGrossCurrency: p.amountGrossCurrency,
          date: p.date,
          vatTypeId: p.vatTypeId,
          description: p.description,
          supplierId: p.supplierId,
          customerId: p.customerId,
          projectId: p.projectId,
          departmentId: p.departmentId,
        }))
      );
      return run(() =>
        client.put(
          `/supplierInvoice/voucher/${voucherId}/postings`,
          body,
          optionalParams({
            voucherDate,
            sendToLedger,
          })
        )
      );
    }
  );

  // ==================== CUSTOMERS & SUPPLIERS & PRODUCTS ====================

  server.tool(
    "search_customers",
    "Search customers by name, customer number, org number, or email. Always search before creating to avoid duplicates.",
    {
      query: z.string().optional().describe("Search by name"),
      customerNumber: z.string().optional(),
      organizationNumber: z.string().optional().describe("Norwegian org.nr"),
      email: z.string().optional(),
      isActive: z.boolean().optional(),
      fields: z.string().optional().describe("Comma-separated fields, e.g. 'id,name,organizationNumber,email'"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/customer",
          optionalParams({
            name: args.query,
            customerNumber: args.customerNumber,
            organizationNumber: args.organizationNumber,
            email: args.email,
            isActive: args.isActive,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "create_customer",
    "Create a new customer. Always search_customers first to avoid duplicates. Name is required; include organizationNumber for B2B.",
    createCustomerSchema.shape,
    async (input) =>
      run(() =>
        client.post(
          "/customer",
          buildCustomerBody(createCustomerSchema.parse(input))
        )
      )
  );

  server.tool(
    "update_customer",
    "Update an existing customer by ID. Only include fields you want to change.",
    {
      id: z.number(),
      name: z.string().optional(),
      organizationNumber: z.string().optional(),
      email: z.string().optional(),
      invoiceEmail: z.string().optional(),
      phoneNumber: z.string().optional(),
      phoneNumberMobile: z.string().optional(),
      invoiceSendMethod: z.string().optional(),
      language: z.string().optional(),
      currencyId: z.number().optional(),
      postalAddress: postalAddressSchema,
    },
    async ({ id, ...rest }) =>
      run(() => {
        const body: Record<string, unknown> = {};
        if (rest.name !== undefined) body.name = rest.name;
        if (rest.organizationNumber !== undefined)
          body.organizationNumber = rest.organizationNumber;
        if (rest.email !== undefined) body.email = rest.email;
        if (rest.invoiceEmail !== undefined)
          body.invoiceEmail = rest.invoiceEmail;
        if (rest.phoneNumber !== undefined) body.phoneNumber = rest.phoneNumber;
        if (rest.phoneNumberMobile !== undefined)
          body.phoneNumberMobile = rest.phoneNumberMobile;
        if (rest.invoiceSendMethod !== undefined)
          body.invoiceSendMethod = rest.invoiceSendMethod;
        if (rest.language !== undefined) body.language = rest.language;
        if (rest.currencyId !== undefined)
          body.currency = { id: rest.currencyId };
        if (rest.postalAddress !== undefined)
          body.postalAddress = rest.postalAddress;
        return client.put(`/customer/${id}`, body);
      })
  );

  server.tool(
    "search_products",
    "Search products in the product register by name or product number.",
    {
      query: z.string().optional().describe("Search by product name"),
      number: z.string().optional().describe("Search by product number"),
      isInactive: z.boolean().optional(),
      fields: z.string().optional().describe("Comma-separated fields to return"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/product",
          optionalParams({
            name: args.query,
            number: args.number,
            isInactive: args.isInactive,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "create_product",
    "Create a product in the product register. Products can be referenced in order lines.",
    {
      name: z.string(),
      number: z.string().optional(),
      priceExcludingVatCurrency: z.number().optional(),
      priceIncludingVatCurrency: z.number().optional(),
      vatTypeId: z.number().optional(),
      currencyId: z.number().optional(),
      description: z.string().optional(),
      isInactive: z.boolean().optional(),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = { name: args.name };
        if (args.number !== undefined) body.number = args.number;
        if (args.priceExcludingVatCurrency !== undefined)
          body.priceExcludingVatCurrency = args.priceExcludingVatCurrency;
        if (args.priceIncludingVatCurrency !== undefined)
          body.priceIncludingVatCurrency = args.priceIncludingVatCurrency;
        if (args.vatTypeId !== undefined) body.vatType = { id: args.vatTypeId };
        if (args.currencyId !== undefined)
          body.currency = { id: args.currencyId };
        if (args.description !== undefined) body.description = args.description;
        if (args.isInactive !== undefined) body.isInactive = args.isInactive;
        return client.post("/product", body);
      })
  );

  server.tool(
    "search_suppliers",
    "Search suppliers (leverandører) by name or org number.",
    {
      query: z.string().optional().describe("Search by supplier name"),
      organizationNumber: z.string().optional(),
      fields: z.string().optional().describe("Comma-separated fields to return"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/supplier",
          optionalParams({
            name: args.query,
            organizationNumber: args.organizationNumber,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "create_supplier",
    "Create a new supplier (leverandør). Include organizationNumber and bankAccountNumber when available.",
    {
      name: z.string(),
      organizationNumber: z.string().optional(),
      email: z.string().optional(),
      postalAddress: postalAddressSchema,
      bankAccountNumber: z.string().optional(),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = { name: args.name };
        if (args.organizationNumber !== undefined)
          body.organizationNumber = args.organizationNumber;
        if (args.email !== undefined) body.email = args.email;
        if (args.postalAddress !== undefined)
          body.postalAddress = args.postalAddress;
        if (args.bankAccountNumber !== undefined)
          body.bankAccountNumber = args.bankAccountNumber;
        return client.post("/supplier", body);
      })
  );

  server.tool(
    "get_supplier",
    "Get one supplier (leverandør) by ID. Use before update_supplier to read version and current fields. Updating this same id preserves all historical voucher links; do not create a duplicate supplier to change org.nr.",
    {
      id: z.number().describe("Supplier ID"),
      fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields, e.g. id,name,organizationNumber,version,email,postalAddress,bankAccountNumber,isInactive"
        ),
    },
    async (args) =>
      run(() =>
        client.get(`/supplier/${args.id}`, optionalParams({ fields: args.fields }))
      )
  );

  server.tool(
    "update_supplier",
    "Update an existing supplier (PUT /supplier/{id}). Only include fields to change. Prefer this over create_supplier so long-running voucher history stays on one supplier id. If Tripletex rejects the update, call get_supplier and pass version from the response.",
    {
      id: z.number().describe("Supplier ID to update"),
      version: z
        .number()
        .optional()
        .describe("Optimistic lock version from get_supplier (value.version)"),
      name: z.string().optional(),
      organizationNumber: z.string().optional(),
      email: z.string().optional(),
      postalAddress: postalAddressSchema,
      bankAccountNumber: z.string().optional(),
      isInactive: z.boolean().optional(),
      invoiceEmail: z.string().optional(),
      phoneNumber: z.string().optional(),
      phoneNumberMobile: z.string().optional(),
      description: z.string().optional(),
      website: z.string().optional(),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = { id: args.id };
        if (args.version !== undefined) body.version = args.version;
        if (args.name !== undefined) body.name = args.name;
        if (args.organizationNumber !== undefined)
          body.organizationNumber = args.organizationNumber;
        if (args.email !== undefined) body.email = args.email;
        if (args.postalAddress !== undefined)
          body.postalAddress = args.postalAddress;
        if (args.bankAccountNumber !== undefined)
          body.bankAccountNumber = args.bankAccountNumber;
        if (args.isInactive !== undefined) body.isInactive = args.isInactive;
        if (args.invoiceEmail !== undefined)
          body.invoiceEmail = args.invoiceEmail;
        if (args.phoneNumber !== undefined) body.phoneNumber = args.phoneNumber;
        if (args.phoneNumberMobile !== undefined)
          body.phoneNumberMobile = args.phoneNumberMobile;
        if (args.description !== undefined) body.description = args.description;
        if (args.website !== undefined) body.website = args.website;
        if (Object.keys(body).length <= 1) {
          throw new Error(
            "update_supplier: pass at least one field to change (e.g. organizationNumber, email) in addition to id."
          );
        }
        return client.put(`/supplier/${args.id}`, body);
      })
  );

  // ==================== LEDGER ====================

  server.tool(
    "search_accounts",
    "Search the chart of accounts (kontoplan). Use numberFrom/numberTo to filter by account range (e.g. 3000-3999 for revenue).",
    {
      query: z.string().optional().describe("Search by account name"),
      numberFrom: z.string().optional().describe("Account number range start, e.g. '3000'"),
      numberTo: z.string().optional().describe("Account number range end, e.g. '3999'"),
      fields: z.string().optional().describe("Comma-separated fields, e.g. 'id,number,name'"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/ledger/account",
          optionalParams({
            name: args.query,
            numberFrom: args.numberFrom,
            numberTo: args.numberTo,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "search_vat_types",
    "List VAT types (MVA-koder) with rates. Common: 25% standard, 15% food, 12% transport, 0% exempt.",
    {
      query: z.string().optional(),
    },
    async ({ query }) =>
      run(() => client.get("/ledger/vatType", optionalParams({ name: query })))
  );

  server.tool(
    "search_voucher_types",
    "Search ledger voucher types (bilagstyper), e.g. name Leverandørfaktura for incoming supplier invoices. Use the returned id as voucherTypeId on create_supplier_invoice.",
    {
      name: z
        .string()
        .optional()
        .describe("Substring match on voucher type name (Tripletex name parameter)"),
      fields: z
        .string()
        .optional()
        .describe("e.g. id,name,displayName (avoid invalid field names)"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/ledger/voucherType",
          optionalParams({
            name: args.name,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "search_ledger_postings",
    "Search ledger postings by account, supplier, customer, date range, etc.",
    {
      dateFrom: z.string().describe("YYYY-MM-DD (required)"),
      dateTo: z.string().describe("YYYY-MM-DD (required)"),
      accountId: z.number().optional().describe("Filter by account ID"),
      supplierId: z.number().optional().describe("Filter by supplier ID"),
      customerId: z.number().optional().describe("Filter by customer ID"),
      employeeId: z.number().optional().describe("Filter by employee ID"),
      departmentId: z.number().optional().describe("Filter by department ID"),
      projectId: z.number().optional().describe("Filter by project ID"),
      productId: z.number().optional().describe("Filter by product ID"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/ledger/posting",
          optionalParams({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            accountId: args.accountId,
            supplierId: args.supplierId,
            customerId: args.customerId,
            employeeId: args.employeeId,
            departmentId: args.departmentId,
            projectId: args.projectId,
            productId: args.productId,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "create_voucher",
    "Create an accounting voucher (bilag) with debit/credit postings. Postings must balance (sum to zero). Uses Tripletex amountGross per posting. sendToLedger=false keeps the voucher in voucher reception (bilagsmottak) instead of posting immediately (default true).",
    {
      date: z.string().describe("Voucher date YYYY-MM-DD"),
      description: z.string().optional(),
      sendToLedger: z
        .boolean()
        .optional()
        .describe(
          "If false, voucher is created for review (bilagsmottak) and not posted. Default true."
        ),
      postings: z.array(
        z.object({
          accountId: z.number(),
          amountGross: z.number(),
          amountGrossCurrency: z.number().optional(),
          date: z.string().describe("Posting date YYYY-MM-DD"),
          vatTypeId: z.number().optional(),
          row: z.number().optional(),
          description: z.string().optional(),
          supplierId: z.number().optional(),
          customerId: z.number().optional(),
          projectId: z.number().optional(),
          departmentId: z.number().optional(),
          termOfPayment: z.string().optional(),
          invoiceNumber: z.string().optional(),
        })
      ),
    },
    async ({ date, description, sendToLedger, postings }) =>
      run(() => {
        const params =
          sendToLedger === undefined
            ? undefined
            : { sendToLedger: String(sendToLedger) };
        return client.post(
          "/ledger/voucher",
          {
            date,
            ...(description !== undefined ? { description } : {}),
            postings: postings.map((p) =>
              transformVoucherPosting({
                accountId: p.accountId,
                amountGross: p.amountGross,
                amountGrossCurrency: p.amountGrossCurrency,
                date: p.date,
                vatTypeId: p.vatTypeId,
                row: p.row,
                description: p.description,
                supplierId: p.supplierId,
                customerId: p.customerId,
                projectId: p.projectId,
                departmentId: p.departmentId,
                termOfPayment: p.termOfPayment,
                invoiceNumber: p.invoiceNumber,
              })
            ),
          },
          params
        );
      })
  );

  const supplierInvoiceLineSchema = z.object({
    costAccountId: z.number(),
    amountExVat: z.number(),
    vatAmount: z.number(),
    vatTypeId: z.number(),
    description: z.string().optional(),
    projectId: z.number().optional(),
    departmentId: z.number().optional(),
  });

  server.tool(
    "create_supplier_invoice",
    "Create a supplier invoice as a non-posted ledger voucher (sendToLedger=false) so it can go through bilagsmottak / approval. Builds cost debit line(s) with VAT type and a balancing credit on leverandørgjeld (default account 2400) with supplier reference. Pass amountExVat and vatAmount per line; amounts including VAT (beløp inkl. MVA) are sent to Tripletex as amountGross. By default sets voucher type to Leverandørfaktura when found (search_voucher_types); set useDefaultLeverandorVoucherType=false to omit. See PHASE1-RESULTS.md.",
    {
      invoiceDate: z.string().describe("Invoice date YYYY-MM-DD"),
      dueDate: z.string().optional().describe("Due date YYYY-MM-DD (mapped to termOfPayment on AP line; verify in Tripletex)"),
      supplierId: z.number().describe("Supplier ID (search_suppliers)"),
      invoiceNumber: z.string().optional().describe("Supplier invoice number → vendorInvoiceNumber"),
      description: z.string().describe("Voucher / invoice description"),
      kid: z.string().optional().describe("KID / payment reference (appended to credit line description)"),
      amountExVat: z.number().describe("Total excluding VAT (single-line mode)"),
      vatAmount: z.number().describe("Total VAT amount (single-line mode)"),
      costAccountId: z.number().describe("Cost account ID (single-line mode)"),
      vatTypeId: z.number().describe("VAT type ID on cost line (single-line mode)"),
      projectId: z.number().optional(),
      departmentId: z.number().optional(),
      lines: z
        .array(supplierInvoiceLineSchema)
        .optional()
        .describe(
          "Multiple cost lines; when set, overrides single-line costAccountId/amountExVat/vatAmount/vatTypeId"
        ),
      voucherTypeId: z
        .number()
        .optional()
        .describe(
          "Ledger voucher type id; overrides default Leverandørfaktura resolution"
        ),
      useDefaultLeverandorVoucherType: z
        .boolean()
        .optional()
        .describe(
          "When true (default), if voucherTypeId is omitted, resolves Leverandørfaktura via /ledger/voucherType?name=Leverandørfaktura"
        ),
      supplierPayableAccountNumber: z
        .number()
        .optional()
        .describe(
          "Chart account number for leverandørgjeld (default 2400). Resolved to account id via /ledger/account."
        ),
    },
    async (args) =>
      run(async () => {
        const useLines = args.lines !== undefined && args.lines.length > 0;
        const supplierAccountId = await lookupLedgerAccountIdByNumber(
          client,
          args.supplierPayableAccountNumber ?? 2400
        );
        let voucherTypeId = args.voucherTypeId;
        const useLevDefault = args.useDefaultLeverandorVoucherType ?? true;
        if (voucherTypeId === undefined && useLevDefault) {
          voucherTypeId = await resolveLeverandorVoucherTypeId(client);
        }
        const body = buildSupplierInvoiceVoucherBody({
          invoiceDate: args.invoiceDate,
          description: args.description,
          supplierId: args.supplierId,
          supplierAccountId,
          invoiceNumber: args.invoiceNumber,
          voucherTypeId,
          dueDate: args.dueDate,
          kid: args.kid,
          costAccountId: args.costAccountId,
          vatTypeId: args.vatTypeId,
          amountExVat: args.amountExVat,
          vatAmount: args.vatAmount,
          projectId: args.projectId,
          departmentId: args.departmentId,
          lines: useLines ? args.lines : undefined,
        });
        return client.post("/ledger/voucher", body, { sendToLedger: "false" });
      }, CREATE_SUPPLIER_INVOICE_RESULT_NOTE)
  );

  server.tool(
    "search_vouchers",
    "Search vouchers (bilag) by date range or number. Tripletex: dateTo is exclusive (to and excluding)—use the day after the last day you want. Filter by voucher type with typeId (from search_voucher_types, e.g. Leverandørfaktura). Use fields=*,postings(*) for full postings.",
    {
      dateFrom: z.string().describe("YYYY-MM-DD (inclusive)"),
      dateTo: z.string().describe("YYYY-MM-DD (exclusive end)"),
      numberFrom: z.string().optional().describe("Voucher number range start"),
      numberTo: z.string().optional().describe("Voucher number range end"),
      typeId: z
        .number()
        .optional()
        .describe(
          "Ledger voucher type id (e.g. Leverandørfaktura) — same as Tripletex query typeId"
        ),
      fields: z.string().optional().describe("Comma-separated fields. Use '*,postings(*)' to include postings."),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/ledger/voucher",
          optionalParams({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            numberFrom: args.numberFrom,
            numberTo: args.numberTo,
            typeId: args.typeId,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "get_voucher",
    "Get voucher by ID.",
    {
      id: z.number(),
      fields: z.string().optional(),
    },
    async ({ id, fields }) =>
      run(() =>
        client.get(`/ledger/voucher/${id}`, optionalParams({ fields }))
      )
  );

  server.tool(
    "send_voucher_to_ledger",
    "Bokfør et bilag (send voucher to ledger). Bruk når bilaget finnes men ikke er bokført, eller når approve_supplier_invoice ikke gjelder. Krever typisk «Avansert bilag»-tilgang i Tripletex.",
    {
      voucherId: z.number().describe("Ledger voucher id (fra get_voucher / search_vouchers)"),
      version: z
        .number()
        .optional()
        .describe(
          "Voucher version fra get_voucher — anbefales for optimistisk låsing"
        ),
      voucherNumber: z
        .number()
        .optional()
        .describe("Bilagsnummer; utelates eller 0 = Tripletex tildeler nummer"),
    },
    async ({ voucherId, version, voucherNumber }) =>
      run(() =>
        client.put(
          `/ledger/voucher/${voucherId}/:sendToLedger`,
          undefined,
          optionalParams({
            version,
            number: voucherNumber,
          })
        )
      )
  );

  server.tool(
    "attach_voucher_document",
    "Last opp PDF/PNG/JPEG/TIFF til et eksisterende bilag (samme som Tripletex «vedlegg»; PDF kan få flere sider). Send fil som Base64 (uten data:-prefiks). Maks ca. 8 MB dekodet innhold.",
    {
      voucherId: z.number(),
      fileBase64: z
        .string()
        .describe("Filinnhold som standard Base64 (ikke data:URL)"),
      fileName: z
        .string()
        .optional()
        .describe("Filnavn, f.eks. leverandor-faktura.pdf"),
      mimeType: z
        .string()
        .optional()
        .describe("MIME-type, standard application/pdf"),
    },
    async ({ voucherId, fileBase64, fileName, mimeType }) =>
      run(() => {
        let buf: Buffer;
        try {
          buf = Buffer.from(fileBase64, "base64");
        } catch {
          throw new Error("Ugyldig Base64.");
        }
        if (buf.length > MAX_BASE64_DOCUMENT_BYTES) {
          throw new Error(
            `Filen er for stor etter dekoding (maks ${MAX_BASE64_DOCUMENT_BYTES} bytes).`
          );
        }
        const form = new FormData();
        const blob = new Blob([new Uint8Array(buf)], {
          type: mimeType ?? "application/pdf",
        });
        form.append("file", blob, fileName ?? "document.pdf");
        return client.postMultipart(
          `/ledger/voucher/${voucherId}/attachment`,
          form
        );
      })
  );

  server.tool(
    "import_ledger_voucher_document",
    "Opprett ett eller flere bilag fra opplastet dokument (PDF, PNG, JPEG, TIFF). Tilsvarer Tripletex import av bilag. Send fil som Base64. Maks ca. 8 MB dekodet. Passer når brukeren har en faktura-PDF og vil inn i bilagsmottak.",
    {
      fileBase64: z.string().describe("Fil som standard Base64 (uten data:-prefiks)"),
      fileName: z.string().optional().describe("Filnavn for sporbarhet"),
      mimeType: z.string().optional().describe("MIME-type, default application/pdf"),
      description: z
        .string()
        .optional()
        .describe("Valgfri beskrivelse på bilaget (Tripletex multipart-felt)"),
      split: z
        .boolean()
        .optional()
        .describe(
          "true = ett bilag per side (PDF); false = ett bilag for hele dokumentet"
        ),
    },
    async ({ fileBase64, fileName, mimeType, description, split }) =>
      run(() => {
        let buf: Buffer;
        try {
          buf = Buffer.from(fileBase64, "base64");
        } catch {
          throw new Error("Ugyldig Base64.");
        }
        if (buf.length > MAX_BASE64_DOCUMENT_BYTES) {
          throw new Error(
            `Filen er for stor etter dekoding (maks ${MAX_BASE64_DOCUMENT_BYTES} bytes).`
          );
        }
        const form = new FormData();
        const blob = new Blob([new Uint8Array(buf)], {
          type: mimeType ?? "application/pdf",
        });
        form.append("file", blob, fileName ?? "document.pdf");
        if (description !== undefined && description !== "")
          form.append("description", description);
        const q =
          split === undefined
            ? undefined
            : { split: split ? "true" : "false" };
        return client.postMultipart("/ledger/voucher/importDocument", form, q);
      })
  );

  // ==================== BALANCE SHEET ====================

  server.tool(
    "get_balance_sheet",
    "Get balance sheet (saldobalanse) for a period. Shows all account balances. Use accountNumberFrom/To to filter by range.",
    {
      dateFrom: z.string(),
      dateTo: z.string(),
      accountNumberFrom: z.number().optional(),
      accountNumberTo: z.number().optional(),
      customerId: z.number().optional(),
      employeeId: z.number().optional(),
      departmentId: z.number().optional(),
      projectId: z.number().optional(),
      includeSubProjects: z.boolean().optional(),
      activeAccountsWithoutMovements: z.boolean().optional(),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/balanceSheet",
          optionalParams({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            accountNumberFrom: args.accountNumberFrom,
            accountNumberTo: args.accountNumberTo,
            customerId: args.customerId,
            employeeId: args.employeeId,
            departmentId: args.departmentId,
            projectId: args.projectId,
            includeSubProjects: args.includeSubProjects,
            activeAccountsWithoutMovements:
              args.activeAccountsWithoutMovements,
            from: args.from,
            count: args.count ?? 1000,
          })
        )
      )
  );

  // ==================== TIME & EMPLOYEES ====================

  server.tool(
    "search_projects",
    "Search projects by name. Projects are used for time tracking and cost allocation.",
    {
      query: z.string().optional(),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async ({ query, from, count }) =>
      run(() =>
        client.get(
          "/project",
          optionalParams({ name: query, from, count: count ?? 25 })
        )
      )
  );

  server.tool(
    "search_activities",
    "Search activities. Activities are linked to projects and used in time entries.",
    {
      query: z.string().optional(),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async ({ query, from, count }) =>
      run(() =>
        client.get(
          "/activity",
          optionalParams({ name: query, from, count: count ?? 50 })
        )
      )
  );

  server.tool(
    "search_time_entries",
    "Search timesheet entries (timelister) by date range, employee, or project.",
    {
      dateFrom: z.string(),
      dateTo: z.string(),
      employeeId: z.number().optional(),
      projectId: z.number().optional(),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/timesheet/entry",
          optionalParams({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            employeeId: args.employeeId,
            projectId: args.projectId,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "create_time_entry",
    "Log hours on a project/activity. Requires employeeId, projectId, and activityId — search for these first if unknown.",
    {
      employeeId: z.number(),
      projectId: z.number(),
      activityId: z.number(),
      date: z.string(),
      hours: z.number(),
      comment: z.string().optional(),
    },
    async ({ employeeId, projectId, activityId, date, hours, comment }) =>
      run(() => {
        const body: Record<string, unknown> = {
          employee: { id: employeeId },
          project: { id: projectId },
          activity: { id: activityId },
          date,
          hours,
        };
        if (comment !== undefined) body.comment = comment;
        return client.post("/timesheet/entry", body);
      })
  );

  server.tool(
    "search_employees",
    "Search employees by first name, last name, or both. Returns employee ID, name, email, and department.",
    {
      firstName: z.string().optional().describe("Filter by first name"),
      lastName: z.string().optional().describe("Filter by last name"),
      fields: z.string().optional().describe("Comma-separated fields to return, e.g. 'id,firstName,lastName,email'"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/employee",
          optionalParams({
            firstName: args.firstName,
            lastName: args.lastName,
            fields: args.fields,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "create_employee",
    "Create a new employee.",
    {
      firstName: z.string(),
      lastName: z.string(),
      departmentId: z.number().describe("Department ID"),
      userType: z.string().optional().describe("e.g. STANDARD"),
      email: z.string().optional(),
      phoneNumberMobile: z.string().optional(),
      dateOfBirth: z.string().optional().describe("YYYY-MM-DD"),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = {
          firstName: args.firstName,
          lastName: args.lastName,
          department: { id: args.departmentId },
          userType: args.userType ?? "STANDARD",
        };
        if (args.email !== undefined) body.email = args.email;
        if (args.phoneNumberMobile !== undefined)
          body.phoneNumberMobile = args.phoneNumberMobile;
        if (args.dateOfBirth !== undefined) body.dateOfBirth = args.dateOfBirth;
        return client.post("/employee", body);
      })
  );

  server.tool(
    "create_project",
    "Create a new project.",
    {
      name: z.string().describe("Project name"),
      number: z.string().optional(),
      projectManagerId: z.number().optional(),
      customerId: z.number().optional(),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD"),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = { name: args.name };
        if (args.number !== undefined) body.number = args.number;
        if (args.projectManagerId !== undefined)
          body.projectManager = { id: args.projectManagerId };
        if (args.customerId !== undefined)
          body.customer = { id: args.customerId };
        if (args.startDate !== undefined) body.startDate = args.startDate;
        if (args.endDate !== undefined) body.endDate = args.endDate;
        return client.post("/project", body);
      })
  );

  server.tool(
    "create_department",
    "Create a new department.",
    {
      name: z.string().describe("Department name"),
      departmentNumber: z.string().optional(),
      departmentManagerId: z.number().optional(),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = { name: args.name };
        if (args.departmentNumber !== undefined)
          body.departmentNumber = args.departmentNumber;
        if (args.departmentManagerId !== undefined)
          body.departmentManager = { id: args.departmentManagerId };
        return client.post("/department", body);
      })
  );

  // ==================== TRAVEL EXPENSES & MILEAGE ====================

  server.tool(
    "search_travel_expenses",
    "Search for travel expense reports (reiseregninger). " +
      "Filter by employee, project, department, date range, and state (OPEN, APPROVED, DELIVERED, etc.).",
    {
      employeeId: z.string().optional().describe("Filter by employee ID"),
      departmentId: z.string().optional().describe("Filter by department ID"),
      projectId: z.string().optional().describe("Filter by project ID"),
      departureDateFrom: z
        .string()
        .optional()
        .describe("From date (YYYY-MM-DD), inclusive"),
      returnDateTo: z
        .string()
        .optional()
        .describe("To date (YYYY-MM-DD), exclusive"),
      state: z
        .enum(["ALL", "OPEN", "APPROVED", "SALARY_PAID", "DELIVERED"])
        .optional()
        .describe("Filter by state. Default: ALL"),
      fields: z
        .string()
        .optional()
        .describe(
          "Comma-separated fields to return. Default expands employee, project, department, and mileageAllowances. Use '*' for a lighter response when you only need the list."
        ),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/travelExpense",
          optionalParams({
            employeeId: args.employeeId,
            departmentId: args.departmentId,
            projectId: args.projectId,
            departureDateFrom: args.departureDateFrom,
            returnDateTo: args.returnDateTo,
            state: args.state,
            from: args.from,
            count: args.count ?? 25,
            fields:
              args.fields ??
              "*,employee(id,firstName,lastName),project(id,name),department(id,name),mileageAllowances(id,date,departureLocation,destination,km,amount)",
          })
        )
      )
  );

  server.tool(
    "get_travel_expense",
    "Get a single travel expense report by ID, including all mileage allowances, costs, and status details.",
    {
      id: z.number().describe("Travel expense ID"),
    },
    async ({ id }) =>
      run(() =>
        client.get(
          `/travelExpense/${id}`,
          optionalParams({
            fields:
              "*,employee(*),project(id,name),department(id,name),mileageAllowances(*),costs(*)",
          })
        )
      )
  );

  server.tool(
    "create_travel_expense",
    "Create a new travel expense report (reiseregning). " +
      "The report acts as a container for mileage allowances and costs. " +
      "After creating, use create_mileage_allowance to add driving entries.",
    {
      employeeId: z
        .number()
        .describe(
          "Employee ID. Use search_employees or whoami to find it."
        ),
      title: z
        .string()
        .optional()
        .describe("Description, e.g. 'Kjøring april 2026'"),
      projectId: z.number().optional().describe("Link to a project"),
      departmentId: z.number().optional().describe("Link to a department"),
      isChargeable: z
        .boolean()
        .optional()
        .describe("Whether costs should be billed to the project"),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = {
          employee: { id: args.employeeId },
          isCompleted: false,
        };
        if (args.title !== undefined) body.title = args.title;
        if (args.projectId !== undefined)
          body.project = { id: args.projectId };
        if (args.departmentId !== undefined)
          body.department = { id: args.departmentId };
        if (args.isChargeable !== undefined)
          body.isChargeable = args.isChargeable;
        return client.post("/travelExpense", body);
      })
  );

  server.tool(
    "create_mileage_allowance",
    "Add a mileage allowance entry (kjøregodtgjørelse) to an existing travel expense report. " +
      "Specify departure, destination, km, and rate category. " +
      "Use search_mileage_rate_categories first to find the rate category ID for the vehicle type.",
    {
      travelExpenseId: z
        .number()
        .describe("ID of the parent travel expense report"),
      date: z.string().describe("Date of driving (YYYY-MM-DD)"),
      departureLocation: z
        .string()
        .describe("Where the trip started, e.g. 'Oslo'"),
      destination: z
        .string()
        .describe("Where the trip ended, e.g. 'Drammen'"),
      km: z.number().optional().describe("Kilometers driven"),
      rateCategoryId: z
        .number()
        .optional()
        .describe(
          "Rate category ID (from search_mileage_rate_categories). Determines the per-km rate."
        ),
      rateTypeId: z
        .number()
        .optional()
        .describe("Specific rate type ID (from search_mileage_rates)"),
      isCompanyCar: z
        .boolean()
        .optional()
        .describe("True = firmabil (no payout). Default: false"),
      tollCost: z.number().optional().describe("Bompenger in NOK"),
      passengerSupplement: z
        .number()
        .optional()
        .describe("Passasjertillegg in NOK"),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = {
          travelExpense: { id: args.travelExpenseId },
          date: args.date,
          departureLocation: args.departureLocation,
          destination: args.destination,
        };
        if (args.km !== undefined) body.km = args.km;
        if (args.rateCategoryId !== undefined)
          body.rateCategory = { id: args.rateCategoryId };
        if (args.rateTypeId !== undefined)
          body.rateType = { id: args.rateTypeId };
        if (args.isCompanyCar !== undefined)
          body.isCompanyCar = args.isCompanyCar;
        if (args.tollCost !== undefined) body.tollCost = args.tollCost;
        if (args.passengerSupplement !== undefined)
          body.passengerSupplement = args.passengerSupplement;
        return client.post("/travelExpense/mileageAllowance", body);
      })
  );

  server.tool(
    "search_mileage_allowances",
    "Search mileage allowance entries across travel expenses. " +
      "Useful for finding all driving registered in a period or for a specific route.",
    {
      travelExpenseId: z
        .string()
        .optional()
        .describe("Filter by travel expense ID"),
      departureLocation: z
        .string()
        .optional()
        .describe("Search departure location (contains)"),
      destination: z
        .string()
        .optional()
        .describe("Search destination (contains)"),
      dateFrom: z
        .string()
        .optional()
        .describe("From date (YYYY-MM-DD), inclusive"),
      dateTo: z
        .string()
        .optional()
        .describe("To date (YYYY-MM-DD), exclusive"),
      isCompanyCar: z
        .boolean()
        .optional()
        .describe("Filter by company car usage"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/travelExpense/mileageAllowance",
          optionalParams({
            travelExpenseId: args.travelExpenseId,
            departureLocation: args.departureLocation,
            destination: args.destination,
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            isCompanyCar: args.isCompanyCar,
            from: args.from,
            count: args.count ?? 25,
          })
        )
      )
  );

  server.tool(
    "search_mileage_rates",
    "Look up available mileage rates (km-satser). " +
      "Use this to find the current rate for a given vehicle type and trip type.",
    {
      rateCategoryId: z
        .string()
        .optional()
        .describe("Filter by rate category ID"),
      type: z.string().optional().describe("Rate type filter"),
      isValidDayTrip: z
        .boolean()
        .optional()
        .describe("Filter for day trip rates"),
      isValidDomestic: z
        .boolean()
        .optional()
        .describe("Filter for domestic rates"),
      isValidForeignTravel: z
        .boolean()
        .optional()
        .describe("Filter for foreign travel rates"),
      dateFrom: z
        .string()
        .optional()
        .describe("Valid from date (YYYY-MM-DD)"),
      dateTo: z
        .string()
        .optional()
        .describe("Valid to date (YYYY-MM-DD)"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/travelExpense/rate",
          optionalParams({
            rateCategoryId: args.rateCategoryId,
            type: args.type,
            isValidDayTrip: args.isValidDayTrip,
            isValidDomestic: args.isValidDomestic,
            isValidForeignTravel: args.isValidForeignTravel,
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "search_mileage_rate_categories",
    "Look up mileage rate categories (satskategorier) — vehicle types like personbil, elbil, firmabil, etc. " +
      "Search first to find the category ID, then use it when creating mileage allowances.",
    {
      type: z.string().optional().describe("Filter by type"),
      name: z
        .string()
        .optional()
        .describe("Search by name (contains), e.g. 'personbil'"),
      isValidDayTrip: z
        .boolean()
        .optional()
        .describe("Filter for day trip categories"),
      isValidDomestic: z
        .boolean()
        .optional()
        .describe("Filter for domestic categories"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/travelExpense/rateCategory",
          optionalParams({
            type: args.type,
            name: args.name,
            isValidDayTrip: args.isValidDayTrip,
            isValidDomestic: args.isValidDomestic,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "deliver_travel_expense",
    "Submit (deliver) travel expense reports for approval. " +
      "Changes state from OPEN to DELIVERED. " +
      "The report should be complete with at least one mileage allowance or cost entry.",
    {
      ids: z
        .string()
        .describe(
          "Comma-separated list of travel expense IDs to deliver"
        ),
    },
    async ({ ids }) =>
      run(() =>
        client.put("/travelExpense/:deliver", {}, optionalParams({ id: ids }))
      )
  );

  server.tool(
    "approve_travel_expense",
    "Approve delivered travel expense reports. " +
      "Requires approval rights. Changes state from DELIVERED to APPROVED.",
    {
      ids: z
        .string()
        .describe(
          "Comma-separated list of travel expense IDs to approve"
        ),
    },
    async ({ ids }) =>
      run(() =>
        client.put("/travelExpense/:approve", {}, optionalParams({ id: ids }))
      )
  );

  server.tool(
    "create_travel_expense_cost",
    "Add a cost entry (utlegg/kostnad) to a travel expense report. " +
      "Use for parking, tolls, or other travel-related costs. " +
      "Use search_travel_expense_cost_categories and search_travel_expense_payment_types to find IDs.",
    {
      travelExpenseId: z
        .number()
        .describe("ID of the parent travel expense report"),
      date: z.string().describe("Date of the cost (YYYY-MM-DD)"),
      costCategoryId: z
        .number()
        .describe(
          "Cost category ID (from search_travel_expense_cost_categories)"
        ),
      paymentTypeId: z
        .number()
        .describe(
          "Payment type ID (from search_travel_expense_payment_types)"
        ),
      amount: z.number().describe("Cost amount in NOK"),
      comment: z.string().optional().describe("Description of the cost"),
      vatTypeId: z
        .number()
        .optional()
        .describe("VAT type ID if applicable"),
      isChargeable: z
        .boolean()
        .optional()
        .describe("Whether this cost is billable to a project"),
    },
    async (args) =>
      run(() => {
        const body: Record<string, unknown> = {
          travelExpense: { id: args.travelExpenseId },
          date: args.date,
          costCategory: { id: args.costCategoryId },
          paymentType: { id: args.paymentTypeId },
          amount: args.amount,
        };
        if (args.comment !== undefined) body.comment = args.comment;
        if (args.vatTypeId !== undefined)
          body.vatType = { id: args.vatTypeId };
        if (args.isChargeable !== undefined)
          body.isChargeable = args.isChargeable;
        return client.post("/travelExpense/cost", body);
      })
  );

  server.tool(
    "search_travel_expense_cost_categories",
    "Look up available cost categories for travel expenses — e.g. parking, tolls, meals, taxi, flights.",
    {
      description: z
        .string()
        .optional()
        .describe("Search by description (contains)"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/travelExpense/costCategory",
          optionalParams({
            description: args.description,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  server.tool(
    "search_travel_expense_payment_types",
    "Look up payment types for travel expense costs — e.g. 'Privat utlegg' (reimbursed on salary), 'Firmakort' (company card).",
    {
      description: z
        .string()
        .optional()
        .describe("Search by description (contains)"),
      from: z.number().optional(),
      count: z.number().optional(),
    },
    async (args) =>
      run(() =>
        client.get(
          "/travelExpense/paymentType",
          optionalParams({
            description: args.description,
            from: args.from,
            count: args.count ?? 50,
          })
        )
      )
  );

  // ==================== UTILITY ====================

  server.tool(
    "whoami",
    "Get current session info: logged-in user, company name, company ID, and modules enabled.",
    {},
    async () => run(() => client.get("/token/session/>whoAmI"))
  );

  // ==================== SKILLS ====================

  registerSkills(server);
}
