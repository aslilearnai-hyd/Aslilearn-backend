const TARGET_MAX_PERCENT = 12;
const ALERT_PERCENT = 13;
const HARD_CEILING_PERCENT = 15;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function evaluateGenerationCostGuardrail({ currentCost, baselineCost } = {}) {
  const current = positive(currentCost);
  const baseline = positive(baselineCost);
  if (!baseline) {
    return {
      status: 'baseline_required',
      allowed: true,
      baselineCost: 0,
      currentCost: current,
      increasePercent: null,
      targetPercent: TARGET_MAX_PERCENT,
      alertPercent: ALERT_PERCENT,
      hardCeilingPercent: HARD_CEILING_PERCENT,
    };
  }
  const increasePercent = Number((((current - baseline) / baseline) * 100).toFixed(2));
  const hardLimitEnabled = String(process.env.AI_COST_HARD_LIMIT_ENABLED || 'true').toLowerCase() !== 'false';
  const hardExceeded = increasePercent > HARD_CEILING_PERCENT;
  return {
    status: hardExceeded
      ? 'hard_ceiling_exceeded'
      : increasePercent >= ALERT_PERCENT
        ? 'alert'
        : increasePercent > TARGET_MAX_PERCENT
          ? 'investigate'
          : 'within_target',
    allowed: !(hardExceeded && hardLimitEnabled),
    baselineCost: baseline,
    currentCost: current,
    increasePercent,
    targetPercent: TARGET_MAX_PERCENT,
    alertPercent: ALERT_PERCENT,
    hardCeilingPercent: HARD_CEILING_PERCENT,
  };
}

export function resolveCostBaseline(scope = {}) {
  const profile = String(scope.examProfile || scope.productCategory || 'BOARD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  const key = `AI_COST_BASELINE_INR_${profile}`;
  return positive(process.env[key]) || positive(process.env.AI_COST_BASELINE_INR);
}

export function assertGenerationCostWithinGuardrail(cost, scope = {}) {
  const baselineCost = resolveCostBaseline(scope);
  const result = evaluateGenerationCostGuardrail({ currentCost: cost?.inr ?? cost, baselineCost });
  if (!result.allowed) {
    const error = new Error(
      `Generation cost increased ${result.increasePercent}% above baseline, exceeding the ${result.hardCeilingPercent}% ceiling.`,
    );
    error.code = 'AI_COST_HARD_CEILING';
    error.guardrail = result;
    throw error;
  }
  return result;
}
