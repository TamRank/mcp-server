/**
 * TamRank MCP tool surface (V1.1).
 *
 * Maps the 10 headline tools (+ a few supporting reads that make the write tools
 * usable) onto the TamRank Agent-API REST endpoints. Every write tool defaults to
 * dry-run: call it once to get a diff + change_token, then call again with
 * execute=true and that change_token to apply. The discipline is enforced
 * server-side; this layer only forwards and formats.
 */

import { z } from 'zod';
import { ApiError, splitWriteArgs } from './rest.js';

const REDIRECT_TYPES = ['301', '302', '307', '410'];

/** Per-status guidance appended to an error so the agent knows what to do. */
const HINTS = {
  401: 'Authentication failed. Check the TAMRANK_PAT environment variable.',
  402: 'This site is not on TamRank PRO. The agent API requires an active PRO licence — see https://tamrank.com/pricing.',
  403: 'The token lacks the scope this tool needs. Mint a token with the required scope at tamrank.com/account/agent-tokens.',
  404: 'The target was not found.',
  409: 'Conflict. For a write this usually means the change_token did not match — re-run the dry run and use the change_token it returns.',
  422: 'The change is not valid (for example, a redirect that would create a loop).',
  429: 'Rate limited. Wait for the window to reset before retrying.',
};

/** A 402 can also mean depleted AI credits (index actions) — different advice. */
const CREDITS_HINT = 'The site\'s AI credits are depleted — they reset monthly. Check the error details (balance.resets_at) or get_capabilities for the reset date; the TamRank backend remains the final authority.';

function isInsufficientCredits(err) {
  return err.code === 'insufficient_credits'
    || (err.data && err.data.backend_code === 'insufficient_credits');
}

/** Build a successful tool result from arbitrary JSON. */
function ok(data, prefix) {
  const body = JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text: prefix ? `${prefix}\n\n${body}` : body }] };
}

/**
 * Like ok(), but if the payload carries a `visual` block (a base64 PNG score
 * gauge/donut from the plugin), surface it as an inline MCP image block and strip
 * the base64 out of the text so it is not dumped as a giant string.
 */
function okWithVisual(data, prefix) {
  const visual = data && data.visual && data.visual.base64 ? data.visual : null;
  const jsonForText = visual
    ? { ...data, visual: { ...data.visual, base64: undefined, rendered_inline: true } }
    : data;
  const body = JSON.stringify(jsonForText, null, 2);
  const content = [{ type: 'text', text: prefix ? `${prefix}\n\n${body}` : body }];
  if (visual) {
    content.push({ type: 'image', data: visual.base64, mimeType: visual.mime || 'image/png' });
  }
  return { content };
}

/** Build an error tool result from an ApiError (or any error). */
function fail(err) {
  if (err instanceof ApiError) {
    const hint = isInsufficientCredits(err) ? CREDITS_HINT : HINTS[err.status];
    const lines = [`Error ${err.status || ''} ${err.code}: ${err.message}`.trim()];
    if (hint) lines.push(hint);
    if (err.data && Object.keys(err.data).length) lines.push('Details: ' + JSON.stringify(err.data));
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
  }
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}

/** Format a write result, prefixing a clear hint when it is a dry run. */
function writeResult(data) {
  if (data && data.mode === 'dry_run') {
    return ok(data, 'DRY RUN — nothing was written. Review the diff, then call this tool again with execute=true and the change_token below.');
  }
  if (data && data.mode === 'noop') {
    return ok(data, 'No change — the values already match.');
  }
  return ok(data, 'Applied.');
}

/** Largest image we will inline as MCP image-content (base64 bloats ~33%). */
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Fetch an image URL and return it as an MCP image-content block so a vision model
 * can see it. Returns null on any failure (unreachable, non-image, too large) — the
 * caller keeps the text entry so the listing is still useful.
 *
 * @param {string} url Absolute image URL (the WordPress preview_url).
 * @returns {Promise<{type:'image',data:string,mimeType:string}|null>}
 */
async function fetchImageBlock(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_INLINE_IMAGE_BYTES) return null;
    return { type: 'image', data: buf.toString('base64'), mimeType: mime };
  } catch {
    return null;
  }
}

/**
 * Register every tool on the server.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('./rest.js').TamRankClient} client
 */
export function registerTools(server, client) {
  const read = (handler) => async (args) => {
    try {
      return ok(await handler(args || {}));
    } catch (err) {
      return fail(err);
    }
  };
  const write = (handler) => async (args) => {
    try {
      return writeResult(await handler(args || {}));
    } catch (err) {
      return fail(err);
    }
  };

  // ---- reads (site:read) ----

  server.registerTool('get_site_context', {
    title: 'Get site context',
    description: 'Brand, language and site type so the agent understands the site before acting.',
    inputSchema: {},
  }, read(() => client.get('/site/context')));

  server.registerTool('get_capabilities', {
    title: 'Get capabilities',
    description: 'Licence tier, feature availability, AI-credit balance, GSC state, the token\'s granted scopes, and rate-limit headroom. The reflex opening call. The `gsc` block reports not just `connected` but `indexing_available` + `property_mismatch`: a connected-but-mismatched GSC property (its host differs from the site) means Google has no data for these URLs, so request_recrawl / start_index_scan are refused (409) — check `gsc.indexing_available` before attempting any indexing action; reads are unaffected.',
    inputSchema: {},
  }, read(() => client.get('/capabilities')));

  server.registerTool('get_site_overview', {
    title: 'Get site overview',
    description: 'All pages/posts with their SEO status (paginated) — a SHALLOW triage list (audit score + the meta/content legs + meta flags), NOT the deep analysis. When the user asks to look deeper across the pages, prefer get_site_analysis (one call, deep-analyses the weakest pages); for one specific page use get_page_analysis. Do not present this shallow list as the deep look.',
    inputSchema: {
      page: z.number().int().positive().optional().describe('Page number (1-based).'),
      per_page: z.number().int().min(1).max(100).optional().describe('Items per page.'),
    },
  }, read((a) => client.get('/site/overview', { page: a.page, per_page: a.per_page })));

  server.registerTool('get_site_health', {
    title: 'Get site health',
    description: 'One-call diagnosis: meta gaps, redirects, 404s, chains/loops and the category scores — plus an inline score card (a mini-donut per category: SEO, Content, Schema, Images, PageSpeed; a "—" ring means not scanned yet).',
    inputSchema: {
      include_visual: z.boolean().optional().describe('Return the inline score-card image (default true).'),
    },
  }, async (args) => {
    const a = args || {};
    try {
      return okWithVisual(await client.get('/site/health', { include_visual: a.include_visual === false ? 'false' : undefined }));
    } catch (err) {
      return fail(err);
    }
  });

  server.registerTool('get_priority_actions', {
    title: 'Get priority actions',
    description: 'Impact-ranked "what to fix first", optionally filtered by focus area.',
    inputSchema: {
      focus: z.string().optional().describe('Optional focus filter (e.g. quick-wins, money-pages, traffic).'),
    },
  }, read((a) => client.get('/priority-actions', { focus: a.focus })));

  server.registerTool('get_next_action', {
    title: 'Get the single best next action',
    description: 'The ONE highest-impact thing to do right now: the top card of the site\'s priority ranking reduced to a concrete instruction — the problem (`action.type`), the target (`action.target` — for post targets the title/URL are live-resolved; attachment and url targets carry the cached card\'s snapshot values), and the MCP tool that fixes it (`action.tool.name` + how; `actionable_by_agent` says whether you can do it or should advise the owner). IMPORTANT: the ranking is a cached snapshot (10-min TTL, refreshed only when the dashboard is viewed) that does NOT update after your writes — calling this again right after a fix returns the SAME action; act on it once, verify with rescore_page, then work through get_priority_actions or search_posts for the rest. available=false when no ranking is cached (this tool never recomputes) — the note then gives a concrete fallback. Rely on type/tool, not the prose (may be localized).',
    inputSchema: {},
  }, read(() => client.get('/agent/next-action')));

  server.registerTool('get_issues', {
    title: 'Get the issues list',
    description: 'The site-wide diagnostic roll-up: every category of SEO problem TamRank can see right now, in ONE read, ranked by impact — sits between get_site_health (just the category scores) and the per-tool detail reads. A category roll-up, NOT a per-page dump: one row per issue type (e.g. grp_missing_titles, grp_404, not_indexed, low_ctr, cwv_failure) carrying a severity bucket (high/medium/low), the affected-page `count`, an `impact_score`, up to 3 example pages, and a `drill_down` hint naming the tool that lists/fixes that type. Start here to triage "what is wrong?", then follow drill_down (get_site_overview, get_404s, get_images_missing_alt, get_index_status, get_pagespeed, get_gsc_pages, search_posts) to the specifics and fix with update_meta / manage_redirects / resolve_404 / update_image_alt, verifying with rescore_page. Filter with severity (e.g. high,medium) and/or type (comma-separated type ids). Counts/examples are a cached snapshot (10-min TTL) that refreshes when the dashboard is viewed — it does NOT update right after your writes, so do not loop on it; computed=false means the ranking has not been cached for this site yet (the note gives a fallback).',
    inputSchema: {
      severity: z.string().optional().describe('Filter to these severities, comma-separated (high, medium, low).'),
      type: z.string().optional().describe('Filter to these issue types, comma-separated (e.g. grp_404,not_indexed). Omit for all.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max issue rows (default 50; the list is one row per type, so usually small).'),
    },
  }, read((a) => client.get('/issues', { severity: a.severity, type: a.type, limit: a.limit })));

  server.registerTool('search_posts', {
    title: 'Search / filter the managed pages',
    description: 'Find pages without paging through the whole overview: `q` matches title OR slug; filter by post_type, score range (score_below / score_above — both STRICT bounds, also when combined), missing meta (missing_meta: title | description | any), or list never-audited pages (unscored=true). Sort worst-first with orderby=score&order=asc — the quickest way to "the N worst pages about X". Items have the same shape as get_site_overview. Honest edges: score filters and orderby=score EXCLUDE never-audited posts (no score meta is not score 0) — use unscored=true to find those (it cannot combine with score filters or orderby=score: 400); missing_meta misses whitespace-only values — the has_meta_* flags per item are authoritative. Same published+managed boundary as the overview. Drill into results with get_meta / get_page_analysis.',
    inputSchema: {
      q: z.string().optional().describe('Search term — matches post title or slug.'),
      post_type: z.string().optional().describe('Restrict to one managed post type (e.g. page, post).'),
      score_below: z.number().int().min(0).max(100).optional().describe('Only pages with audit score strictly below this.'),
      score_above: z.number().int().min(0).max(100).optional().describe('Only pages with audit score strictly above this.'),
      missing_meta: z.enum(['title', 'description', 'any']).optional().describe('Only pages missing this meta field.'),
      unscored: z.boolean().optional().describe('Only never-audited pages (cannot combine with score filters).'),
      orderby: z.enum(['date', 'score']).optional().describe('Sort key (default date).'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort direction (default desc).'),
      page: z.number().int().min(1).optional(),
      per_page: z.number().int().min(1).max(100).optional().describe('Default 25.'),
    },
  }, read((a) => client.get('/search', {
    q: a.q, post_type: a.post_type, score_below: a.score_below, score_above: a.score_above,
    missing_meta: a.missing_meta, unscored: a.unscored === true ? 'true' : undefined,
    orderby: a.orderby, order: a.order, page: a.page, per_page: a.per_page,
  })));

  server.registerTool('get_meta', {
    title: 'Get post meta',
    description: 'Current SEO meta of one post, its score breakdown (total plus the meta and content legs behind it — so you can see whether the meta or the content is dragging the page down), and structured findings (F39). Use before update_meta. The score here is the stored value; if you just wrote meta it may be stale until you call rescore_page.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/meta`)));

  server.registerTool('get_page_analysis', {
    title: 'Get page analysis (deep dive)',
    description: 'Look deeper at / diagnose ONE page — why it scores low and exactly what to fix. This is the tool to reach for whenever the user wants to go deeper than the overview on a specific page (or, after get_site_overview, on each of the weakest pages). Full per-page SEO audit — the deep dive get_meta is not. Returns the score breakdown (meta vs content legs, the LIVE content score, and a stale flag when the stored/dashboard score is out of date — call rescore_page to persist a fresh score and clear it) plus the content analysis: every category and check with status, the top issues each with a ready-made fix tip, and the extracted evidence (heading tree, images, links, word count). Each check is flagged actionable_by_agent — you can fix image-alt issues (via update_image_alt) and the focus keyword (via update_meta); headings/readability/links/length need page-content edits, so report those to the site owner. The human-facing labels and tips are canonical English (content_analysis.language); each check has a stable, language-neutral `code` — present findings to the user in their own language using the codes, do not just echo the English text. Heavier than get_meta (recomputes live). Also returns an inline SEO score donut image (total + meta/content legs).',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
      include_visual: z.boolean().optional().describe('Return an inline SEO score donut image (default true).'),
    },
  }, async (args) => {
    const a = args || {};
    try {
      return okWithVisual(await client.get(`/post/${a.post_id}/analysis`, { include_visual: a.include_visual === false ? 'false' : undefined }));
    } catch (err) {
      return fail(err);
    }
  });

  server.registerTool('get_site_analysis', {
    title: 'Analyse the site (deep, multi-page)',
    description: 'The reliable deep pass across MULTIPLE pages in one call — reach for this when the user says "look deeper at my pages", "what is wrong across my site", or "analyse my worst pages". Ranks the managed published pages by score and deep-analyses the lowest-scoring few, returning each weak page\'s score legs (live + stale flag) and its top issues with ready-made fixes plus an agent_fixable list. Heavier than other reads (analyses up to 5 pages live). For the full breakdown of any single page that surfaces, follow up with get_page_analysis; for one specific page from the start, use get_page_analysis directly.',
    inputSchema: {
      limit: z.number().int().min(1).max(5).optional().describe('How many of the lowest-scoring pages to deep-analyse (default 3, max 5).'),
      post_type: z.string().optional().describe('Restrict to one managed post type (e.g. page, post).'),
    },
  }, read((a) => client.get('/site/analysis', { limit: a.limit, post_type: a.post_type })));

  server.registerTool('get_schema', {
    title: 'Get a page\'s schema',
    description: 'Diagnostic read of the structured data (Schema.org JSON-LD) TamRank renders for ONE page, and how complete/healthy it is. Returns the effective type + extra types, the source (automatisch = auto-detected, handmatig = manually set, template, or disabled), an auto-detection confidence, a validity verdict, any active third-party SEO plugin that also emits schema (Yoast/RankMath/…) with a conflict warning, and a concrete next_action. Validity mirrors TamRank itself: auto-detected pages are "active_auto" and counted as covered (required fields are auto-sourced from the post, so there is no false "missing field" noise); template pages get a real required-field check ("active_template" with the audit detail); pages with schema off are "disabled". Read-only: fix gaps with update_meta (e.g. add a featured image or description) then rescore_page. For the whole site use get_schema_overview.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/schema`)));

  server.registerTool('get_schema_overview', {
    title: 'Get site-wide schema coverage',
    description: 'Shallow site-wide structured-data roll-up: how many published pages have schema, the coverage %, the type distribution (BlogPosting/Product/…), and counts of disabled / template-based / manually-overridden / not-yet-detected pages, plus whether a third-party SEO plugin is also emitting schema. Because TamRank auto-detects schema on every page, coverage is normally near-complete; not_yet_detected flags pages awaiting first detection. This is the SHALLOW overview (no per-page missing-field detail) — for one page\'s validity call get_schema on its post_id.',
    inputSchema: {},
  }, read(() => client.get('/schema/overview')));

  server.registerTool('get_schema_settings', {
    title: 'Get site schema identity',
    description: 'Read the site-wide Organization/WebSite schema identity (organization name, URL, logo, contact, postal address, social profiles) that TamRank renders in EVERY page\'s JSON-LD @graph, with the rendered Organization node and a completeness check (which high-value fields are still empty). This is the part auto-detection cannot fill in — your real business data, normally the biggest schema gap on a site. Read this before update_schema_settings.',
    inputSchema: {},
  }, read(() => client.get('/schema/settings')));

  server.registerTool('get_topical_authority', {
    title: 'Get topical authority map',
    description: 'The site\'s topical-authority map: the pillar topic, its topic clusters (`clusters` — each with the still-published pages it covers and the `missing_topics` it still needs), the overall `coverage` %, the content `gaps`, and the top recommended actions (`top_actions`). Use this to see where the site is topically strong vs thin and what content to add to build authority. `counts` holds the true totals; the arrays are capped on very large maps. Read-only and advisory (actionable_by_agent=false): act on a gap by creating or improving the relevant page, then run get_page_analysis / update_meta on it. If has_map=false, no map exists yet — a topical-authority analysis must be run from the TamRank dashboard first (it consumes credits and is async, so it is not an agent action); `processing` says whether one is already running.',
    inputSchema: {},
  }, read(() => client.get('/site/topical-authority')));

  server.registerTool('get_redirects', {
    title: 'List redirects',
    description: 'Existing redirects with their chain status.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
  }, read((a) => client.get('/redirects', { limit: a.limit, offset: a.offset })));

  server.registerTool('get_redirect_chains', {
    title: 'Get redirect chains and loops',
    description: 'Redirect chains (A→B→C) and loops, computed LIVE from the active redirects (the stored chain_status in get_redirects can lag; this does not use it). Each chain lists its hops, the final_destination, and a ready-made `fix`: flatten by updating the FIRST redirect to point straight at final_destination via manage_redirects (dry-run first; repeat per hop to flatten every row). Chains longer than 10 hops are cut off (truncated=true) and get NO fix — their final_destination may itself redirect further; flatten the listed hops, then call again. Lists are capped at 200 entries (capped=true: counts reflect only what is listed). Loops are listed separately and cannot be flattened — break one by changing or deleting one of its rows. length counts redirect rows; healthy single redirects are not listed.',
    inputSchema: {},
  }, read(() => client.get('/redirects/chains')));

  server.registerTool('get_404s', {
    title: 'List 404s',
    description: 'Open 404s grouped by URL and ranked by hits (with a has_redirect flag). Feeds resolve_404.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, read((a) => client.get('/404s', { limit: a.limit })));

  server.registerTool('get_audit_log', {
    title: 'Get audit log',
    description: 'Combined history of changes — manual edits and agent actions — each tagged with its source. Agent actions carry the audit id rollback needs.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      post_id: z.number().int().positive().optional().describe('Filter to one post.'),
      source: z.enum(['manual', 'agent']).optional().describe('Filter by origin.'),
    },
  }, read((a) => client.get('/audit-log', { limit: a.limit, post_id: a.post_id, source: a.source })));

  server.registerTool('get_changes', {
    title: 'Get changes since a timestamp',
    description: 'Incremental "what changed since X" feed — the cursor-driven counterpart of get_audit_log. Requires `since` (ISO-8601 or unix, INCLUSIVE); returns entries OLDEST FIRST with a `next_since` cursor: process the page, poll again with next_since, and ALWAYS dedupe by source+id — rows sharing the boundary second (at minimum the last one) repeat by design so none are lost. If `cursor_stalled` is true a single second held more rows than the limit: retry with a higher limit (max 100). Each entry is tagged source=manual (a human edit of the tracked SEO fields, captured on save — repeat saves within 5 minutes are debounced/skipped) or source=agent (an MCP write, with its audit_id for rollback; never pruned). All timestamps are UTC ISO-8601. Coverage is partial by design and the response says so: only tracked SEO meta fields + content stats of published managed posts are recorded — publish/unpublish/delete transitions and ordinary content edits are not logged, and manual entries for since-deleted posts drop out. Manual history is pruned after ~180 days (`since_before_retention` flags when your window predates it). Needs audit:read.',
    inputSchema: {
      since: z.string().describe('Lower bound, exclusive — ISO-8601 (2026-06-01T00:00:00Z) or unix timestamp. Use the previous response\'s next_since to continue.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max entries (default 25).'),
      post_id: z.number().int().positive().optional().describe('Filter to one post.'),
      source: z.enum(['manual', 'agent']).optional().describe('Filter by origin.'),
    },
  }, read((a) => client.get('/changes', { since: a.since, limit: a.limit, post_id: a.post_id, source: a.source })));

  server.registerTool('get_images_missing_alt', {
    title: 'Get images missing alt text',
    description: 'Image attachments that have no alt text, returned WITH each image so you can look at it and write an accurate, specific alt. Then call update_image_alt per image. Credit-free — your own model does the captioning, TamRank only stores the result.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Max images (default 10).'),
      offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      include_images: z.boolean().optional().describe('Embed each image so a vision model can see it (default true). Set false for a fast text-only listing.'),
    },
  }, async (args) => {
    const a = args || {};
    try {
      const data = await client.get('/images/missing-alt', { limit: a.limit ?? 10, offset: a.offset });
      const images = Array.isArray(data.images) ? data.images : [];
      const content = [{ type: 'text', text: JSON.stringify(data, null, 2) }];
      if (a.include_images !== false) {
        for (const img of images) {
          content.push({ type: 'text', text: `image id ${img.id} — "${img.title || ''}" (${img.width || '?'}×${img.height || '?'}, ${img.mime_type || ''})` });
          const block = await fetchImageBlock(img.preview_url || img.url);
          if (block) content.push(block);
          else content.push({ type: 'text', text: '(preview unavailable — caption from the title/context above or skip)' });
        }
      }
      return { content };
    } catch (err) {
      return fail(err);
    }
  });

  // ---- Search Console reads (site:read) ----

  server.registerTool('get_gsc_pages', {
    title: 'Get Search Console pages',
    description: 'Page performance from Google Search Console: clicks, impressions, CTR and average position over a period. Returns connected=false (with a note) when GSC is not linked.',
    inputSchema: {
      period: z.number().int().optional().describe('Look-back window in days: 7, 28 or 90 (default 28).'),
    },
  }, read((a) => client.get('/gsc/pages', { period: a.period })));

  server.registerTool('get_gsc_keywords', {
    title: 'Get Search Console keywords',
    description: 'Keyword performance for one page, each enriched with click-uplift potential (estimated search volume, projected extra clicks at the target position, and a confidence tier). Get a page URL from get_gsc_pages first.',
    inputSchema: {
      page_url: z.string().describe('The full page URL (as returned by get_gsc_pages).'),
      period: z.number().int().optional().describe('7, 28 or 90 days (default 28).'),
    },
  }, read((a) => client.get('/gsc/keywords', { page_url: a.page_url, period: a.period })));

  server.registerTool('get_keyword_stability', {
    title: 'Get keyword position stability',
    description: 'Per-keyword position stability for one page (stable / moderate / volatile over the last 28 days) plus a direction trend (improving / declining / flat). Use it to tell a real ranking drop from normal day-to-day volatility before reacting.',
    inputSchema: {
      page_url: z.string().describe('The full page URL (as returned by get_gsc_pages).'),
    },
  }, read((a) => client.get('/gsc/keyword-stability', { page_url: a.page_url })));

  server.registerTool('get_index_status', {
    title: 'Get page index status',
    description: 'Google index status of ONE page, from the cached result of the last time the page was checked — a site index scan or the publish-time auto-check (credit-free; never queries Google live). `status` is indexed | crawled (crawled but not indexed) | not_found (not on Google) | noindex | error | null (no usable cached status: never checked, or the last check stored no verdict — a non-null `checked_at` tells you which), with `checked_at` + a `stale` flag (older than 48h; null when never checked), Google\'s `last_crawl` of the page, and `requested_at` (when indexing was last requested for this page via ANY surface — request_recrawl, the dashboard\'s manual button, and publish-time auto-index all record it; null means no recent request at all. All surfaces share one ~48h cooldown keyed on it). `batch_running` is read passively from the site and can stay true after a scan already finished, until the site dashboard next syncs — treat it as advisory and do not poll in a loop waiting for it to flip. To act on a bad status (not_found / crawled-not-indexed), fix the page first, then use request_recrawl (consumes credits, index:write). For the site-wide picture use get_site_index.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/index`)));

  server.registerTool('get_site_index', {
    title: 'Get site index rollup',
    description: 'Site-wide Google index coverage from the cached results of the last index scan (credit-free; never queries Google live): `published` (the denominator) and `counts` per status (indexed / crawled / not_found / noindex / error / unchecked — where unchecked means never checked OR the last check stored no usable status; such pages show a non-null checked_at in get_index_status) over the published managed pages, `last_checked` + `stale` (older than 48h; null when the site was never scanned), scan state (`scan` — the engine\'s own site-global approximate counter over ALL public post types: it can exceed `published`, can lag behind a finished scan, and the `counts` block is the authoritative per-page view), and the 48h manual-refresh cooldown (`cooldowns.manual_refresh`). Use this to spot indexing problems site-wide, then inspect a specific page with get_index_status. When `gsc.connected` is false or `gsc.property_mismatch` is true everything is withheld (available=false, fields null) — fixing the GSC connection is a dashboard action. Refresh site-wide with start_index_scan (consumes credits, index:write) — it shares the 48h cooldown with the dashboard.',
    inputSchema: {},
  }, read(() => client.get('/site/index')));

  // ---- writes (dry-run by default) ----

  server.registerTool('update_meta', {
    title: 'Update post meta',
    description: 'Write SEO meta on a post. Dry-run by default: call without execute to preview the diff + change_token, then call again with execute=true and that change_token to apply. On execute the response carries a `score` projection (the live meta leg + the projected total, with the before→after delta) so you can see immediately whether the fix helped — no second read needed. That projection is cheap and does NOT persist: the stored/dashboard score stays as it was until you call rescore_page to commit a full re-audit.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
      meta_title: z.string().optional(),
      meta_description: z.string().optional(),
      focus_keyword: z.string().optional(),
      secondary_keywords: z.array(z.string()).optional().describe('Up to 4 secondary keywords.'),
      custom_slug: z.string().optional(),
      canonical_url: z.string().optional(),
      social_title: z.string().optional(),
      social_description: z.string().optional(),
      social_image: z.string().optional(),
      noindex: z.boolean().optional(),
      nofollow: z.boolean().optional(),
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, [
      'meta_title', 'meta_description', 'focus_keyword', 'secondary_keywords', 'custom_slug',
      'canonical_url', 'social_title', 'social_description', 'social_image', 'noindex', 'nofollow',
    ]);
    return client.post(`/post/${a.post_id}/meta`, body, control);
  }));

  server.registerTool('manage_redirects', {
    title: 'Manage redirects',
    description: 'Create, update or delete a redirect. Dry-run by default (preview + change_token, then execute=true to apply). Delete snapshots the row so rollback can recreate it.',
    inputSchema: {
      action: z.enum(['create', 'update', 'delete']).describe('What to do.'),
      id: z.number().int().positive().optional().describe('Redirect id (required for update/delete).'),
      source_url: z.string().optional().describe('Source path, e.g. /old-page (create/update).'),
      target_url: z.string().optional().describe('Target URL (create/update).'),
      redirect_type: z.enum(REDIRECT_TYPES).optional().describe('301/302 (FREE) or 307/410 (PRO).'),
      execute: z.boolean().optional(),
      change_token: z.string().optional(),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, ['source_url', 'target_url', 'redirect_type']);
    if (a.action === 'create') {
      return client.post('/redirects', body, control);
    }
    if (!a.id) {
      throw new ApiError(400, 'missing_id', `action "${a.action}" requires an id.`);
    }
    if (a.action === 'update') {
      return client.post(`/redirects/${a.id}`, body, control);
    }
    return client.del(`/redirects/${a.id}`, control);
  }));

  server.registerTool('resolve_404', {
    title: 'Resolve a 404',
    description: 'Turn a logged 404 into a redirect. Dry-run by default (preview + change_token, then execute=true to apply).',
    inputSchema: {
      url: z.string().describe('The 404 URL to resolve (e.g. /old-page).'),
      target_url: z.string().describe('Where it should redirect to.'),
      redirect_type: z.enum(REDIRECT_TYPES).optional(),
      execute: z.boolean().optional(),
      change_token: z.string().optional(),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, ['url', 'target_url', 'redirect_type']);
    return client.post('/404s/resolve', body, control);
  }));

  server.registerTool('rollback', {
    title: 'Roll back an action',
    description: 'Undo a logged agent action by its audit id (from get_audit_log). Dry-run by default (describes the reversal + change_token, then execute=true to apply). Only rollback-eligible, not-yet-reverted actions qualify.',
    inputSchema: {
      action_id: z.number().int().positive().describe('The audit id of the action to undo.'),
      execute: z.boolean().optional(),
      change_token: z.string().optional(),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    return client.post(`/rollback/${a.action_id}`, undefined, control);
  }));

  server.registerTool('update_image_alt', {
    title: 'Update image alt text',
    description: 'Write alt text on an image attachment. Dry-run by default: call without execute to preview the diff + change_token, then call again with execute=true and that change_token to apply. Pair with get_images_missing_alt. Reversible via rollback.',
    inputSchema: {
      image_id: z.number().int().positive().describe('The image attachment id (from get_images_missing_alt).'),
      alt_text: z.string().describe('The alt text to write.'),
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, ['alt_text']);
    return client.post(`/image/${a.image_id}/alt`, body, control);
  }));

  // ---- schema identity (schema:write) ----

  server.registerTool('update_schema_settings', {
    title: 'Update site schema identity',
    description: 'Write the site-wide Organization/WebSite identity that TamRank renders in EVERY page\'s JSON-LD @graph: organization name, website URL, logo, email, telephone, postal address, social profiles. This is the part auto-detection cannot fill in — your real business data — and it is normally the biggest schema gap on a site, so filling it improves structured data site-wide in one write. Dry-run by default: call without execute to preview the diff + change_token, then call again with execute=true and that change_token to apply. Reversible via rollback (it snapshots the whole settings object). Read the current values + completeness with get_schema_settings first. Guardrails: entity_type is limited to Organization or LocalBusiness; raw custom JSON-LD and entity_type=Custom stay admin-only and cannot be set here. Needs the schema:write scope (the owner must mint a token with it).',
    inputSchema: {
      entity_type: z.enum(['Organization', 'LocalBusiness']).optional().describe('Site entity type.'),
      organization_name: z.string().optional().describe('Organization / business name.'),
      website_url: z.string().optional().describe('Canonical site URL.'),
      logo_url: z.string().optional().describe('Absolute URL to the logo image.'),
      email: z.string().optional().describe('Public contact email.'),
      telephone: z.string().optional().describe('Public contact phone number.'),
      address: z.object({
        street: z.string().optional(),
        postal_code: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional().describe('2-letter country code, e.g. NL.'),
      }).optional().describe('Postal address (renders as PostalAddress).'),
      social_profiles: z.array(z.string()).optional().describe('Social profile URLs (schema sameAs).'),
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, ['entity_type', 'organization_name', 'website_url', 'logo_url', 'email', 'telephone', 'address', 'social_profiles']);
    return client.post('/schema/settings', body, control);
  }));

  // ---- index actions (index:write — default-off scope; TamRank AI credits) ----

  server.registerTool('request_recrawl', {
    title: 'Request Google recrawl of a page',
    description: 'Ask Google to (re)crawl ONE page via the TamRank backend. CONSUMES AI CREDITS (the per-call cost is decided by the backend; the response carries the cached `credits.balance`) and needs the index:write scope (default-off — the site owner must mint a token with it). Dry-run by default: the preview shows the credits balance plus a low-credits warning when the balance is at the soft limit; re-send with execute=true and the change_token to apply. Refuses: noindex pages (409 — remove the noindex via update_meta first), a second request within the shared ~48h per-post cooldown (429 — the dashboard, the manual button and this tool share one window), the per-site daily recrawl cap (429 — a backstop under Google\'s own indexing quota; the dry-run\'s `daily_recrawl` block shows how many remain today), and a missing/mismatched GSC connection (409). On success the page enters its ~48h requested window (`requested_at` in get_index_status). Google typically takes days to act — do NOT poll for an immediate status change; the request is not rollbackable. Best used after fixing a page (update_meta + rescore_page) so Google sees the improvement sooner.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    return client.post(`/post/${a.post_id}/recrawl`, undefined, control);
  }));

  server.registerTool('start_index_scan', {
    title: 'Start a site-wide index scan',
    description: 'Submit the never-checked and stale (>48h) published URLs across ALL public post types (a wider set than get_site_index\'s managed-only counts — treat counts.unchecked as a lower bound) to the TamRank backend index checker, in capped engine batches — the bulk refresh behind get_site_index. CONSUMES AI CREDITS (batch-size dependent) and needs index:write (default-off scope). Dry-run by default (the preview shows scope + the cached credits balance; execute=true + change_token to apply). Shares the 48h refresh cooldown with the TamRank dashboard (429 with next_allowed_at when armed) and refuses while a scan is already running (409). After starting, poll get_index_scan_status sparingly (each poll is a metered op) or read the free passive `scan` block in get_site_index; results land in the cached statuses as they complete.',
    inputSchema: {
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    return client.post('/site/index/scan', undefined, control);
  }));

  server.registerTool('get_index_scan_status', {
    title: 'Index scan progress (live poll)',
    description: 'Progress of a running index scan. When a batch is running this LIVE-POLLS the TamRank backend (a metered op on the credit burst bucket; needs index:write) and folds finished results into the cached statuses; when nothing is running it answers passively and free (done=true, nothing polled). Poll sparingly — once every few minutes is plenty; the credit-free passive alternative is the `scan` block in get_site_index.',
    inputSchema: {},
  }, read(() => client.get('/site/index/scan')));

  server.registerTool('rescore_page', {
    title: 'Re-score a page (persist a fresh audit)',
    description: 'Recompute and PERSIST a page\'s SEO score (meta + content + total) so get_meta, get_site_overview and the WordPress dashboard catch up to reality. This is the VERIFY step of fix → verify: update_meta already shows a cheap projected score in its response, but the stored/dashboard number stays stale until you rescore. Call it after writing meta (or an image alt) to confirm the stored score actually moved, or whenever get_meta/get_page_analysis reports stale=true. Heavier than a read — it re-runs the content analyzer, which may fetch the live page. Needs meta:write. Not a dry-run tool: it writes the refreshed scores immediately and is idempotent (running it twice yields the same numbers); it changes no page content, only the derived score caches.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id to re-score.'),
    },
  }, async (args) => {
    const a = args || {};
    try {
      return ok(await client.post(`/post/${a.post_id}/rescore`), 'Re-scored — the stored scores now reflect the page\'s current meta and content.');
    } catch (err) {
      return fail(err);
    }
  });

  // ---- PageSpeed (Google PSI — the site's own API key, no TamRank credits) ----

  server.registerTool('get_pagespeed', {
    title: 'Get PageSpeed for a page',
    description: 'Google PageSpeed Insights for one page: performance score + Core Web Vitals (LCP/INP/CLS/TBT/FCP) + the top opportunities + CrUX field data. Cached by default (instant); set refresh=true to run ONE live test (slow — a real external Google call). strategy defaults to mobile (mobile-first indexing). Returns available:false when the site has no PageSpeed API key. PageSpeed issues are server/theme/file-level — advise the site owner; they are NOT fixable via the write tools (actionable_by_agent is always false).',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Device strategy (default mobile).'),
      refresh: z.boolean().optional().describe('Run a fresh live test instead of the cache (slow). Default false.'),
      include_visual: z.boolean().optional().describe('Return an inline PageSpeed score gauge image (default true).'),
    },
  }, async (args) => {
    const a = args || {};
    try {
      return okWithVisual(await client.get(`/post/${a.post_id}/pagespeed`, {
        strategy: a.strategy,
        refresh: a.refresh ? 'true' : undefined,
        include_visual: a.include_visual === false ? 'false' : undefined,
      }));
    } catch (err) {
      return fail(err);
    }
  });

  server.registerTool('start_pagespeed_scan', {
    title: 'Start a bulk PageSpeed scan',
    description: 'Queue a PageSpeed scan across the site and return immediately with a scan_id — it runs in the BACKGROUND (roughly one page every few seconds, mobile + desktop each), so a large site takes minutes. This is how you do PageSpeed "in bulk" without waiting: start it, then poll get_pagespeed_scan_status; finished pages appear in get_pagespeed, get_page_analysis and get_site_overview as they complete. Optionally limit to the N lowest-scoring pages, or restrict to one post type. Needs meta:write and a PageSpeed API key on the site.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe('Scan only the N lowest-scoring pages (default: all managed pages, capped at 200).'),
      post_type: z.string().optional().describe('Restrict to one managed post type (e.g. page, post).'),
    },
  }, async (args) => {
    const a = args || {};
    try {
      return ok(await client.post('/pagespeed/scan', undefined, { limit: a.limit, post_type: a.post_type }), 'Scan queued and running in the background — poll get_pagespeed_scan_status for progress.');
    } catch (err) {
      return fail(err);
    }
  });

  server.registerTool('get_pagespeed_scan_status', {
    title: 'PageSpeed scan progress',
    description: 'Progress of the background bulk PageSpeed scan: processed / total / completed / failed / pending plus an ETA. Poll this after start_pagespeed_scan (each poll also nudges the background worker along). is_running flips to false when the scan is done.',
    inputSchema: {},
  }, read(() => client.get('/pagespeed/scan')));
}
