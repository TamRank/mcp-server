/**
 * TamRank MCP tool surface (V1.1).
 *
 * Maps the 10 headline tools (+ a few supporting reads that make the write tools
 * usable) onto the TamRank Agent-API REST endpoints. Every write tool defaults to
 * dry-run: call it once to get a diff + change_token, then call again with
 * execute=true and that change_token to apply. The discipline is enforced
 * server-side; this layer only forwards and formats.
 *
 * Sequencing advice lives in INSTRUCTIONS (sent once, at initialize) instead of
 * being repeated in every tool description: a description is read on every
 * tools/list, so prose there is a fixed cost the agent pays before it asks
 * anything. Descriptions say what the tool does, what goes in and what comes out.
 */

import { z } from 'zod';
import { ApiError, splitWriteArgs } from './rest.js';

const REDIRECT_TYPES = ['301', '302', '307', '410'];

/**
 * The server's operating manual, delivered once in the initialize result. Keep it
 * under ~1.5k characters: it is a fixed session cost, like tools/list.
 */
export const INSTRUCTIONS = `TamRank manages ONE WordPress site's SEO. Read, fix, verify.

Start with get_capabilities, then get_signals. Triage with get_issues or get_next_action; get_site_health shows category scores. Narrow with get_site_overview/search_posts, then get_page_analysis.

Writes default to dry-run. First get the diff and change_token; then repeat with execute=true and that token. It binds the exact reviewed diff: changed input returns 409 and writes nothing. Applied writes return an audit_id for rollback. update_meta_batch handles up to 25 posts under one token, with one audit_id per item.

Meta writes persist a fresh score by default; do not call rescore_page afterward. Use rescore=false to defer, then rescore once after the set.

Action ranking is cached. If ranking.writes_since > 0, repeat the ranking call once with refresh=true; do not poll.

Prose may be localised. Key off stable fields such as type, code and tool.name.`;

/** Per-status guidance appended to an error so the agent knows what to do. */
const HINTS = {
  401: 'Authentication failed. Check the TAMRANK_PAT environment variable.',
  402: 'This site is not on TamRank PRO. The agent API requires an active PRO licence — see https://tamrank.com/pricing.',
  403: 'The token lacks the scope this tool needs. Mint a token with the required scope at tamrank.com/account/agent-tokens.',
  404: 'The target was not found.',
  422: 'The change is not valid (for example, a redirect that would create a loop).',
  429: 'Rate limited. Wait for the window to reset before retrying.',
};

/**
 * A 409 is not one thing. A mismatched token, an already-undone rollback and an
 * existing redirect all land on the same status and each needs a different next
 * step, so a single generic hint sent the agent into a pointless dry-run loop on
 * conflicts that have nothing to do with tokens. Codes not listed here get no
 * hint: their server message already says what happened.
 */
const CONFLICT_HINTS = {
  change_token_mismatch: 'The change_token did not match — re-run the dry run and use the change_token it returns.',
  already_reverted: 'This action was already rolled back; nothing to do.',
  redirect_exists: 'A redirect for this source already exists; read get_redirects.',
  signals_unavailable: 'This site\'s TamRank plugin predates the signal store, so get_signals has nothing to read. Every other tool works; use get_404s with sort=newest for what changed recently.',
};

/** A 402 can also mean depleted AI credits (index actions) — different advice. */
const CREDITS_HINT = 'The site\'s AI credits are depleted — they reset monthly. Check the error details (balance.resets_at) or get_capabilities for the reset date; the TamRank backend remains the final authority.';

function isInsufficientCredits(err) {
  return err.code === 'insufficient_credits'
    || (err.data && err.data.backend_code === 'insufficient_credits');
}

/** The follow-up advice for one error, or undefined when the message stands alone. */
function hintFor(err) {
  if (isInsufficientCredits(err)) return CREDITS_HINT;
  if (err.status === 409) return CONFLICT_HINTS[err.code];
  return HINTS[err.status];
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
    const hint = hintFor(err);
    const lines = [`Error ${err.status || ''} ${err.code}: ${err.message}`.trim()];
    if (hint) lines.push(hint);
    if (err.data && Object.keys(err.data).length) lines.push('Details: ' + JSON.stringify(err.data));
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
  }
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}

/**
 * The answer to every tool call once the startup preflight refused the connection
 * (rejected PAT, no PRO licence). No request is sent: the verdict is already known
 * and repeating it per call is what lets the agent read it at all.
 */
function preflightRefusal(preflight) {
  return {
    content: [{
      type: 'text',
      text: `${preflight.message}\n\nThis is the verdict from the connection check at startup; no request was sent. Fix it, then restart the MCP server.`,
    }],
    isError: true,
  };
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
 * @param {{ok: boolean, status: number|null, code: string|null, message: string|null}} [preflight]
 *   The startup connection verdict. When it failed, every tool answers with it.
 */
export function registerTools(server, client, preflight = { ok: true }) {
  /** Register one tool, gated on the preflight verdict. */
  const tool = (name, config, handler) => server.registerTool(name, config, async (args, extra) => {
    if (!preflight.ok) return preflightRefusal(preflight);
    return handler(args, extra);
  });

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

  tool('get_site_context', {
    title: 'Get site context',
    description: 'Brand, language and site type.',
    inputSchema: {},
  }, read(() => client.get('/site/context')));

  tool('get_capabilities', {
    title: 'Get capabilities',
    description: 'Licence tier, scopes, credits, GSC state, rate limit, feature counts.',
    inputSchema: {
      verbose: z.boolean().optional().describe('Return the full feature registry instead of counts + unavailable.'),
    },
  }, read((a) => client.get('/capabilities', a.verbose ? { verbose: 1 } : { compact: 1 })));

  tool('get_site_overview', {
    title: 'Get site overview',
    description: 'Paginated triage list of managed pages: scores, meta flags.',
    inputSchema: {
      page: z.number().int().positive().optional().describe('Page number (1-based).'),
      per_page: z.number().int().min(1).max(100).optional().describe('Items per page.'),
    },
  }, read((a) => client.get('/site/overview', { page: a.page, per_page: a.per_page })));

  tool('get_site_health', {
    title: 'Get site health',
    description: 'Meta gaps, redirects, 404s, chains and category scores.',
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

  tool('get_priority_actions', {
    title: 'Get priority actions',
    description: 'Impact-ranked what to fix first. refresh=true recomputes.',
    inputSchema: {
      focus: z.string().optional().describe('Optional focus filter (e.g. quick-wins, money-pages, traffic).'),
      refresh: z.boolean().optional().describe('Recompute the ranking first (throttled).'),
    },
  }, read((a) => client.get('/priority-actions', { focus: a.focus, refresh: a.refresh ? 1 : undefined })));

  tool('get_next_action', {
    title: 'Get the single best next action',
    description: 'The single best next action: type, target, and its tool. refresh=true recomputes.',
    inputSchema: {
      refresh: z.boolean().optional().describe('Recompute the ranking first (throttled).'),
    },
  }, read((a) => client.get('/agent/next-action', { refresh: a.refresh ? 1 : undefined })));

  tool('get_issues', {
    title: 'Get the issues list',
    description: 'Site-wide roll-up per problem type: severity, count, impact.',
    inputSchema: {
      severity: z.string().optional().describe('Filter to these severities, comma-separated (high, medium, low).'),
      type: z.string().optional().describe('Filter to these issue types, comma-separated (e.g. grp_404,not_indexed). Omit for all.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max issue rows (default 50; the list is one row per type, so usually small).'),
    },
  }, read((a) => client.get('/issues', { severity: a.severity, type: a.type, limit: a.limit })));

  tool('search_posts', {
    title: 'Search / filter the managed pages',
    description: 'Find managed pages by term, type, score bounds or missing meta.',
    inputSchema: {
      q: z.string().optional().describe('Title or slug term.'),
      post_type: z.string().optional().describe('One managed post type.'),
      score_below: z.number().int().min(0).max(100).optional().describe('Score below this.'),
      score_above: z.number().int().min(0).max(100).optional().describe('Score above this.'),
      missing_meta: z.enum(['title', 'description', 'any']).optional().describe('Required missing meta field.'),
      unscored: z.boolean().optional().describe('Only never-audited pages.'),
      orderby: z.enum(['date', 'score']).optional().describe('Default date.'),
      order: z.enum(['asc', 'desc']).optional().describe('Default desc.'),
      page: z.number().int().min(1).optional(),
      per_page: z.number().int().min(1).max(100).optional().describe('Default 25.'),
    },
  }, read((a) => client.get('/search', {
    q: a.q, post_type: a.post_type, score_below: a.score_below, score_above: a.score_above,
    missing_meta: a.missing_meta, unscored: a.unscored === true ? 'true' : undefined,
    orderby: a.orderby, order: a.order, page: a.page, per_page: a.per_page,
  })));

  tool('get_meta', {
    title: 'Get post meta',
    description: 'One post\'s SEO meta, its stored score legs, and findings.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/meta`)));

  tool('get_page_analysis', {
    title: 'Get page analysis (deep dive)',
    description: 'Full audit of one page: score legs, each check with code and fix tip.',
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

  tool('get_site_analysis', {
    title: 'Analyse the site (deep, multi-page)',
    description: 'Deep pass over the lowest-scoring pages (max 5), with fixes.',
    inputSchema: {
      limit: z.number().int().min(1).max(5).optional().describe('How many of the lowest-scoring pages to deep-analyse (default 3, max 5).'),
      post_type: z.string().optional().describe('Restrict to one managed post type (e.g. page, post).'),
    },
  }, read((a) => client.get('/site/analysis', { limit: a.limit, post_type: a.post_type })));

  tool('get_schema', {
    title: 'Get a page\'s schema',
    description: 'One page\'s JSON-LD: type, source, validity, next action.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/schema`)));

  tool('get_schema_overview', {
    title: 'Get site-wide schema coverage',
    description: 'Site-wide schema coverage, types, not_yet_detected_ids.',
    inputSchema: {},
  }, read(() => client.get('/schema/overview')));

  tool('get_schema_settings', {
    title: 'Get site schema identity',
    description: 'The site-wide Organization/WebSite identity.',
    inputSchema: {},
  }, read(() => client.get('/schema/settings')));

  tool('get_topical_authority', {
    title: 'Get topical authority map',
    description: 'Topical-authority map: pillar, clusters, coverage, gaps.',
    inputSchema: {},
  }, read(() => client.get('/site/topical-authority')));

  tool('get_redirects', {
    title: 'List redirects',
    description: 'Existing redirects with their chain status.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
  }, read((a) => client.get('/redirects', { limit: a.limit, offset: a.offset })));

  tool('get_redirect_chains', {
    title: 'Get redirect chains and loops',
    description: 'Live redirect chains and loops; each chain carries a fix.',
    inputSchema: {},
  }, read(() => client.get('/redirects/chains')));

  tool('get_404s', {
    title: 'List 404s',
    description: 'Open 404s per URL with hits, first_seen and is_new. Feeds resolve_404.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      since: z.string().optional().describe('Newness baseline (ISO-8601 or site datetime). Defaults to the last signal scan; is_new is first_seen >= since.'),
      sort: z.enum(['hits', 'newest']).optional().describe('hits (default, lifetime hits) or newest (first seen first).'),
    },
  }, read((a) => client.get('/404s', { limit: a.limit, since: a.since, sort: a.sort })));

  tool('get_signals', {
    title: 'Get open signals',
    description: 'Open detector signals: window, delta, evidence, score and the tool that acts on each.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Max signals (default 20).'),
      type: z.string().optional().describe('Filter to one exact signal type (e.g. tech_404_new).'),
      subject_id: z.number().int().min(0).optional().describe('Filter to one subject (post id; 0 is site-wide).'),
    },
  }, read((a) => client.get('/signals', { limit: a.limit, type: a.type, subject_id: a.subject_id })));

  tool('get_audit_log', {
    title: 'Get audit log',
    description: 'Manual edits and agent actions, with the audit id for rollback.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      post_id: z.number().int().positive().optional().describe('Filter to one post.'),
      source: z.enum(['manual', 'agent']).optional().describe('Filter by origin.'),
    },
  }, read((a) => client.get('/audit-log', { limit: a.limit, post_id: a.post_id, source: a.source })));

  tool('get_changes', {
    title: 'Get changes since a timestamp',
    description: 'Changes since a timestamp, oldest first. Dedupe by source+id.',
    inputSchema: {
      since: z.string().describe('Lower bound, exclusive — ISO-8601 (2026-06-01T00:00:00Z) or unix timestamp. Use the previous response\'s next_since to continue.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max entries (default 25).'),
      post_id: z.number().int().positive().optional().describe('Filter to one post.'),
      source: z.enum(['manual', 'agent']).optional().describe('Filter by origin.'),
    },
  }, read((a) => client.get('/changes', { since: a.since, limit: a.limit, post_id: a.post_id, source: a.source })));

  tool('get_images_missing_alt', {
    title: 'Get images missing alt text',
    description: 'Images with no alt text, returned with the image to caption.',
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

  tool('get_gsc_pages', {
    title: 'Get Search Console pages',
    description: 'Search Console pages: clicks, impressions, CTR, position.',
    inputSchema: {
      period: z.number().int().optional().describe('Look-back window in days: 7, 28 or 90 (default 28).'),
    },
  }, read((a) => client.get('/gsc/pages', { period: a.period })));

  tool('get_gsc_keywords', {
    title: 'Get Search Console keywords',
    description: 'Search Console keywords for one page, with uplift potential.',
    inputSchema: {
      page_url: z.string().describe('The full page URL (as returned by get_gsc_pages).'),
      period: z.number().int().optional().describe('7, 28 or 90 days (default 28).'),
    },
  }, read((a) => client.get('/gsc/keywords', { page_url: a.page_url, period: a.period })));

  tool('get_keyword_stability', {
    title: 'Get keyword position stability',
    description: 'Per-keyword position stability and trend for one page.',
    inputSchema: {
      page_url: z.string().describe('The full page URL (as returned by get_gsc_pages).'),
    },
  }, read((a) => client.get('/gsc/keyword-stability', { page_url: a.page_url })));

  tool('get_index_status', {
    title: 'Get page index status',
    description: 'Cached Google index status of one page, with staleness.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/index`)));

  tool('get_site_index', {
    title: 'Get site index rollup',
    description: 'Site-wide index coverage from the last scan.',
    inputSchema: {},
  }, read(() => client.get('/site/index')));

  // ---- writes (dry-run by default) ----

  tool('update_meta', {
    title: 'Update post meta',
    description: 'Write SEO meta. Dry-run first; execute persists a fresh score by default.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
      meta_title: z.string().optional(),
      meta_description: z.string().optional(),
      focus_keyword: z.string().optional(),
      secondary_keywords: z.array(z.string()).optional().describe('Up to 4.'),
      custom_slug: z.string().optional(),
      canonical_url: z.string().optional(),
      social_title: z.string().optional(),
      social_description: z.string().optional(),
      social_image: z.string().optional(),
      noindex: z.boolean().optional(),
      nofollow: z.boolean().optional(),
      rescore: z.boolean().optional().describe('Fresh audit on execute (default true).'),
      execute: z.boolean().optional().describe('true + change_token applies.'),
      change_token: z.string().optional().describe('Token from dry-run.'),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, [
      'meta_title', 'meta_description', 'focus_keyword', 'secondary_keywords', 'custom_slug',
      'canonical_url', 'social_title', 'social_description', 'social_image', 'noindex', 'nofollow',
    ]);
    if (a.rescore === false) body.rescore = false;
    return client.post(`/post/${a.post_id}/meta`, body, control);
  }));

  tool('update_meta_batch', {
    title: 'Update post meta in a batch',
    description: 'Write meta on 1-25 posts. One token binds the set; each item gets an audit_id.',
    inputSchema: {
      items: z.array(z.object({
        post_id: z.number().int().positive(),
        meta_title: z.string().optional(),
        meta_description: z.string().optional(),
        focus_keyword: z.string().optional(),
        secondary_keywords: z.array(z.string()).optional(),
        custom_slug: z.string().optional(),
        canonical_url: z.string().optional(),
        social_title: z.string().optional(),
        social_description: z.string().optional(),
        social_image: z.string().optional(),
        noindex: z.boolean().optional(),
        nofollow: z.boolean().optional(),
      })).min(1).max(25).describe('Unique post per item.'),
      rescore: z.boolean().optional().describe('Fresh audit per item (default true).'),
      execute: z.boolean().optional().describe('true + change_token applies.'),
      change_token: z.string().optional().describe('Token binding the dry-run set.'),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    const body = { items: a.items };
    if (a.rescore === false) body.rescore = false;
    return client.post('/posts/meta/batch', body, control);
  }));

  tool('manage_redirects', {
    title: 'Manage redirects',
    description: 'Create, update or delete a redirect. Dry-run by default.',
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

  tool('resolve_404', {
    title: 'Resolve a 404',
    description: 'Turn a logged 404 into a redirect. Dry-run by default.',
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

  tool('rollback', {
    title: 'Roll back an action',
    description: 'Undo a logged agent action by its audit id. Dry-run by default.',
    inputSchema: {
      action_id: z.number().int().positive().describe('The audit id of the action to undo.'),
      execute: z.boolean().optional(),
      change_token: z.string().optional(),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    return client.post(`/rollback/${a.action_id}`, undefined, control);
  }));

  tool('update_image_alt', {
    title: 'Update image alt text',
    description: 'Write alt text on an image attachment. Dry-run by default.',
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

  tool('detect_schema', {
    title: 'Detect schema for a page',
    description: 'Detect and store one page\'s schema type. Applies immediately.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id (e.g. from get_schema_overview not_yet_detected_ids).'),
    },
  }, write((a) => client.post(`/post/${a.post_id}/schema/detect`, {})));

  // ---- schema identity (schema:write) ----

  tool('update_schema_settings', {
    title: 'Update site schema identity',
    description: 'Write the site-wide Organization/WebSite identity. Dry-run.',
    inputSchema: {
      entity_type: z.enum(['Organization', 'LocalBusiness']).optional(),
      organization_name: z.string().optional(),
      website_url: z.string().optional().describe('Canonical URL.'),
      logo_url: z.string().optional().describe('Absolute logo URL.'),
      email: z.string().optional().describe('Public email.'),
      telephone: z.string().optional().describe('Public phone.'),
      address: z.object({
        street: z.string().optional(),
        postal_code: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional().describe('2-letter code.'),
      }).optional().describe('PostalAddress fields.'),
      social_profiles: z.array(z.string()).optional().describe('sameAs URLs.'),
      execute: z.boolean().optional().describe('true + change_token applies.'),
      change_token: z.string().optional().describe('Token from dry-run.'),
    },
  }, write((a) => {
    const { body, control } = splitWriteArgs(a, ['entity_type', 'organization_name', 'website_url', 'logo_url', 'email', 'telephone', 'address', 'social_profiles']);
    return client.post('/schema/settings', body, control);
  }));

  // ---- index actions (index:write — default-off scope; TamRank AI credits) ----

  tool('request_recrawl', {
    title: 'Request Google recrawl of a page',
    description: 'Ask Google to recrawl one page. Costs AI credits. Dry-run.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    return client.post(`/post/${a.post_id}/recrawl`, undefined, control);
  }));

  tool('start_index_scan', {
    title: 'Start a site-wide index scan',
    description: 'Bulk-check unchecked and stale URLs. Costs credits. Dry-run.',
    inputSchema: {
      execute: z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token: z.string().optional().describe('The change_token returned by the dry run.'),
    },
  }, write((a) => {
    const { control } = splitWriteArgs(a, []);
    return client.post('/site/index/scan', undefined, control);
  }));

  tool('get_index_scan_status', {
    title: 'Index scan progress (live poll)',
    description: 'Progress of a running index scan; live-polls while one runs.',
    inputSchema: {},
  }, read(() => client.get('/site/index/scan')));

  tool('rescore_page', {
    title: 'Re-score a page (persist a fresh audit)',
    description: 'Recompute and persist a page\'s score. The verify step after a write.',
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

  tool('get_pagespeed', {
    title: 'Get PageSpeed for a page',
    description: 'PageSpeed for one page: score, Core Web Vitals, opportunities.',
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

  tool('start_pagespeed_scan', {
    title: 'Start a bulk PageSpeed scan',
    description: 'Queue a background PageSpeed scan; returns a scan_id.',
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

  tool('get_pagespeed_scan_status', {
    title: 'PageSpeed scan progress',
    description: 'Progress of the background PageSpeed scan.',
    inputSchema: {},
  }, read(() => client.get('/pagespeed/scan')));
}
