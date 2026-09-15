# TamRank MCP — Einstieg auf der eigenen Testwebsite

TamRank hilft dabei, SEO-Aufgaben zu finden, die Belege zu prüfen und unterstützte
Änderungen nach deiner Zustimmung auszuführen. Beginne mit reinem Lesezugriff.

**Nutze diese Beta zuerst auf deiner eigenen Testwebsite. Aktiviere die
Schreibfunktionen auf Kundenwebsites nur nach einer gesonderten Release-Prüfung.** Diese Anleitung
ändert keine Einstellungen und erteilt der KI keine zusätzlichen Rechte. Die
Übersetzung ändert weder die Sprache der MCP-Antworten noch der WordPress-Oberfläche.

## 1. Voraussetzungen

- Eine eigene Testwebsite mit den zusammengehörigen FREE- und PRO-Betaversionen.
  Aktiviere in TamRank das sichere Workflow-Profil, wenn du das PAT erstellst.
- Einen MCP-Client, der ein lokales Programm über stdio starten kann, und Node.js.
  Getestete Versionen und Einschränkungen stehen in der [englischen Anleitung](README.md).
- Ein **websitegebundenes PAT**: ein Zugriffstoken aus TamRank
  **Settings → Integrations → AI Agents (MCP)** auf dieser Testwebsite. Beginne
  ausschließlich mit `site:read`. Ein Lizenzschlüssel ist kein PAT. Teile das
  Token nicht in Chats, Screenshots oder Tickets und speichere es nicht in git.

## 2. Eine separate Testverbindung einrichten

Verwende die fest angegebene Beta `@tam-rank/mcp-server` / `0.4.0-beta.1`.
`npx`, `npm start`, `tamrank-mcp`, `index-workflow.js` und der Kompatibilitätspfad
`index.js` starten denselben sicheren Workflow. Er meldet sich als
`tamrank-mcp` / `0.4.0-beta.1`.

Ersetze die Beispiel-URL und den Token-Platzhalter in den
lokalen Clienteinstellungen. Das Beispiel gilt für Clients mit `mcpServers`;
andere Clients verwenden denselben Befehl, dieselben Argumente und Umgebungsvariablen
in ihren eigenen Einstellungen. Die bestehende Verbindung bleibt separat erhalten.

```json
{
  "mcpServers": {
    "tamrank-test": {
      "command": "npx",
      "args": ["-y", "@tam-rank/mcp-server@0.4.0-beta.1"],
      "env": {
        "TAMRANK_SITE_URL": "https://test.example.com",
        "TAMRANK_PAT": "REPLACE_WITH_SITE_LOCAL_PAT",
        "TAMRANK_TOOL_PROFILE": "core"
      }
    }
  }
}
```

Das Profil `core` bietet 12
Toolnamen, `specialist` 20 und `legacy` 42. Ein sichtbarer Toolname ist keine
Ausführungsberechtigung. Auf alte Schreibfunktionen wird nicht zurückgegriffen.

## 3. Zuerst prüfen, ohne etwas zu ändern

Starte nur diese Testverbindung neu und frage:

> Prüfe, welche Website verbunden ist und welche Funktionen verfügbar sind.
> Zeige die drei wichtigsten bestehenden Aufgaben und getrennt davon die
> Signale, jeweils mit Belegen und Messzeitraum. Erstelle keine Aufgabe,
> starte keinen Scan und ändere nichts.

Erste Aufrufe: `get_site_context`, `get_capabilities`, `get_work_queue`, `get_signals`.

Prüfe, ob es die richtige Website ist. Bei Gruppen müssen alle Seiten über die
zurückgegebenen Cursor abgerufen werden; vier Vorschauzeilen sind nicht die gesamte Liste.

## 4. Erst danach: ein gesondert genehmigter Schreibtest

Nur wenn die betreffende Handlung auf der eigenen Testwebsite verfügbar ist
und die nötigen Rechte gesondert erteilt wurden:

1. Lass mit `plan_changes` einen Vorschlag erstellen. Prüfe **alle** Seiten,
   bisherigen und neuen Werte, Warnungen und erforderlichen Bestätigungen.
2. Stimme ausdrücklich im Chat zu. Ein gespeicherter Vorschlag ist noch keine
   Freigabe. `execute_change_set` darf nur diesen unveränderten Vorschlag
   ausführen. Jede Änderung am Vorschlag benötigt eine neue Zustimmung.
3. Prüfe mit `get_changes`, was tatsächlich ausgeführt wurde. Bei Zeitüberschreitung
   oder verlorener Antwort zuerst dieselbe Ausführung nachlesen; nicht automatisch
   erneut schreiben oder einen neuen Änderungssatz anlegen.
4. Rückgängigmachen beginnt mit einem neuen `rollback_change_set`-Vorschlag und
   **erneuter Zustimmung**. Spätere Änderungen oder fehlende Belege können die
   Wiederherstellung verhindern.

WordPress speichert eine Erklärung über die Chat-Zustimmung, nicht den Chatverlauf.
Es kann nicht unabhängig überprüfen, was du im Chat gesagt hast. Das Abhaken einer
Recherche erlaubt keine Seitenänderung und beweist keine SEO-Verbesserung.
Scans und die Wiederherstellung unterbrochener Ausführungen benötigen eigene
Zustimmungen; `get_scan_status` setzt nichts fort.

Die unterstützten Entwicklungsvorgänge betreffen Metadaten, Social-Media-Felder,
Alt-Texte, Weiterleitungen und begrenzte Vorgänge im bestehenden TamRank-Schemasystem.
Keine Änderungen an Seiteninhalten oder Pagebuildern, keine automatischen internen
Links, kein beliebiges JSON-LD und keine neuen Schemavorlagen. Nicht alles ist rückgängig zu machen.
Die Messung des SEO-Ergebnisses gehört zu Phase 5.

## Wenn die Verbindung nicht funktioniert

- **Falsche Website oder Weiterleitung:** Verwende die endgültige Website-URL.
  TamRank gibt das PAT nicht über Weiterleitungen weiter.
- **Kein Zugriff:** Prüfe Token, lokale Benutzerzugehörigkeit und Rechte.
  Erweitere die Rechte nicht bloß, um eine Fehlermeldung zu beseitigen.
- **Funktion nicht verfügbar:** Lass die passenden Entwicklungsversionen und
  serverseitigen Funktionen prüfen. Der Vorschaumodus ist keine Umgehung.
- **TLS-Fehler:** Repariere das Zertifikatsvertrauen; deaktiviere die TLS-Prüfung
  nicht. HTTPS ist erforderlich. Nur die wörtlichen Testhosts `localhost`,
  `127.0.0.1` und `[::1]` dürfen HTTP verwenden, ein `.local`-Name nicht.
- **REST-Route nicht gefunden:** Prüfe den Websitepfad. Verwende
  `TAMRANK_REST_STYLE=query` nur, wenn diese Website die Query-Form benötigt.
- **Limit erreicht:** Halte die angegebene Wartezeit ein. Keine automatische
  Wiederholungsschleife und kein neues Token zur Umgehung des Limits.

## Mehrere Kundenwebsites

Verwende später pro Website einen eigenen Verbindungsnamen, die genaue URL und
ein eigenes PAT. Prüfe die Zielwebsite vor jedem Vorschlag. Zustimmung für Kunde A
gilt nicht für Kunde B. Ein zentraler Websitewechsel, Portfolio-Überblick oder eine
gemeinsame Freigabe für mehrere Kunden ist damit nicht implementiert. Die
Aktivierung auf Kundenwebsites bleibt ein separater Schritt.

Die [englische Anleitung](README.md) enthält alle Tool- und Transporteinstellungen.
Interne Entwicklungsnachweise sind bewusst nicht im Kundenpaket enthalten; ein
bestandener Test beweist nicht, dass jede Hostingumgebung bereit ist.
