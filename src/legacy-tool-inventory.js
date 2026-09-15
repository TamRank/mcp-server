/**
 * Handler-free V1.1 compatibility inventory.
 *
 * These descriptors preserve the legacy names and argument contracts long enough
 * for migration clients to discover them. They must never grow request handlers:
 * the workflow registry either maps one of five read aliases to a V2 definition or
 * installs the standard workflow_upgrade_required refusal.
 */
import {z} from 'zod';

const positiveId=()=>z.number().int().positive();
const control={execute:z.boolean().optional(),change_token:z.string().optional()};
const metaFields={
  meta_title:z.string().optional(),meta_description:z.string().optional(),focus_keyword:z.string().optional(),
  secondary_keywords:z.array(z.string()).optional(),custom_slug:z.string().optional(),canonical_url:z.string().optional(),
  social_title:z.string().optional(),social_description:z.string().optional(),social_image:z.string().optional(),
  noindex:z.boolean().optional(),nofollow:z.boolean().optional(),
};
const redirectType=z.enum(['301','302','307','410']);
const descriptor=(name,title,description,inputSchema={})=>({name,config:{title,description,inputSchema}});

export function legacyToolInventory(){
  return [
    descriptor('get_site_context','Get site context','Brand, language and site type.'),
    descriptor('get_capabilities','Get capabilities','Licence tier, scopes, credits, GSC state, rate limit, feature counts.',{
      verbose:z.boolean().optional().describe('Return the full feature registry instead of counts + unavailable.'),
    }),
    descriptor('get_site_overview','Get site overview','Paginated triage list of managed pages: scores, meta flags.',{
      page:positiveId().optional().describe('Page number (1-based).'),per_page:z.number().int().min(1).max(100).optional().describe('Items per page.'),
    }),
    descriptor('get_site_health','Get site health','Meta gaps, redirects, 404s, chains and category scores.',{
      include_visual:z.boolean().optional().describe('Return the inline score-card image (default true).'),
    }),
    descriptor('get_priority_actions','Get priority actions','Impact-ranked what to fix first. refresh=true recomputes.',{
      focus:z.string().optional().describe('Optional focus filter (e.g. quick-wins, money-pages, traffic).'),
      refresh:z.boolean().optional().describe('Recompute the ranking first (throttled).'),
    }),
    descriptor('get_next_action','Get the single best next action','The single best next action: type, target, and its tool. refresh=true recomputes.',{
      refresh:z.boolean().optional().describe('Recompute the ranking first (throttled).'),
    }),
    descriptor('get_issues','Get the issues list','Site-wide roll-up per problem type: severity, count, impact.',{
      severity:z.string().optional().describe('Filter to these severities, comma-separated (high, medium, low).'),
      type:z.string().optional().describe('Filter to these issue types, comma-separated (e.g. grp_404,not_indexed). Omit for all.'),
      limit:z.number().int().min(1).max(100).optional().describe('Max issue rows (default 50; the list is one row per type, so usually small).'),
    }),
    descriptor('search_posts','Search / filter the managed pages','Find managed pages by term, type, score bounds or missing meta.',{
      q:z.string().optional().describe('Title or slug term.'),post_type:z.string().optional().describe('One managed post type.'),
      score_below:z.number().int().min(0).max(100).optional().describe('Score below this.'),score_above:z.number().int().min(0).max(100).optional().describe('Score above this.'),
      missing_meta:z.enum(['title','description','any']).optional().describe('Required missing meta field.'),unscored:z.boolean().optional().describe('Only never-audited pages.'),
      orderby:z.enum(['date','score']).optional().describe('Default date.'),order:z.enum(['asc','desc']).optional().describe('Default desc.'),
      page:z.number().int().min(1).optional(),per_page:z.number().int().min(1).max(100).optional().describe('Default 25.'),
    }),
    descriptor('get_meta','Get post meta',"One post's SEO meta, its stored score legs, and findings.",{post_id:positiveId().describe('The post/page id.')}),
    descriptor('get_page_analysis','Get page analysis (deep dive)','Full audit of one page: score legs, each check with code and fix tip.',{
      post_id:positiveId().describe('The post/page id.'),include_visual:z.boolean().optional().describe('Return an inline SEO score donut image (default true).'),
    }),
    descriptor('get_site_analysis','Analyse the site (deep, multi-page)','Deep pass over the lowest-scoring pages (max 5), with fixes.',{
      limit:z.number().int().min(1).max(5).optional().describe('How many of the lowest-scoring pages to deep-analyse (default 3, max 5).'),
      post_type:z.string().optional().describe('Restrict to one managed post type (e.g. page, post).'),
    }),
    descriptor('get_schema',"Get a page's schema","One page's JSON-LD: type, source, validity, next action.",{post_id:positiveId().describe('The post/page id.')}),
    descriptor('get_schema_overview','Get site-wide schema coverage','Site-wide schema coverage, types, not_yet_detected_ids.'),
    descriptor('get_schema_settings','Get site schema identity','The site-wide Organization/WebSite identity.'),
    descriptor('get_topical_authority','Get topical authority map','Topical-authority map: pillar, clusters, coverage, gaps.'),
    descriptor('get_redirects','List redirects','Existing redirects with their chain status.',{
      limit:z.number().int().min(1).max(200).optional(),offset:z.number().int().min(0).optional(),
    }),
    descriptor('get_redirect_chains','Get redirect chains and loops','Live redirect chains and loops; each chain carries a fix.'),
    descriptor('get_404s','List 404s','Open 404s per URL with hits, first_seen and is_new. Feeds resolve_404.',{
      limit:z.number().int().min(1).max(100).optional(),since:z.string().optional().describe('Newness baseline (ISO-8601 or site datetime). Defaults to the last signal scan; is_new is first_seen >= since.'),
      sort:z.enum(['hits','newest']).optional().describe('hits (default, lifetime hits) or newest (first seen first).'),
    }),
    descriptor('get_signals','Get open signals','Open detector signals: window, delta, evidence, score and the tool that acts on each.',{
      limit:z.number().int().min(1).max(50).optional().describe('Max signals (default 20).'),type:z.string().optional().describe('Filter to one exact signal type (e.g. tech_404_new).'),
      subject_id:z.number().int().min(0).optional().describe('Filter to one subject (post id; 0 is site-wide).'),
    }),
    descriptor('get_audit_log','Get audit log','Manual edits and agent actions, with the audit id for rollback.',{
      limit:z.number().int().min(1).max(50).optional(),post_id:positiveId().optional().describe('Filter to one post.'),source:z.enum(['manual','agent']).optional().describe('Filter by origin.'),
    }),
    descriptor('get_changes','Get changes since a timestamp','Changes since a timestamp, oldest first. Dedupe by source+id.',{
      since:z.string().describe("Lower bound, exclusive — ISO-8601 (2026-06-01T00:00:00Z) or unix timestamp. Use the previous response's next_since to continue."),
      limit:z.number().int().min(1).max(100).optional().describe('Max entries (default 25).'),post_id:positiveId().optional().describe('Filter to one post.'),
      source:z.enum(['manual','agent']).optional().describe('Filter by origin.'),
    }),
    descriptor('get_images_missing_alt','Get images missing alt text','Images with no alt text, returned with the image to caption.',{
      limit:z.number().int().min(1).max(50).optional().describe('Max images (default 10).'),offset:z.number().int().min(0).optional().describe('Pagination offset.'),
      include_images:z.boolean().optional().describe('Embed each image so a vision model can see it (default true). Set false for a fast text-only listing.'),
    }),
    descriptor('get_gsc_pages','Get Search Console pages','Search Console pages: clicks, impressions, CTR, position.',{
      period:z.number().int().optional().describe('Look-back window in days: 7, 28 or 90 (default 28).'),
    }),
    descriptor('get_gsc_keywords','Get Search Console keywords','Search Console keywords for one page, with uplift potential.',{
      page_url:z.string().describe('The full page URL (as returned by get_gsc_pages).'),period:z.number().int().optional().describe('7, 28 or 90 days (default 28).'),
    }),
    descriptor('get_keyword_stability','Get keyword position stability','Per-keyword position stability and trend for one page.',{
      page_url:z.string().describe('The full page URL (as returned by get_gsc_pages).'),
    }),
    descriptor('get_index_status','Get page index status','Cached Google index status of one page, with staleness.',{post_id:positiveId().describe('The post/page id.')}),
    descriptor('get_site_index','Get site index rollup','Site-wide index coverage from the last scan.'),
    descriptor('update_meta','Update post meta','Write SEO meta. Dry-run first; execute persists a fresh score by default.',{
      post_id:positiveId().describe('The post/page id.'),...metaFields,
      secondary_keywords:z.array(z.string()).optional().describe('Up to 4.'),rescore:z.boolean().optional().describe('Fresh audit on execute (default true).'),
      execute:z.boolean().optional().describe('true + change_token applies.'),change_token:z.string().optional().describe('Token from dry-run.'),
    }),
    descriptor('update_meta_batch','Update post meta in a batch','Write meta on 1-25 posts. One token binds the set; each item gets an audit_id.',{
      items:z.array(z.object({post_id:positiveId(),...metaFields})).min(1).max(25).describe('Unique post per item.'),
      rescore:z.boolean().optional().describe('Fresh audit per item (default true).'),execute:z.boolean().optional().describe('true + change_token applies.'),
      change_token:z.string().optional().describe('Token binding the dry-run set.'),
    }),
    descriptor('manage_redirects','Manage redirects','Create, update or delete a redirect. Dry-run by default.',{
      action:z.enum(['create','update','delete']).describe('What to do.'),id:positiveId().optional().describe('Redirect id (required for update/delete).'),
      source_url:z.string().optional().describe('Source path, e.g. /old-page (create/update).'),target_url:z.string().optional().describe('Target URL (create/update).'),
      redirect_type:redirectType.optional().describe('301/302 (FREE) or 307/410 (PRO).'),...control,
    }),
    descriptor('resolve_404','Resolve a 404','Turn a logged 404 into a redirect. Dry-run by default.',{
      url:z.string().describe('The 404 URL to resolve (e.g. /old-page).'),target_url:z.string().describe('Where it should redirect to.'),redirect_type:redirectType.optional(),...control,
    }),
    descriptor('rollback','Roll back an action','Undo a logged agent action by its audit id. Dry-run by default.',{
      action_id:positiveId().describe('The audit id of the action to undo.'),...control,
    }),
    descriptor('update_image_alt','Update image alt text','Write alt text on an image attachment. Dry-run by default.',{
      image_id:positiveId().describe('The image attachment id (from get_images_missing_alt).'),alt_text:z.string().describe('The alt text to write.'),
      execute:z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),change_token:z.string().optional().describe('The change_token returned by the dry run.'),
    }),
    descriptor('detect_schema','Detect schema for a page','Detect and store one page\'s schema type. Applies immediately.',{
      post_id:positiveId().describe('The post/page id (e.g. from get_schema_overview not_yet_detected_ids).'),
    }),
    descriptor('update_schema_settings','Update site schema identity','Write the site-wide Organization/WebSite identity. Dry-run.',{
      entity_type:z.enum(['Organization','LocalBusiness']).optional(),organization_name:z.string().optional(),website_url:z.string().optional().describe('Canonical URL.'),
      logo_url:z.string().optional().describe('Absolute logo URL.'),email:z.string().optional().describe('Public email.'),telephone:z.string().optional().describe('Public phone.'),
      address:z.object({street:z.string().optional(),postal_code:z.string().optional(),city:z.string().optional(),country:z.string().optional().describe('2-letter code.')}).optional().describe('PostalAddress fields.'),
      social_profiles:z.array(z.string()).optional().describe('sameAs URLs.'),execute:z.boolean().optional().describe('true + change_token applies.'),change_token:z.string().optional().describe('Token from dry-run.'),
    }),
    descriptor('request_recrawl','Request Google recrawl of a page','Ask Google to recrawl one page. Costs AI credits. Dry-run.',{
      post_id:positiveId().describe('The post/page id.'),execute:z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),
      change_token:z.string().optional().describe('The change_token returned by the dry run.'),
    }),
    descriptor('start_index_scan','Start a site-wide index scan','Bulk-check unchecked and stale URLs. Costs credits. Dry-run.',{
      execute:z.boolean().optional().describe('Set true (with change_token) to apply. Omit for a dry run.'),change_token:z.string().optional().describe('The change_token returned by the dry run.'),
    }),
    descriptor('get_index_scan_status','Index scan progress (live poll)','Progress of a running index scan; live-polls while one runs.'),
    descriptor('rescore_page','Re-score a page (persist a fresh audit)',"Recompute and persist a page's score. The verify step after a write.",{
      post_id:positiveId().describe('The post/page id to re-score.'),
    }),
    descriptor('get_pagespeed','Get PageSpeed for a page','PageSpeed for one page: score, Core Web Vitals, opportunities.',{
      post_id:positiveId().describe('The post/page id.'),strategy:z.enum(['mobile','desktop']).optional().describe('Device strategy (default mobile).'),
      refresh:z.boolean().optional().describe('Run a fresh live test instead of the cache (slow). Default false.'),include_visual:z.boolean().optional().describe('Return an inline PageSpeed score gauge image (default true).'),
    }),
    descriptor('start_pagespeed_scan','Start a bulk PageSpeed scan','Queue a background PageSpeed scan; returns a scan_id.',{
      limit:z.number().int().min(1).max(200).optional().describe('Scan only the N lowest-scoring pages (default: all managed pages, capped at 200).'),
      post_type:z.string().optional().describe('Restrict to one managed post type (e.g. page, post).'),
    }),
    descriptor('get_pagespeed_scan_status','PageSpeed scan progress','Progress of the background PageSpeed scan.'),
  ];
}
