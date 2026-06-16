/** Cost-saver mode: fewer retries, Flash-Lite only, dedup on ~50% of batch variants. */

export function isAiGeneratorCostSaverEnabled() {

  const raw = String(process.env.AI_GENERATOR_COST_SAVER ?? 'true').trim().toLowerCase();

  return raw !== 'false' && raw !== '0' && raw !== 'off';

}

/** Ultra economy: 1 LLM call per variant, no Flash, minimal prompt history, lowest token caps. */

export function isAiGeneratorUltraEconomyEnabled() {

  const raw = String(process.env.AI_GENERATOR_ULTRA_ECONOMY ?? 'false').trim().toLowerCase();

  return raw === 'true' || raw === '1' || raw === 'on';

}

/** Never upgrade batch/recovery runs to Flash when cost saver or ultra economy is on. */

export function shouldUseFlashForAiGeneratorRun({ upgradeRequested = false, recoveryPass = false } = {}) {

  if (isAiGeneratorCostSaverEnabled() || isAiGeneratorUltraEconomyEnabled()) return false;

  return Boolean(upgradeRequested || recoveryPass);

}



/** Local section padding fills gaps — skip expensive Flash retries (default on). */

export function isAiGeneratorSectionPadEnabled() {

  const raw = String(process.env.AI_GENERATOR_SECTION_PAD ?? 'true').trim().toLowerCase();

  return raw !== 'false' && raw !== '0' && raw !== 'off';

}



/** Prioritize 25/25 complete sections over raw speed. */

export function isAiGeneratorBatchQualityEnabled() {

  if (isAiGeneratorCostSaverEnabled()) return false;

  const raw = String(process.env.AI_GENERATOR_BATCH_QUALITY ?? 'true').trim().toLowerCase();

  return raw !== 'false' && raw !== '0' && raw !== 'off';

}



export function isAiGeneratorFastBatchEnabled() {

  if (isAiGeneratorBatchQualityEnabled()) return false;

  const raw = String(process.env.AI_GENERATOR_FAST_BATCH ?? 'true').trim().toLowerCase();

  return raw !== 'false' && raw !== '0' && raw !== 'off';

}



export function isRecoveryPass(extraParams = {}, body = {}) {

  return extraParams?.recoveryPass === true || body?.recoveryPass === true;

}



/**

 * When cost saver is on, only odd batch variants run dedup (≈50% fewer dedup retries).

 * Even variants save the first valid generation without similarity checks.

 */

export function shouldRunDedupForBatchVariant(generationVariant = 0) {

  if (isAiGeneratorUltraEconomyEnabled()) return false;

  if (!isAiGeneratorCostSaverEnabled()) return true;

  const v = Number(generationVariant);

  if (!Number.isFinite(v) || v <= 0) return true;

  return v % 2 === 1;

}



export function getAiGeneratorDedupMaxAttempts(isBatchVariant = false, recovery = false) {

  if (recovery) {

    const recoveryDefault = isAiGeneratorCostSaverEnabled() ? '2' : '5';

    const envRaw = process.env.AI_GENERATOR_RECOVERY_DEDUP_MAX_ATTEMPTS;

    const parsed = Number.parseInt(String(envRaw ?? recoveryDefault), 10);

    return Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : Number(recoveryDefault)));

  }

  const envRaw = process.env.AI_GENERATOR_DEDUP_MAX_ATTEMPTS;

  const costDefault = isAiGeneratorCostSaverEnabled() ? '2' : null;

  const qualityDefault = isBatchVariant && isAiGeneratorBatchQualityEnabled() ? '4' : '4';

  const fastDefault = isBatchVariant && isAiGeneratorFastBatchEnabled() ? '3' : qualityDefault;

  const fallback = costDefault ?? fastDefault;

  const parsed = Number.parseInt(String(envRaw ?? fallback), 10);

  return Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : Number(fallback)));

}



export function getAiGeneratorValidationMaxAttempts(isBatchVariant = false, recovery = false) {

  if (recovery) {

    const recoveryDefault = isAiGeneratorCostSaverEnabled() ? '2' : '5';

    const envRaw = process.env.AI_GENERATOR_RECOVERY_VALIDATION_MAX_ATTEMPTS;

    const parsed = Number.parseInt(String(envRaw ?? recoveryDefault), 10);

    return Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : Number(recoveryDefault)));

  }

  const envRaw = process.env.AI_GENERATOR_VALIDATION_MAX_ATTEMPTS;

  if (isAiGeneratorUltraEconomyEnabled() && !recovery) {
    return 1;
  }

  if (!recovery && isBatchVariant && (isAiGeneratorCostSaverEnabled() || isAiGeneratorSectionPadEnabled())) {
    const padDefault = '1';
    const parsed = Number.parseInt(String(envRaw ?? padDefault), 10);
    return Math.min(3, Math.max(1, Number.isFinite(parsed) ? parsed : Number(padDefault)));
  }

  const requireAll =
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== '0' &&
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== 'off';
  const costDefault = isAiGeneratorCostSaverEnabled() ? (requireAll ? '2' : '2') : null;

  const qualityDefault = isBatchVariant && isAiGeneratorBatchQualityEnabled() ? '4' : '4';

  const fastDefault = isBatchVariant && isAiGeneratorFastBatchEnabled() ? '3' : qualityDefault;

  const fallback = costDefault ?? fastDefault;

  const parsed = Number.parseInt(String(envRaw ?? fallback), 10);

  return Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : Number(fallback)));

}



export function shouldUpgradeFlashOnDedupRetry(isBatchVariant = false, dedupTry = 1, recovery = false) {

  if (isAiGeneratorCostSaverEnabled()) return false;

  if (recovery) return true;

  if (!isBatchVariant) return false;

  if (isAiGeneratorBatchQualityEnabled()) return dedupTry >= 2;

  if (isAiGeneratorFastBatchEnabled()) return dedupTry >= 2;

  return dedupTry >= 3;

}



/** Use Flash from validation attempt 2+ when all sections are required (better completeness). */
export function shouldUpgradeFlashOnValidationAttempt(isBatchVariant = false, attempt = 1, recovery = false) {

  if (isAiGeneratorCostSaverEnabled() || isAiGeneratorUltraEconomyEnabled()) return false;

  if (recovery) return true;

  if (!isBatchVariant) return false;

  if (isAiGeneratorSectionPadEnabled()) return false;

  const requireAll = String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase();
  const allSectionsRequired = requireAll !== 'false' && requireAll !== '0' && requireAll !== 'off';
  if (allSectionsRequired) return attempt >= 2;

  if (isAiGeneratorCostSaverEnabled()) return false;

  if (isAiGeneratorBatchQualityEnabled()) return attempt >= 2;

  return attempt >= 3;

}



export function getBatchDedupThresholds() {

  const batch = Number(process.env.AI_GENERATOR_DEDUP_THRESHOLD);

  const db = Number(process.env.AI_GENERATOR_DEDUP_DB_THRESHOLD);

  const costSaver = isAiGeneratorCostSaverEnabled();

  return {

    batchSamples:

      Number.isFinite(batch) && batch > 0 && batch < 1 ? batch : costSaver ? 0.93 : 0.86,

    dbRecords: Number.isFinite(db) && db > 0 && db < 1 ? db : costSaver ? 0.98 : 0.96,

  };

}

/** When true (default with cost saver), batch slots never re-call Gemini for uniqueness/similarity. */
export function shouldEnforceBatchUniquenessRetries() {
  if (isAiGeneratorCostSaverEnabled() || isAiGeneratorUltraEconomyEnabled()) return false;
  const raw = String(process.env.AI_GENERATOR_ENFORCE_BATCH_UNIQUENESS ?? 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

/** Max outer retries per batch slot (uniqueness / slot recovery). Default 1 = one Gemini call per record. */
export function getBatchSlotMaxAttempts() {
  if (isAiGeneratorUltraEconomyEnabled()) return 1;
  const envRaw =
    process.env.BOOK_GENERATOR_SLOT_MAX_ATTEMPTS ||
    process.env.AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS;
  const parsed = Number.parseInt(String(envRaw ?? '1'), 10);
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(5, parsed);
  return shouldEnforceBatchUniquenessRetries() ? 3 : 1;
}

/** Max Gemini re-generations for single-record uniqueness (AI Generator API). Default 1 with cost saver. */
export function getUniquenessMaxAttempts() {
  const envRaw = process.env.AI_GENERATOR_UNIQUENESS_MAX_ATTEMPTS;
  const parsed = Number.parseInt(String(envRaw ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(5, parsed);
  return shouldEnforceBatchUniquenessRetries() ? 3 : 1;
}

