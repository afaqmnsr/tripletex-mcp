# Tripletex MCP Server

En open source [MCP-server](https://modelcontextprotocol.io/) som lar AI-assistenter (Claude, Cursor, osv.) jobbe direkte mot Tripletex sitt regnskapssystem.
Se hvordan du installerer repo og kobler på under.

**Foretrekker du en ferdigkonfigurert MCP-løsning?** Prøv: [Regnskapsagent.no](https://regnskapsagent.no/)

Bygd og vedlikeholdt av [CWV Ventures AS](https://cwv.no).

## Trenger du hjelp til implementering?
Kontakt meg på carl@cwv.no.

## Hva kan den gjøre?

**56 MCP-verktøy** (per **v2.4.0**, synket med [Regnskapsagent](https://regnskapsagent.no)-MCP).

| Kategori | Verktøy | Beskrivelse |
|---|---|---|
| **Ordrer & utgående faktura** | `search_orders` | Søk ordrer (åpne/lukkede, abonnement m.m.) |
| | `get_order` | Hent én ordre |
| | `create_order` | Opprett ordre |
| | `invoice_order` | Fakturer ordre |
| | `create_invoice` | Ordre + faktura i ett steg |
| | `search_invoices` | Søk utgående fakturaer (datointervall) |
| | `get_invoice` | Hent én faktura |
| **Leverandørfaktura** | `search_supplier_invoices` | Søk registrerte leverandørfakturaer |
| | `get_supplier_invoice` | Hent én leverandørfaktura |
| | `get_supplier_invoices_for_approval` | Liste til godkjenning |
| | `approve_supplier_invoice` | Godkjenn |
| | `reject_supplier_invoice` | Avvis |
| | `update_supplier_invoice_postings` | Oppdater posteringer på leverandørbilag |
| | `create_supplier_invoice` | Opprett leverandørbilag til bilagsmottak (`POST /ledger/voucher`, m.fl.) |
| **Kunder & leverandører** | `search_customers` | Søk kunder |
| | `create_customer` | Opprett kunde |
| | `update_customer` | Oppdater kunde |
| | `search_suppliers` | Søk leverandører |
| | `create_supplier` | Opprett leverandør |
| | `get_supplier` | Hent leverandør |
| | `update_supplier` | Oppdater leverandør |
| **Produkter** | `search_products` | Søk produkter |
| | `create_product` | Opprett produkt |
| **Prosjekt & time** | `search_projects` | Søk prosjekter |
| | `search_activities` | Søk aktiviteter |
| | `search_time_entries` | Søk timeføringer |
| | `create_time_entry` | Logg timer |
| | `create_project` | Opprett prosjekt |
| | `create_department` | Opprett avdeling |
| **HR** | `create_employee` | Opprett ansatt |
| **Bilag & hovedbok** | `search_accounts` | Søk kontoplan |
| | `search_vat_types` | MVA-typer |
| | `search_voucher_types` | Bilagstyper |
| | `search_vouchers` | Søk bilag |
| | `get_voucher` | Hent bilag |
| | `create_voucher` | Opprett bilag |
| | `send_voucher_to_ledger` | Send bilag til bokføring |
| | `attach_voucher_document` | Vedlegg dokument (Base64) til bilag |
| | `import_ledger_voucher_document` | Importer bilag fra fil |
| | `get_voucher_inbox_count` | Antall i bilagsmottak |
| | `search_ledger_postings` | Søk hovedboksposteringer |
| **Rapporter** | `get_balance_sheet` | Saldobalanse for periode |
| **Reise & kjøregodtgjørelse** | `search_travel_expenses` | Søk reiseregninger |
| | `get_travel_expense` | Hent reiseregning |
| | `create_travel_expense` | Opprett reiseregning |
| | `create_mileage_allowance` | Kjøregodtgjørelse |
| | `search_mileage_allowances` | Søk kjøregodtgjørelser |
| | `search_mileage_rates` | km-satser |
| | `search_mileage_rate_categories` | Satskategorier |
| | `deliver_travel_expense` | Lever til godkjenning |
| | `approve_travel_expense` | Godkjenn |
| | `create_travel_expense_cost` | Kostnad (parkering, bom, …) |
| | `search_travel_expense_cost_categories` | Kostnadskategorier |
| | `search_travel_expense_payment_types` | Betalingstyper |
| **Utility** | `whoami` | Sesjon / selskap |
| | `search_employees` | Søk ansatte |

## Kom i gang

### 1. Hent API-nøkler fra Tripletex

Du trenger to tokens:

- **Consumer token** — søk om produksjonstilgang via [developer.tripletex.no](https://developer.tripletex.no). Godkjenning tar typisk 2–3 uker. For testing kan du opprette en gratis testkonto med egne tokens.
- **Employee token** — opprettes i Tripletex under **Innstillinger → Integrasjoner → API-tilgang** av en bruker med admin-rettigheter.

### 2. Installer

```bash
git clone https://github.com/cwv-ventures/tripletex-mcp.git
cd tripletex-mcp
npm install
npm run build
```

### 3. Koble til Claude Desktop

Legg til følgende i Claude Desktop sin konfigurasjonsfil:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux:** `~/.config/claude-desktop/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tripletex": {
      "command": "node",
      "args": ["/absolutt/sti/til/tripletex-mcp/dist/index.js"],
      "env": {
        "TRIPLETEX_CONSUMER_TOKEN": "din-consumer-token",
        "TRIPLETEX_EMPLOYEE_TOKEN": "din-employee-token"
      }
    }
  }
}
```

### 4. Testmiljø

For å bruke Tripletex sitt testmiljø (`api-test.tripletex.tech`) istedenfor produksjon, legg til:

```json
"TRIPLETEX_ENV": "test"
```

i `env`-blokken.

## Hvordan autentisering fungerer

Serveren håndterer alt automatisk:

1. Ved første kall opprettes en session token via `PUT /v2/token/session/:create`
2. Session token fornyes automatisk når den utløper (midnatt CET)
3. Alle API-kall bruker Basic Auth med brukernavn `0` og session token som passord

Du trenger ikke tenke på dette — bare sett consumer og employee token som miljøvariabler.

## Eksempler på bruk

Når MCP-serveren er koblet til Claude, kan du si ting som:

> "Logg 7.5 timer på prosjekt Konsulentbistand i dag"

Claude finner prosjektet, velger riktig aktivitet, og oppretter timeoppføringen.

> "Vis alle fakturaer til Nordvik Bygg fra mars 2026"

Claude søker kunder, finner riktig ID, og henter fakturaene.

> "Opprett ny kunde Havbruk Nord AS med org.nr 912 345 678"

Claude oppretter kunden direkte i Tripletex.

> "Hvilke bilag ble ført forrige uke?"

Claude søker bilag med datofilter og viser en oversikt.

> "Registrer kjøring fra Oslo til Drammen i dag, 42 km, personbil"

Claude slår opp satskategori for personbil, oppretter en reiseregning, legger til kjøregodtgjørelse med riktig sats, og rapporterer totalbeløp.

> "Jeg kjørte til Ski i dag, 48 km. Hadde 85 kr i bompenger og 120 kr parkering"

Claude oppretter reiseregning med kjøregodtgjørelse pluss kostnadsrader for bompenger og parkering.

## Teknisk

- **Produktspesifikasjon (rebuild):** [docs/PRD-Tripletex-MCP-Rebuild.md](docs/PRD-Tripletex-MCP-Rebuild.md) beskriver mål-API, verktøy og felter mot Tripletex v2.
- **Verktøy:** `src/tripletex-tools.ts` — alle `server.tool(...)`-registreringer (delt oppsett med Regnskapsagent; der brukes `registerAllTools(server, client)`).
- **MCP skills (prompts):** `src/skills/` — regnskapsflyter som MCP prompts + ressursen `tripletex://skills`.
- **Runtime:** Node.js 18+
- **Språk:** TypeScript
- **Avhengigheter:** `@modelcontextprotocol/sdk`, `zod`
- **Transport:** stdio (standard MCP-protokoll)
- **API:** Tripletex REST API v2

## Bidra

Pull requests er velkomne! Åpne gjerne et issue hvis du har forslag til nye verktøy eller forbedringer.

## Lisens

MIT — se [LICENSE](LICENSE) for detaljer.
