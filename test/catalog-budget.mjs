/** Ceiling for a full tools/list response (JSON characters); every test that measures the catalog uses this.
 * 16,500 since get_outcomes (Oct 2026): a full specialist catalog with every schema mode on measured 16,472.
 * 18,000 since list_changes, live_check and index checks by URL (golf 2b, 14 Oct 2026): the largest
 * catalog (test/workflow-catalog.mjs, specialist schema_rollback) measured 17,557; ~1,100 characters for 2 tools + 2 arguments. */
export const CATALOG_BUDGET = 18000;
