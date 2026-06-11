# @tam-rank/mcp-server

> **The SEO plugin built for agents, not adapted from a generic CMS bridge.**  
> Connect Claude, Cursor, and other AI agents directly to your WordPress site — read issues, fix meta titles, create redirects, and roll back changes, all from a single chat message.

[![npm version](https://img.shields.io/npm/v/@tam-rank/mcp-server)](https://www.npmjs.com/package/@tam-rank/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Stable release: August 31, 2026](https://img.shields.io/badge/stable-August%2031%2C%202026-blue)](https://tamrank.com/agents)

> **Developer preview.** Stable V1.1 releases August 31, 2026.  
> [Join the early access waitlist](https://tamrank.com/agents) · [TamRank PRO](https://tamrank.com/pricing)

---

## What this is

TamRank is a WordPress SEO plugin. This package is its [Model Context Protocol](https://modelcontextprotocol.io) server — a bridge that lets AI agents (Claude Desktop, Cursor, Claude Code) talk directly to TamRank's REST API on your WordPress site.

Instead of opening your WordPress dashboard to find and fix SEO issues, you tell Claude:

> *"Fix the top 10 SEO issues on my site."*

Claude reads your site health, prioritizes fixes, proposes changes, and — after your approval — applies them. Every action is logged. Everything is reversible.

TamRank is purpose-built for agent workflows: structured improvement schema, dry-run by default, scoped PAT auth with full audit trail, and a strategy layer that tells Claude *what to fix first and why* — not just a list of CRUD endpoints.

---

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌────────────────┐
│   MCP Client    │◄────────│   MCP Server     │◄────────│  TamRank       │
│  (Claude        │ JSON-RPC│  (@tam-rank/     │  REST   │  (WordPress    │
│   Desktop,      │  over   │   mcp-server)    │  HTTP   │   plugin       │
│   Cursor,       │  stdio  │                  │         │   + VPS API)   │
│   Claude Code)  │         │                  │         │                │
└─────────────────┘         └──────────────────┘         └────────────────┘
```

The MCP server runs as a local process on your machine (`stdio` transport). Your AI client spawns it on startup, then calls tools on your behalf. Your WordPress credentials never leave your machine.

---

## Quick start

**Requires:** TamRank PRO · Node.js 18+

**1. Generate a Personal Access Token**

Log in at [tamrank.com/account/agent-tokens](https://tamrank.com/account/agent-tokens), create a token with the scopes you need, and copy it.

**2. Add to Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "tamrank": {
      "command": "npx",
      "args": ["-y", "@tam-rank/mcp-server"],
      "env": {
        "TAMRANK_PAT": "tamrank_pat_xxxxxxxxxxxx",
        "TAMRANK_SITE_URL": "https://your-site.com"
      }
    }
  }
}
```

**3. Restart Claude Desktop and say:**

> *"What are the top SEO issues on my site?"*

Setup time: under 5 minutes.

### Multiple sites

Each server instance talks to one site. To manage several sites, add one entry
per site to your MCP config — each with its own token and URL. This is the same
pattern the GitHub, Slack, and Postgres MCP servers use for multiple targets:

```json
{
  "mcpServers": {
    "tamrank-blog": {
      "command": "npx",
      "args": ["-y", "@tam-rank/mcp-server"],
      "env": {
        "TAMRANK_PAT": "tamrank_pat_AAA",
        "TAMRANK_SITE_URL": "https://blog.example.com"
      }
    },
    "tamrank-shop": {
      "command": "npx",
      "args": ["-y", "@tam-rank/mcp-server"],
      "env": {
        "TAMRANK_PAT": "tamrank_pat_BBB",
        "TAMRANK_SITE_URL": "https://shop.example.com"
      }
    }
  }
}
```

Each site appears as its own set of tools — ask Claude to *"fix the meta on the
blog"* and it uses that site's tools. Managing many client sites from a single
entry — one tool set with in-chat site switching backed by your OS keychain — is
on the [V2 agency roadmap](#roadmap).

---

## Available tools (V1.1)

| Tool | What it does | Scope required |
|---|---|---|
| `get_site_context` | Brand, language, site type — Claude knows your site before it acts | `site:read` |
| `get_capabilities` | Check tier + available credits | `site:read` |
| `get_site_overview` | All pages, posts, products with SEO status | `site:read` |
| `get_site_health` | Priority issues ranked by impact | `site:read` |
| `get_priority_actions` | "What should I fix first?" — filtered by focus area | `site:read` |
| `get_next_action` | The ONE highest-impact action right now — top priority card with a resolved target and the tool that fixes it | `site:read` |
| `get_issues` | Site-wide issue roll-up — one row per problem type (severity, count, impact, examples, drill-down tool), filterable by severity/type | `site:read` |
| `search_posts` | Search/filter the managed pages — title/slug match, score range, missing meta, never-audited (worst-first sort) | `site:read` |
| `get_meta` | Current SEO meta + score breakdown of one post (use before update_meta) | `site:read` |
| `get_page_analysis` | Deep per-page audit: score breakdown (meta vs content, live + stale flag) + every content check with fix tips and evidence + a cached PageSpeed signal | `site:read` |
| `get_site_analysis` | Deep pass across the lowest-scoring pages in one call | `site:read` |
| `get_schema` | One page's Schema.org markup: effective type, source, confidence, validity + third-party conflict warning and a fix hint | `site:read` |
| `get_schema_overview` | Site-wide schema coverage: % covered, type distribution, disabled/template/manual counts | `site:read` |
| `get_schema_settings` | Site-wide Organization/WebSite schema identity (name, logo, contact, address, socials) + completeness | `site:read` |
| `get_topical_authority` | Topical-authority map: pillar, clusters, coverage %, content gaps | `site:read` |
| `get_pagespeed` | PageSpeed for one page — score + Core Web Vitals + opportunities (cached; refresh=true for a live test) | `site:read` |
| `get_pagespeed_scan_status` | Progress of a background bulk PageSpeed scan | `site:read` |
| `get_gsc_pages` | Search Console page performance (clicks, impressions, CTR, position) | `site:read` |
| `get_gsc_keywords` | Per-page keyword performance + click-uplift potential | `site:read` |
| `get_keyword_stability` | Per-keyword position stability + direction trend | `site:read` |
| `get_index_status` | Google index status of one page from the last index scan (cached, credit-free) | `site:read` |
| `get_site_index` | Site-wide index coverage rollup: counts per status, scan progress, refresh cooldown | `site:read` |
| `get_images_missing_alt` | Images without alt text, returned so the model can see and caption them (credit-free) | `site:read` |
| `get_redirects` | List existing redirects with chain status | `site:read` |
| `get_redirect_chains` | Redirect chains (A→B→C) and loops computed live, each with a ready-made flatten fix | `site:read` |
| `get_404s` | Open 404s grouped by URL, ranked by hits | `site:read` |
| `request_recrawl` | Ask Google to (re)crawl one page via the TamRank backend (dry-run first; consumes AI credits) | `index:write` |
| `start_index_scan` | Site-wide index scan of unchecked + stale pages (dry-run first; consumes AI credits; shares the dashboard's 48h cooldown) | `index:write` |
| `get_index_scan_status` | Live-poll a running index scan (metered); passive and free when idle | `index:write` |
| `update_meta` | Write meta title and description to any post (response shows the projected new score) | `meta:write` |
| `update_image_alt` | Write alt text to an image attachment | `meta:write` |
| `update_schema_settings` | Write the site-wide Organization/WebSite schema identity (name, logo, contact, address, socials); dry-run first, reversible | `schema:write` |
| `rescore_page` | Persist a fresh audit so the stored/dashboard score catches up — the verify step after a fix | `meta:write` |
| `start_pagespeed_scan` | Queue a background bulk PageSpeed scan across the site (poll get_pagespeed_scan_status) | `meta:write` |
| `manage_redirects` | Create, update, or delete 301/302 redirects | `redirects:write` |
| `resolve_404` | Mark a 404 as resolved (with optional redirect) | `redirects:write` |
| `get_audit_log` | Full history of agent-applied changes | `audit:read` |
| `get_changes` | Incremental "what changed since X" feed (manual + agent), cursor-driven | `audit:read` |
| `rollback` | Undo any logged action by event ID | `rollback` |

All write tools default to **dry-run mode** — Claude shows you exactly what it will change before touching anything.

---

## Authentication

TamRank uses a Personal Access Token (PAT) system — not WordPress application passwords, not your license key directly.

Each token:
- Has a named scope (e.g. `meta:write` only, or `*:read` for dashboards)
- Is bound to a specific site or all sites on your license
- Generates a full audit trail
- Can be revoked instantly from [tamrank.com/account/agent-tokens](https://tamrank.com/account/agent-tokens)
- Is automatically invalidated if your license expires or is refunded

Token prefix: `tamrank_pat_` — detectable by GitGuardian and Trufflehog. **Do not commit tokens to version control.**

---

## Roadmap

| Release | What |
|---|---|
| **V1.1 — August 31, 2026** | Stable npm package · full read/write tool set · PAT auth · Claude Desktop + Cursor |
| **V1.2 — September 22, 2026** | Hosted connector (`https://mcp.tamrank.com`) · OAuth flow · Custom connector URL for Claude.ai web |
| **V1.3 — Q4 2026** | Anthropic Directory listing · ChatGPT Custom GPT · Apps in ChatGPT |
| **V2 — Q1 2027** | Agency multi-tenant · 50+ client sites · white-label |

---

## License

MIT — the MCP server package itself is open source.  
TamRank PRO license required to use it against a live site. [See pricing.](https://tamrank.com/pricing)

---

## Links

- [tamrank.com](https://tamrank.com) — plugin homepage
- [tamrank.com/agents](https://tamrank.com/agents) — setup guide + demo video
- [tamrank.com/pricing](https://tamrank.com/pricing) — PRO license
