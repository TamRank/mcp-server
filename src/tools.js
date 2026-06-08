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
    description: 'All pages/posts with their SEO status (paginated).',
    inputSchema: {
      page: z.number().int().positive().optional().describe('Page number (1-based).'),
      per_page: z.number().int().min(1).max(100).optional().describe('Items per page.'),
    },
  }, read((a) => client.get('/site/overview', { page: a.page, per_page: a.per_page })));

  server.registerTool('get_site_health', {
    title: 'Get site health',
    description: 'One-call diagnosis: meta gaps, redirects, 404s, chains/loops and scores.',
    inputSchema: {},
  }, read(() => client.get('/site/health')));

  server.registerTool('get_priority_actions', {
    title: 'Get priority actions',
    description: 'Impact-ranked "what to fix first", optionally filtered by focus area.',
    inputSchema: {
      focus: z.string().optional().describe('Optional focus filter (e.g. quick-wins, money-pages, traffic).'),
    },
  }, read((a) => client.get('/priority-actions', { focus: a.focus })));

  server.registerTool('get_meta', {
    title: 'Get post meta',
    description: 'Current SEO meta of one post, its score breakdown (total plus the meta and content legs behind it — so you can see whether the meta or the content is dragging the page down), and structured findings (F39). Use before update_meta.',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/meta`)));

  server.registerTool('get_page_analysis', {
    title: 'Get page analysis (deep dive)',
    description: 'Full per-page SEO audit — the deep dive get_meta is not. Returns the score breakdown (meta vs content legs, the LIVE content score, and a stale flag when the stored/dashboard score is out of date) plus the content analysis: every category and check with status, the top issues each with a ready-made fix tip, and the extracted evidence (heading tree, images, links, word count). Each check is flagged actionable_by_agent — you can fix image-alt issues (via update_image_alt) and the focus keyword (via update_meta); headings/readability/links/length need page-content edits, so report those to the site owner. The human-facing labels and tips are canonical English (content_analysis.language); each check has a stable, language-neutral `code` — present findings to the user in their own language using the codes, do not just echo the English text. Heavier than get_meta (recomputes live).',
    inputSchema: {
      post_id: z.number().int().positive().describe('The post/page id.'),
    },
  }, read((a) => client.get(`/post/${a.post_id}/analysis`)));

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
    description: 'Write SEO meta on a post. Dry-run by default: call without execute to preview the diff + change_token, then call again with execute=true and that change_token to apply.',
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
}
