import { SkillDefinition } from "./types.js";

export const travelExpenseSkill: SkillDefinition = {
  id: "travel-expense",
  title: "Reiseregning & Kjøregodtgjørelse",
  description: "Guide for registering travel expenses and mileage allowances via Tripletex native endpoints",
  triggers: ["reiseregning", "travel expense", "diett", "per diem", "reise", "kjøregodtgjørelse", "mileage", "kjøring", "bilgodtgjørelse"],
  requiredTools: ["create_travel_expense", "create_mileage_allowance", "search_mileage_rate_categories", "search_travel_expenses", "deliver_travel_expense", "create_travel_expense_cost"],
  buildMessages: () => [
    {
      role: "assistant" as const,
      content: {
        type: "text" as const,
        text: `## Skill: Reiseregning & Kjøregodtgjørelse (Travel Expense & Mileage Allowance)

### Norwegian Mileage & Travel Rules
**Mileage allowance (kjøregodtgjørelse):**
- Private car used for business: rate determined by Tripletex rate categories (personbil, elbil, etc.)
- Tax-free up to Skatteetaten limits
- Passengers and toll costs can be added as supplements

**Per diem (diett) — out of scope for this flow, use manual voucher posting**

### Steps — Simple Mileage Registration

**Step 1 — Identify the employee**
Call \`whoami\` to get the current user's employee ID, or \`search_employees\` if registering for someone else.

**Step 2 — Look up rate categories**
Call \`search_mileage_rate_categories\` to find the correct rate category for the vehicle type:
- Search by name, e.g. "personbil", "elbil", "firmabil"
- Note the category ID for use in step 4

**Step 3 — Create the travel expense report**
Call \`create_travel_expense\` with:
- employeeId: from step 1
- title: descriptive name, e.g. "Kjøring april 2026" or "Reise Oslo-Drammen 14. april"
- projectId/departmentId: if the trip is linked to a project or department

This creates a draft report (isCompleted=false). The report is a container for mileage entries and costs.

**Step 4 — Add mileage entries**
Call \`create_mileage_allowance\` for each drive:
- travelExpenseId: the ID from step 3
- date: date of driving (YYYY-MM-DD)
- departureLocation: e.g. "Oslo"
- destination: e.g. "Drammen"
- km: kilometers driven
- rateCategoryId: from step 2
- isCompanyCar: true if using firmabil (no payout)
- tollCost: bompenger amount if applicable
- passengerSupplement: passasjertillegg if applicable

Tripletex auto-calculates the amount based on km × rate.

For round trips, create two entries (outbound + return) or one entry with total km.

**Step 5 — Add extra costs (optional)**
If there are additional costs like parking or tolls not covered by mileage:
1. Call \`search_travel_expense_cost_categories\` to find the cost category (e.g. "parkering", "bompenger")
2. Call \`search_travel_expense_payment_types\` to find the payment type (e.g. "Privat utlegg")
3. Call \`create_travel_expense_cost\` with travelExpenseId, date, costCategoryId, paymentTypeId, amount, comment

**Step 6 — Report to user**
Summarize: total km, rate per km, total mileage amount, any extra costs, grand total.
Ask if the user wants to deliver the report for approval.

**Step 7 — Deliver for approval (optional)**
Call \`deliver_travel_expense\` with the travel expense ID.
This changes the state from OPEN to DELIVERED.

### Multiple Drives in One Report
For users who drive frequently, create one travel expense report per period (week/month) and add multiple mileage entries to it.

### Searching Existing Reports
- \`search_travel_expenses\` — find reports by employee, date range, state
- \`search_mileage_allowances\` — find specific mileage entries by route or date
- \`get_travel_expense\` — get full details including all mileage and cost rows

### Common Vehicle Types
Always use \`search_mileage_rate_categories\` to get the actual ID — never hardcode. Common categories:
- Personbil (private car)
- Elbil (electric car)
- Firmabil (company car — no payout)

### Validation Checklist
- [ ] Employee ID verified via whoami or search_employees
- [ ] Rate category looked up (never hardcode rate IDs)
- [ ] Travel expense created as draft (isCompleted=false)
- [ ] Each drive has date, departure, destination, and km
- [ ] Toll and parking costs added separately if applicable
- [ ] Summary shown to user before delivering`,
      },
    },
  ],
};
