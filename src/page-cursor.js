/** get_outcomes and list_changes page by number on the site. Their next_cursor is opaque and bound to the
 * filters, like the cursors the site signs for the other reads: following it with other filters is refused. */
import {createHash} from 'node:crypto';

const FILTERS = ['change_set_id', 'status', 'post_id', 'url', 'since', 'limit'];
const tag = (tool, a) => createHash('sha256').update(JSON.stringify([tool, ...FILTERS.map(k => a[k] ?? null)])).digest('hex').slice(0, 16);
const shape = /^pc1\.([1-9][0-9]{0,5})\.([a-f0-9]{16})$/;
// A bare page number is what these tools returned before 20 Oct 2026; accepted so a read in progress survives a deploy.
const legacy = /^[1-9][0-9]{0,5}$/;

export const pageCursor = (tool, a, page) => `pc1.${page}.${tag(tool, a)}`;
export const validPageCursor = (tool, a) => a.cursor === undefined || legacy.test(a.cursor)
  || (shape.test(a.cursor) && a.cursor.match(shape)[2] === tag(tool, a));
export const pageFromCursor = cursor => cursor === undefined ? undefined : legacy.test(cursor) ? cursor : cursor.match(shape)?.[1];
export const invalidPageCursor = (tool, a) => shape.test(a.cursor)
  ? `cursor belongs to a read with other filters; repeat the filters of that read, or start again without cursor; nothing was sent.`
  : `cursor must be a next_cursor from ${tool}; nothing was sent.`;
