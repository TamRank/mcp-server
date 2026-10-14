/** Golf 3 (14 Oct 2026): PageSpeed in a hosted connection, as light as is safe.
 * plan: start_scan {type:'pagespeed', post_ids}. The bridge reads the site's preview and saves one frozen plan in a
 *   single call; the model shows every page and warning and asks the user.
 * start: start_scan {type:'pagespeed', proposal_id, confirmation:{plan_hash, confirmed:true}}, only after an explicit
 *   yes in chat. The bridge re-reads that exact plan, adds the fixed acknowledgements the site requires and derives the
 *   request ID from the plan hash, so a repeated identical start is the same start and never a second measurement.
 * status: get_scan_status {type:'pagespeed', execution_id} (or proposal_id for the saved plan).
 * The site measures, limits and stores everything (PRO /scans/executions); the VPS decides which connection owns which
 * plan and run. No receipts, recovery, schema scans or automatic retries here. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pagespeedRoute, pagespeedAcks, validPageSpeedProposal, validPageSpeedProgress,
  pageSpeedStartBody, pageSpeedProgress } from './pagespeed-scans.js';
import { limitDetails, limitMessage, indexCheckDefinitions } from './live-checks.js';
import { scanId } from './scan-maintenance.js';

const pageId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_PAGES = 25;

/** The public PageSpeed block a hosted connection gets. The VPS fetched the site's full contract and checked it
 * against exactly what this library supports (route, policy, approval, retries); it passes only these fields, so
 * no internal names reach the model through get_capabilities. */
export function hostedPageSpeedSupport(c) {
  return c !== null && typeof c === 'object' && !Array.isArray(c) && c.max_targets === 25
    && JSON.stringify(c.devices) === JSON.stringify(['mobile', 'desktop'])
    && ['available', 'plan_available', 'read_available'].every(k => typeof c[k] === 'boolean');
}
/** Can this connection plan or start PageSpeed measurements (start_scan)? */
export function hostedPageSpeedOffered(caps) {
  const support = caps?.pagespeed_execution;
  return hostedPageSpeedSupport(support) && (support.plan_available === true || support.available === true);
}
/** Can this connection read PageSpeed plans or results (get_scan_status)? A site may allow reading earlier
 * measurements while planning and starting are off; those results must stay reachable. */
export function hostedPageSpeedReadable(caps) {
  const support = caps?.pagespeed_execution;
  return hostedPageSpeedOffered(caps) || (hostedPageSpeedSupport(support) && support.read_available === true);
}

/** start_scan / get_scan_status for a hosted connection: index checks and PageSpeed, each where the site offers it. */
export function hostedScanDefinitions(siteUrl) {
  const index = indexCheckDefinitions(siteUrl);
  return {
    start_scan: { description: index.start_scan.description, scanStart: true, path: () => '/index-checks',
      schema: { type: z.enum(['index', 'pagespeed']), urls: index.start_scan.schema.urls.optional(),
        post_ids: z.array(pageId).min(1).max(MAX_PAGES).refine(ids => new Set(ids).size === ids.length).optional(),
        proposal_id: scanId.optional(), confirmation: z.object({ plan_hash: digest, confirmed: z.literal(true) }).strict().optional() },
      validate: a => a.type === 'index' ? exact(a, ['type', 'urls'])
        : exact(a, ['type', 'post_ids']) || exact(a, ['type', 'proposal_id', 'confirmation']),
      invalid: a => a.type === 'index' ? 'An index check needs type index and urls only; nothing was sent.'
        : 'PageSpeed needs post_ids (to make a plan), or proposal_id with confirmation (to start an approved plan); nothing was sent.' },
    get_scan_status: { description: index.get_scan_status.description, path: a => '/index-checks/' + a.check_id,
      schema: { type: z.enum(['index', 'pagespeed']), check_id: index.get_scan_status.schema.check_id.optional(),
        proposal_id: scanId.optional(), execution_id: scanId.optional() },
      validate: a => a.type === 'index' ? exact(a, ['type', 'check_id'])
        : exact(a, ['type', 'execution_id']) || exact(a, ['type', 'proposal_id']),
      invalid: a => a.type === 'index' ? 'An index check result needs type index and check_id only; nothing was sent.'
        : 'PageSpeed status needs execution_id (a started measurement) or proposal_id (a saved plan); nothing was sent.' },
  };
}
const exact = (a, keys) => Object.keys(a).length === keys.length && keys.every(k => a[k] !== undefined);

const iso = s => Number.isSafeInteger(s) ? new Date(s * 1000).toISOString() : null;
/** A saved plan as the model shows it to the user: every page, every warning, and how to approve. */
export function hostedPlanView(draft, perPageLimit, saved = false) {
  const p = draft.proposal;
  const expired = draft.state === 'expired';
  return { type: 'pagespeed', proposal_id: draft.proposal_id, plan_hash: draft.proposal_hash, state: draft.state,
    expires_at: iso(p.expires_at), pages: p.targets.map(t => ({ post_id: t.post_id, title: t.title, url: t.url })),
    measurements: p.targets.length * 2, devices: ['mobile', 'desktop'], warnings: p.warnings,
    approval: expired ? 'This plan has expired and can no longer be started. Make a new plan if the user still wants a measurement.'
      // Read back later, the site cannot say whether it was started; never ask again for a plan the user already approved.
      : saved ? 'This is the saved plan. If the user already approved it and it was started, read the measurement with get_scan_status, type pagespeed and the execution_id from that start; '
        + 'repeating the identical start returns that same measurement and never measures twice. If it was never approved, show every page and warning and ask first.'
      : 'Nothing has been measured yet. Show the user every page and warning above and ask whether to start. Only after an explicit yes in this chat: '
        + 'start_scan with type pagespeed, this proposal_id and confirmation {plan_hash, confirmed: true}. '
        + `Each page can be measured at most ${Number.isSafeInteger(perPageLimit) && perPageLimit > 0 ? perPageLimit + ' times' : 'a limited number of times'} a day by an AI assistant; Google's measurement cannot be undone.` };
}

// Before it runs, the dispatch state says more than the measurement state (which stays reserved).
const WAITING = {
  queued: 'The measurement is queued on the site. Queued does not prove the site\'s background task is running; read the status again in a few minutes with get_scan_status, type pagespeed and this execution_id.',
  not_scheduled: 'The site saved this start but did not schedule it, so nothing is being measured. Tell the user; do not start it again.',
  expired: 'This start expired before it ran. Nothing was measured. Make a new plan if the user still wants a measurement.',
  paused: 'The site paused this measurement; nothing is measured until the site resumes it. Tell the user; do not start it again.',
};
const EXPLAIN = {
  reserved: WAITING.queued,
  running: 'The site is measuring these pages now. Read the status again in a few minutes with the same execution_id.',
  blocked: 'The site stopped because it could not tell whether a measurement went through. Nothing is retried automatically; tell the user.',
  completed: 'Done. Each page shows a mobile and a desktop result; a failed device has its error code.',
  cancelled: 'This measurement was cancelled before it finished. Nothing more will be measured for it. The site gives no reason here; a page Google cannot reach (for example a local, private or password-protected address) is cancelled before anything is sent.',
};
/** A started measurement as shown: per page and device, without the site's internal bookkeeping hashes. */
export function hostedProgressView(data) {
  const { runtime_hash, reservation_state, proposal_hash, worker_liveness, limitations, ...shown } = pageSpeedProgress(data);
  const explanation = shown.state === 'reserved' && WAITING[shown.dispatch_state] ? WAITING[shown.dispatch_state] : EXPLAIN[shown.state] ?? EXPLAIN.blocked;
  return { ...shown, explanation };
}

/** Dispatch one hosted PageSpeed call. Returns {ok:data} or {error:[code, message, details]}. */
export async function hostedPageSpeed(canonical, a, { client, capabilities, clientInfo, auditContext }) {
  const support = capabilities?.pagespeed_execution;
  const plan = canonical === 'start_scan' && a.post_ids !== undefined, start = canonical === 'start_scan' && !plan;
  const grant = start ? 'available' : plan || a.proposal_id !== undefined ? 'plan_available' : 'read_available';
  if (!hostedPageSpeedSupport(support) || support[grant] !== true)
    return { error: ['workflow_operation_unavailable', 'PageSpeed measurements are not available for this website or connection. Nothing was sent.'] };
  try {
    if (plan) {
      // The plan is frozen from the site's own preview of exactly these pages, read just now.
      const preview = await client.get('/scans/preview', { type: 'pagespeed', post_ids: a.post_ids.join(',') });
      const revision = preview?.preview_revision;
      if (!digest.safeParse(revision).success)
        return { error: ['pagespeed_incompatible_response', 'The website sent an answer TamRank could not read. No plan was made.', { automatic_retry: false }] };
      // A fresh request ID per plan: a plan measures nothing, and a repeat simply makes another plan.
      const draft = await client.post(pagespeedRoute + '/proposals', { type: 'pagespeed', post_ids: a.post_ids, expected_revision: revision,
        client_request_id: 'mcp-plan-' + randomUUID() });
      if (!validPageSpeedProposal(draft, { post_ids: a.post_ids, expected_revision: revision }))
        return { error: ['pagespeed_incompatible_response', 'The website sent an answer TamRank could not read. Nothing was measured.', { automatic_retry: false }] };
      return { ok: hostedPlanView(draft, capabilities?.scan_limits?.pagespeed_per_url_per_day) };
    }
    if (canonical === 'get_scan_status' && a.proposal_id !== undefined) {
      const draft = await client.get(pagespeedRoute + '/proposals/' + a.proposal_id);
      if (!validPageSpeedProposal(draft, { proposal_id: a.proposal_id }))
        return { error: ['pagespeed_incompatible_response', 'The website sent an answer TamRank could not read.', { automatic_retry: false }] };
      return { ok: hostedPlanView(draft, capabilities?.scan_limits?.pagespeed_per_url_per_day, true) };
    }
    if (start) {
      // Re-read the exact plan the user approved. A changed, expired or unknown plan is never started.
      const draft = await client.get(pagespeedRoute + '/proposals/' + a.proposal_id);
      if (!validPageSpeedProposal(draft, { proposal_id: a.proposal_id }) || draft.proposal_hash !== a.confirmation.plan_hash)
        return { error: ['pagespeed_proposal_mismatch', 'This is not the plan the user approved (it changed or is unknown). Nothing was measured. Make a new plan and ask again.'] };
      if (draft.state !== 'planned')
        return { error: ['pagespeed_proposal_expired', 'This plan has expired. Nothing was measured. Make a new plan and ask the user again.'] };
      const body = pageSpeedStartBody({ proposal_id: a.proposal_id, client_request_id: 'mcp-pagespeed-' + a.confirmation.plan_hash,
        confirmation: { plan_hash: a.confirmation.plan_hash, acknowledgements: pagespeedAcks } }, clientInfo);
      body.confirmation.agent = { name: auditContext?.grantLabel ?? 'unknown' };
      const data = await client.post(pagespeedRoute, body);
      if (!validPageSpeedProgress(data, { proposal_id: a.proposal_id, plan_hash: a.confirmation.plan_hash }))
        return { error: ['pagespeed_incompatible_response', 'The website accepted the start but sent an answer TamRank could not read. The measurement may have started; do not start it again.',
          { automatic_retry: false, proposal_id: a.proposal_id, assistant_note: 'Do not call start_scan again for this proposal_id; tell the user the result is unclear.' }] };
      return { ok: hostedProgressView(data) };
    }
    const data = await client.get(pagespeedRoute + '/' + a.execution_id);
    if (!validPageSpeedProgress(data, { execution_id: a.execution_id }))
      return { error: ['pagespeed_incompatible_response', 'The website sent an answer TamRank could not read.', { automatic_retry: false }] };
    return { ok: hostedProgressView(data) };
  } catch (err) {
    const details = limitDetails(err.data), said = limitMessage(err.code, details);
    if (said) return { error: [err.code, said, { ...details, automatic_retry: false }] };
    const code = typeof err.code === 'string' ? err.code : 'pagespeed_request_failed';
    // Only an explicit "nothing happened" counts as a refusal for a start; anything else may have started.
    if (start && err.data?.outcome_unknown !== false)
      return { error: [code, 'The website did not confirm the start; the measurement may or may not have started. Do not make a new plan.',
        { automatic_retry: false, proposal_id: a.proposal_id,
          assistant_note: 'Only if the user wants: repeat start_scan with exactly the same proposal_id and confirmation. The same start is never measured twice.' }] };
    return { error: [code, `The website turned this down. ${typeof err.message === 'string' ? err.message : ''}`.trim(), { automatic_retry: false }] };
  }
}
