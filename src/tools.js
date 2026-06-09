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
    const hint = HINTS[err.status];
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
    description: 'Licence tier, feature availability, AI-credit balance, GSC connection, the token\'s granted scopes, and rate-limit headroom. The reflex opening call.',
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
