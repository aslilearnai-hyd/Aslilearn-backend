export function buildAuditSelect(plan, facts) {
  const moduleName = String(facts?.module || plan?.module || 'unknown_module');
  const operation = String(facts?.operation || plan?.operation || 'list').toLowerCase();
  const filter = facts?.filter && typeof facts.filter === 'object' ? facts.filter : {};
  const where = Object.keys(filter).length ? ` WHERE ${Object.keys(filter).join(' AND ')}` : '';

  if (operation === 'count') return `SELECT COUNT(*) FROM ${moduleName}${where}`;
  if (operation === 'distinct') {
    const field = String(facts?.field || plan?.selectFields?.[0] || 'field');
    return `SELECT DISTINCT ${field} FROM ${moduleName}${where}`;
  }
  if (operation === 'aggregate') {
    const g = Array.isArray(facts?.groupBy) ? facts.groupBy.join(', ') : '';
    return `SELECT AGGREGATES FROM ${moduleName}${where}${g ? ` GROUP BY ${g}` : ''}`;
  }
  const cols = Array.isArray(plan?.selectFields) && plan.selectFields.length ? plan.selectFields.join(', ') : '*';
  const lim = Number(plan?.limit) > 0 ? ` LIMIT ${Math.min(100, Number(plan.limit))}` : '';
  return `SELECT ${cols} FROM ${moduleName}${where}${lim}`;
}
