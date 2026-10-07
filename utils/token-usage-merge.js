/** Merge token snapshots returned by multiple sequential generation scopes. */
export function mergeTokenUsageSnapshots(snapshots = [], label = 'combined-generation') {
  const calls = [];
  const totals = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callCount: 0,
  };

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    if (Array.isArray(snapshot.calls)) calls.push(...snapshot.calls);
    const source = snapshot.totals && typeof snapshot.totals === 'object' ? snapshot.totals : {};
    totals.promptTokens += Number(source.promptTokens) || 0;
    totals.completionTokens += Number(source.completionTokens) || 0;
    totals.totalTokens += Number(source.totalTokens) || 0;
    totals.callCount += Number(source.callCount) || 0;
  }

  // Old snapshots occasionally omitted totals while still carrying per-call data.
  if (calls.length && totals.callCount === 0) {
    totals.promptTokens = calls.reduce((sum, row) => sum + (Number(row?.promptTokens) || 0), 0);
    totals.completionTokens = calls.reduce(
      (sum, row) => sum + (Number(row?.completionTokens) || 0),
      0,
    );
    totals.totalTokens = calls.reduce((sum, row) => {
      const prompt = Number(row?.promptTokens) || 0;
      const completion = Number(row?.completionTokens) || 0;
      return sum + (Number(row?.totalTokens) || prompt + completion);
    }, 0);
    totals.callCount = calls.length;
  }

  return {
    label,
    calls,
    totals,
  };
}
