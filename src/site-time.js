// Site-local times to UTC (testronde 14 Oct 2026). PRO stores change_log times (created_at, measured_at) in the
// site's own clock (current_time('mysql')) and rolled_back_at in UTC (gmdate); both leave as 'Y-m-d H:i:s'
// without a zone. An agent that reads them as UTC is off by the site's offset. Every time this bridge shows
// is ISO-8601 UTC with Z; a site-local time whose zone is unknown is left out, never guessed.

const SQL = /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/;
const OFFSET = /^(?:UTC)?([+-])([0-9]{2}):?([0-9]{2})$/;

/** A zone WordPress reports (wp_timezone_string): an IANA name, '+02:00'-style offset or 'UTC'. Null if unusable. */
export function siteZone(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  if (value === 'UTC' || value === 'Z') return { offset: 0 };
  const m = OFFSET.exec(value);
  if (m) { const minutes = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])); return Math.abs(minutes) <= 14 * 60 ? { offset: minutes } : null; }
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return { iana: value }; } catch { return null; }
}

const wallAsUtc = value => { const m = SQL.exec(value); if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ') === value ? ms : null; };
function offsetMinutes(zone, utcMs) {
  if (zone.offset !== undefined) return zone.offset;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone.iana, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  return (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(utcMs / 1000) * 1000) / 60000;
}
const iso = ms => new Date(ms).toISOString().replace(/\.[0-9]{3}Z$/, 'Z');

/** 'Y-m-d H:i:s' in UTC (gmdate) -> ISO with Z. Null for anything else. */
export function utcSqlToIso(value) { const ms = wallAsUtc(value); return ms === null ? null : iso(ms); }

/** 'Y-m-d H:i:s' on the site's clock -> ISO with Z. Null without a usable zone. In the hour a clock is set back
 * the wall time occurs twice; like PHP, this picks the later (post-transition) offset. */
export function siteSqlToIso(value, zone) {
  const wall = wallAsUtc(value); if (wall === null || !zone) return null;
  const first = wall - offsetMinutes(zone, wall) * 60000;
  return iso(wall - offsetMinutes(zone, first) * 60000);
}

/** A UTC day ('Y-m-d') -> the site-clock 'Y-m-d H:i:s' of its first second, for PRO's site-local filters. */
export function utcDayToSiteSql(day, zone) {
  const ms = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(ms) || !zone) return null;
  return new Date(ms + offsetMinutes(zone, ms) * 60000).toISOString().slice(0, 19).replace('T', ' ');
}
