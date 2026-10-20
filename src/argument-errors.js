/** Argument refusals that name the argument and the form it takes, so one retry is enough. Never echoes a value. */
const id = 'an id copied from an earlier answer (8-4-4-4-12 hexadecimal characters)';
const window = 'two dates as YYYY-MM-DD/YYYY-MM-DD covering 7, 28 or 90 days';
const FORMATS = {
  since: 'a date as YYYY-MM-DD on the site\'s own calendar, for example 2026-10-19',
  deadline: 'a date as YYYY-MM-DD, or empty to clear it',
  window, compare_to: window,
  change_set_id: id, proposal_id: id, execution_id: id, action_id: id, item_ids: id,
  client_request_id: '8 to 80 letters, digits or . _ : -, starting with a letter or digit',
  expected_revision: 'a 64-character revision copied from an earlier answer', snapshot_hash: 'a 64-character hash copied from an earlier answer',
  plan_hash: 'the 64-character plan_hash copied from the plan', change_token: 'the change_token copied from the plan',
  url: 'a full address starting with https:// (or http://)', urls: 'full addresses on this site starting with https:// (or http://)',
  source_url: 'a path on this site starting with /', target_url: 'a full address, or a path starting with /',
  social_image: 'a full image address starting with https://',
  cursor: 'the next_cursor of the previous page, unchanged', work_id: 'a work_id copied from the work queue',
};

function describe(issue) {
  const path = issue.path, last = path.filter(p => typeof p === 'string').at(-1);
  const field = path.map((p, i) => typeof p === 'number' ? `[${p}]` : (i ? '.' : '') + p).join('') || 'arguments';
  if (issue.code === 'unrecognized_keys') {
    // Argument names come from the caller: show a few, each cut short.
    const shown = issue.keys.slice(0, 5).map(k => k.length > 40 ? k.slice(0, 40) + '…' : k).join(', ');
    return `unknown argument${issue.keys.length > 1 ? 's' : ''} ${shown}${issue.keys.length > 5 ? ` (and ${issue.keys.length - 5} more)` : ''}`
      + (path.length ? ` in ${field.slice(0, 80)}` : '');
  }
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return `${field} is required`;
  if (issue.code === 'invalid_type') return `${field} must be ${issue.expected === 'integer' ? 'a whole number' : `a ${issue.expected}`}`;
  if (issue.code === 'invalid_enum_value') return `${field} must be one of ${issue.options.join(', ')}`;
  if (issue.code === 'invalid_literal') return `${field} must be ${JSON.stringify(issue.expected)}`;
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    const bound = issue.code === 'too_small' ? 'at least' : 'at most', n = Number(issue.code === 'too_small' ? issue.minimum : issue.maximum);
    if (issue.type === 'array') return `${field} needs ${bound} ${n} item${n === 1 ? '' : 's'}`;
    if (issue.type === 'string') return `${field} must be ${bound} ${n} character${n === 1 ? '' : 's'}`;
    return `${field} must be ${bound} ${n}`;
  }
  if (FORMATS[last]) return `${field} must be ${FORMATS[last]}`;
  if (issue.code === 'invalid_union') return `${field} does not match any accepted form`;
  return `${field} has a value in the wrong form`;
}

export function invalidArgumentsMessage(error) {
  const said = [...new Set((error?.issues ?? []).map(describe))];
  if (!said.length) return 'Invalid or unknown tool arguments; nothing was sent.';
  const list = `${said.slice(0, 3).join('; ')}${said.length > 3 ? ` (and ${said.length - 3} more)` : ''}`;
  return `Invalid tool arguments: ${list.length > 600 ? list.slice(0, 600) + '…' : list}; nothing was sent.`;
}
