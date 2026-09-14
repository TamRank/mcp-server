# TamRank MCP — beginnen op je eigen testsite

TamRank helpt je SEO-taken te vinden, het bewijs te bekijken en na jouw akkoord
ondersteunde wijzigingen uit te voeren. Je begint met alleen lezen.

**Dit is een ontwikkelpreview van fase 4, geen npm-release. Activeer deze
schrijffuncties nog niet op klantwebsites.** Deze gids verandert geen instellingen
en verleent de AI geen extra rechten. De vertaling verandert ook niet de taal
van de MCP-antwoorden of de WordPress-interface.

## 1. Wat je nodig hebt

- Een eigen testsite met de bijpassende FREE- en PRO-ontwikkelversies,
  ingerichte opslag en expliciet ingeschakelde leesondersteuning. De gewone
  bèta is niet automatisch klaar voor deze workflow. Laat de ontwikkelaar de
  testsite voorbereiden; kopieer geen lijst ontwikkelinstellingen naar klanten.
- Een gecontroleerde kopie van `TamRank/mcp-server`, branch `feat/mcp-workflows`,
  in een vaste lokale map. Voer daar `npm ci --ignore-scripts` uit om de vastgelegde
  dependencies te installeren. Dit publiceert of activeert niets.
- Een MCP-client die een lokaal programma via stdio kan starten, en Node.js.
  Zie de [Engelse gids](README.md) voor de geteste versies en de grenzen daarvan.
- Een **sitegebonden PAT**: een toegangstoken aangemaakt bij TamRank
  **Settings → Integrations → AI Agents (MCP)** op die testsite. Begin met alleen
  `site:read`. Gebruik geen licentiesleutel. Deel het token niet in chat,
  screenshots of tickets en zet het niet in git.

## 2. Maak een aparte testverbinding

Gebruik `index-workflow.js`. `index.js`, `npm start` en `tamrank-mcp` starten nog
de oudere ingang. Ook `npx @tam-rank/mcp-server` haalt deze branch niet op.
Het pakket blijft `@tam-rank/mcp-server` / `0.3.0-preview`; de workflow meldt zich
als `tamrank-workflow-preview` / `0.4.0-preview`.

Vervang beide absolute paden, de voorbeeld-URL en de tokenplaceholder in je
lokale clientinstellingen. Dit voorbeeld is voor clients met `mcpServers`;
andere clients gebruiken dezelfde opdracht, argumenten en omgevingsvariabelen
in hun eigen instellingen. Je bestaande verbinding blijft apart bestaan.

```json
{
  "mcpServers": {
    "tamrank-test": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mcp-server/index-workflow.js"],
      "env": {
        "TAMRANK_SITE_URL": "https://test.example.com",
        "TAMRANK_PAT": "REPLACE_WITH_SITE_LOCAL_PAT",
        "TAMRANK_TOOL_PROFILE": "core",
        "TAMRANK_WORKFLOW_PREVIEW": "1"
      }
    }
  }
}
```

`TAMRANK_WORKFLOW_PREVIEW` kiest de ontwikkelcompatibiliteit; het omzeilt geen
rechten of WordPress-beveiliging. Het profiel `core` biedt 12 toolnamen,
`specialist` 20 en `legacy` 42. Een zichtbare toolnaam betekent niet dat je die
handeling mag uitvoeren. Oude schrijvers worden niet als terugval gebruikt.

## 3. Controleer eerst zonder iets te wijzigen

Herstart alleen deze testverbinding en vraag:

> Controleer welke website dit is en wat beschikbaar is. Toon de drie
> belangrijkste bestaande taken en daarnaast de signalen, met het bewijs en
> de meetperiode. Maak geen taak aan, start geen scan en wijzig niets.

Eerste aanroepen: `get_site_context`, `get_capabilities`, `get_work_queue`, `get_signals`.

Controleer of de website klopt. Laat bij groepen alle pagina's ophalen via de
teruggegeven cursors; vier voorbeeldregels zijn niet de volledige lijst.

## 4. Pas daarna: een afzonderlijk goedgekeurde schrijftest

Alleen als die specifieke handeling op de eigen testsite beschikbaar is én de
benodigde rechten apart zijn toegekend:

1. Laat de AI met `plan_changes` een voorstel maken. Bekijk **alle** pagina's,
   oude en nieuwe waarden, waarschuwingen en vereiste bevestigingen.
2. Geef expliciet akkoord in de chat. Een opgeslagen voorstel is nog geen
   toestemming. `execute_change_set` mag alleen dat ongewijzigde voorstel
   uitvoeren. Verandert het voorstel, dan is nieuw akkoord nodig.
3. Controleer met `get_changes` wat werkelijk is uitgevoerd. Bij een timeout
   of verloren antwoord: eerst dezelfde uitvoering nalezen, niet automatisch
   opnieuw schrijven of een nieuwe wijzigingsset maken.
4. Terugdraaien begint met een nieuw `rollback_change_set`-voorstel en **nieuw
   akkoord**. Latere wijzigingen of ontbrekend bewijs kunnen herstel blokkeren.

WordPress bewaart een verklaring dat er chatakkoord was, niet het chatgesprek.
Het kan niet zelfstandig controleren wat jij in de chat hebt gezegd.
Onderzoek afvinken is geen toestemming voor paginawijzigingen en geen bewijs
van SEO-herstel. Scans en herstel van onderbroken uitvoeringen vragen apart
toestemming; `get_scan_status` hervat niets.

De ondersteunde ontwikkelhandelingen betreffen metadata, sociale velden,
alt-tekst, redirects en beperkte handelingen binnen TamRanks bestaande schema.
Geen wijzigingen aan paginatekst/pagebuilders, automatische interne links,
willekeurige JSON-LD of nieuwe schematemplates. Niet alles kan worden teruggedraaid.
Meten van het SEO-resultaat hoort bij fase 5.

## Als verbinden niet lukt

- **Verkeerde website of doorverwijzing:** gebruik de definitieve site-URL.
  TamRank stuurt je PAT niet door via redirects.
- **Geen toegang:** controleer token, lokale gebruiker en rechten. Geef niet
  zomaar meer rechten om een foutmelding weg te krijgen.
- **Functie niet beschikbaar:** laat de passende ontwikkelversies en server-
  ondersteuning controleren; previewmodus is geen omweg.
- **TLS-fout:** herstel het vertrouwen in het certificaat; schakel TLS-controle
  niet uit. HTTPS is vereist. Alleen de letterlijke testhosts `localhost`,
  `127.0.0.1` en `[::1]` mogen HTTP gebruiken; een `.local`-naam niet.
- **REST-route niet gevonden:** controleer het sitepad. Gebruik
  `TAMRANK_REST_STYLE=query` alleen als die site de queryvorm nodig heeft.
- **Limiet bereikt:** respecteer de aangegeven wachttijd; geen automatische
  herhaallus of nieuw token om de limiet te omzeilen.

## Meerdere klantsites

Gebruik later per site een aparte verbindingsnaam, exacte URL en eigen PAT.
Controleer de doelwebsite vóór ieder voorstel. Toestemming voor klant A geldt
niet voor klant B. Eén centrale sitewisselaar, portfolio-overzicht of gezamenlijk
akkoord voor meerdere klanten is hiermee niet gebouwd. Klantactivering blijft apart.

De [Engelse gids](README.md) bevat de volledige tool- en transportinstellingen.
[WORKFLOW-PREVIEW.md](WORKFLOW-PREVIEW.md) beschrijft de implementatie en tests;
een geslaagde test is geen bewijs dat fase 4 of iedere hostingomgeving klaar is.
