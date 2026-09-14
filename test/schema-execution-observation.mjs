/** Test-only observation: an uncertain write is never retried or called a pass. */
export async function observeSchemaExecution(call, args, validateReadback, now = () => performance.now()) {
  const started = now();
  const response = await call('execute_change_set', args);
  const observation = {execute_ms: Math.round(now() - started), outcome: response.isError ? 'error' : 'response'};
  let code;
  if (response.isError) {
    try { code = JSON.parse(response.content[0].text).code; } catch {}
    observation.code = typeof code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : 'unreadable_error';
  }
  if (response.isError && ['timeout', 'network_error'].includes(code)) {
    const readStarted = now();
    try {
      const read = await call('get_changes', {kind: 'execution', change_set_id: args.change_set_id});
      let data;
      try { data = JSON.parse(read.content[0].text); } catch {}
      if (read.isError || !validateReadback(data, args.change_set_id, args.confirmation.plan_hash)) {
        observation.readback = 'unverified';
      } else {
        observation.readback = 'verified';
        observation.state = data.record.state;
        observation.items = data.record.item_results.length;
        observation.applied = data.record.item_results.filter(item => item.state === 'applied').length;
        observation.delivered = data.record.item_results.filter(item => item.invalidation === 'delivered').length;
      }
    } catch { observation.readback = 'unavailable'; }
    observation.readback_ms = Math.round(now() - readStarted);
  }
  return {response, observation};
}
