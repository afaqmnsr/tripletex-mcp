# Tripletex MCP Server

En open source [MCP-server](https://modelcontextprotocol.io/) som lar AI-assistenter (Claude, Cursor, osv.) jobbe direkte mot Tripletex sitt regnskapssystem.
Se hvordan du installerer repo og kobler på under.

**Foretrekker du en ferdigkonfigurert MCP-løsning?** Prøv: [Regnskapsagent.no](https://regnskapsagent.no/)

Bygd og vedlikeholdt av [CWV Ventures AS](https://cwv.no).

## Trenger du hjelp til implementering?
Kontakt meg på carl@cwv.no.

## Hva kan den gjøre?

| Kategori | Verktøy | Beskrivelse |
|---|---|---|
| **Timeføring** | `search_projects` | Søk etter prosjekter |
| | `search_activities` | Søk etter aktiviteter |
| | `search_time_entries` | Hent timeoppføringer for en periode |
| | `create_time_entry` | Logg timer (krever `employeeId` + prosjekt/aktivitet) |
| **Faktura** | `create_order` | Opprett ordre med Tripletex-felt (`orderLines`, `count`, priser) |
| | `invoice_order` | Fakturer eksisterende ordre |
| | `create_invoice` | Ordre + faktura i ett steg |
| | `search_invoices` | Søk utgående fakturaer (påkrevd datointervall) |
| | `get_invoice` | Hent én faktura (valgfri `fields`) |
| | `search_supplier_invoices` | Søk leverandørfakturaer (påkrevd datointervall) |
| **Kunder & leverandører** | `search_customers` | Søk kunder |
| | `create_customer` | Opprett kunde |
| | `update_customer` | Oppdater kunde |
| | `search_suppliers` | Søk leverandører |
| | `create_supplier` | Opprett leverandør |
| **Produkter** | `search_products` | Søk produkter |
| | `create_product` | Opprett produkt |
| **Regnskap** | `search_accounts` | Søk i kontoplan |
| | `search_vat_types` | Liste MVA-typer |
| | `search_vouchers` | Søk bilag |
| | `get_voucher` | Hent bilag |
| | `create_voucher` | Opprett bilag (`amountGross` per linje) |
| | `search_ledger_postings` | Søk hovedboksposteringer (konto, periode, kunde, prosjekt, …) |
| | `search_bank_reconciliations` | Søk bankavstemminger |
| | `get_income_statement` | Resultat/resultatbudsjett selskap per **år** (`/resultbudget/company`) |
| | `get_balance_sheet` | Saldobalanse for periode |
| **Utility** | `whoami` | Info om innlogget bruker/selskap |
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

## Teknisk

- **Produktspesifikasjon (rebuild):** [docs/PRD-Tripletex-MCP-Rebuild.md](docs/PRD-Tripletex-MCP-Rebuild.md) beskriver mål-API, verktøy og felter mot Tripletex v2.
- **Runtime:** Node.js 18+
- **Språk:** TypeScript
- **Avhengigheter:** Kun `@modelcontextprotocol/sdk`
- **Transport:** stdio (standard MCP-protokoll)
- **API:** Tripletex REST API v2

## Bidra

Pull requests er velkomne! Åpne gjerne et issue hvis du har forslag til nye verktøy eller forbedringer.

## Lisens

MIT — se [LICENSE](LICENSE) for detaljer.
