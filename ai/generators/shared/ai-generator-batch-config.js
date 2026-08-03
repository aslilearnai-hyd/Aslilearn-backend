/**
 * Great-quality mode: Flash primary, LLM section repair (no template pad), more retries.
 * Default on when AI_GENERATOR_COST_SAVER=false unless AI_GENERATOR_GREAT_QUALITY=off.
 */
export function isAiGeneratorGreatQualityEnabled() {
  const raw = String(process.env.AI_GENERATOR_GREAT_QUALITY ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  return !isAiGeneratorCostSaverEnabled();
}

/** Cost-saver mode: fewer retries, Flash-Lite only, dedup on ~50% of batch variants.
 *  DEFAULT OFF — quality-first. Set AI_GENERATOR_COST_SAVER=true to trade quality for cost. */
export function isAiGeneratorCostSaverEnabled() {

  const raw = String(process.env.AI_GENERATOR_COST_SAVER ?? 'false').trim().toLowerCase();

  return raw === 'true' || raw === '1' || raw === 'on';

}

/** Ultra economy: 1 LLM call per variant, no Flash, minimal prompt history, lowest token caps. */

export function isAiGeneratorUltraEconomyEnabled() {

  const raw = String(process.env.AI_GENERATOR_ULTRA_ECONOMY ?? 'false').trim().toLowerCase();

  return raw === 'true' || raw === '1' || raw === 'on';

}

/** Flash-Lite-only cap. DEFAULT ON — all tiers use gemini-3.1-flash-lite.
 *  Set AI_GENERATOR_FLASH_LITE_ONLY=false only if you intentionally want Pro. */
export function isAiGeneratorFlashLiteOnlyEnabled() {
  const raw = String(process.env.AI_GENERATOR_FLASH_LITE_ONLY ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export function getAiGeneratorGeminiModel() {
  return 'gemini-3.1-flash-lite';
}

/** Language subjects also stay on Flash-Lite 3.1 (never Pro). */
export function getAiGeneratorLanguageSubjectGeminiModel() {
  return 'gemini-3.1-flash-lite';
}

export function isAiGeneratorLanguageSubjectFlashOverrideEnabled() {
  const raw = String(process.env.AI_GENERATOR_LANGUAGE_SUBJECT_FLASH ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** Never upgrade batch/recovery runs to Flash when cost saver, ultra economy, or flash-lite-only is on. */

export function shouldUseFlashForAiGeneratorRun({ upgradeRequested = false, recoveryPass = false } = {}) {

  if (isAiGeneratorFlashLiteOnlyEnabled() || isAiGeneratorCostSaverEnabled() || isAiGeneratorUltraEconomyEnabled()) {

    return false;

  }

  return Boolean(upgradeRequested || recoveryPass);

}



/** Local section padding fills gaps with template text. DEFAULT OFF — gaps now trigger
 *  LLM repair or fail the slot instead of saving generic filler. Set
 *  AI_GENERATOR_SECTION_PAD=true to re-enable padding (not recommended for board content). */

export function isAiGeneratorSectionPadEnabled() {

  const raw = String(process.env.AI_GENERATOR_SECTION_PAD ?? 'false').trim().toLowerCase();

  return raw === 'true' || raw === '1' || raw === 'on';

}



/** When true (default), incomplete generations are not saved via scaffold pad or batch economy fallbacks. */
export function isAiGeneratorCompleteOnlySaveEnabled() {
  const raw = String(process.env.AI_GENERATOR_COMPLETE_ONLY_SAVE ?? 'true').trim().toLowerCase();
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

    // Recovery re-runs already-failed records, so it is the path the bulk
    // backfill uses — capped at 2 like the normal path. Left uncapped it paired
    // with recovery validation for 5 x 5 = 25 full generations (~12 INR/record),
    // worse than the 16 this change set out to remove.
    return Math.min(2, Math.max(1, Number.isFinite(parsed) ? parsed : Number(recoveryDefault)));

  }

  const envRaw = process.env.AI_GENERATOR_DEDUP_MAX_ATTEMPTS;

  const costDefault = isAiGeneratorCostSaverEnabled() ? '2' : null;

  const qualityDefault = isBatchVariant && isAiGeneratorBatchQualityEnabled() ? '4' : '4';

  const fastDefault = isBatchVariant && isAiGeneratorFastBatchEnabled() ? '3' : qualityDefault;

  const fallback = costDefault ?? fastDefault;

  const parsed = Number.parseInt(String(envRaw ?? fallback), 10);

  const attempts = Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : Number(fallback)));

  /*
   * Dedup retries are the SECOND full-record multiplier. They stack with the
   * validation attempts above, so the old defaults allowed 4 x 4 = 16 full
   * generations for one saved record.
   *
   * Each dedup retry re-emits the entire record because the draft looked too
   * similar to an existing one — but assemble.js already pushes uniqueness into
   * the prompt itself (buildV2VariantHint per-variant foci, the avoid-list of up
   * to 40 prior problems, and findOverusedTerms theme dedup). That front-loaded
   * differentiation is far cheaper than paying for a re-roll, so the extra
   * attempts have a low hit rate for their cost.
   *
   * Capped at 2. Combined with COST_CAPPED_FULL_ATTEMPTS this bounds a record at
   * 4 full generations worst case (~2 INR) instead of 16 (~8 INR), with the
   * typical path being a single generation plus a targeted repair (~0.57 INR).
   */
  const COST_CAPPED_DEDUP_ATTEMPTS = 2;
  return Math.min(attempts, COST_CAPPED_DEDUP_ATTEMPTS);

}



export function getAiGeneratorValidationMaxAttempts(isBatchVariant = false, recovery = false) {

  if (recovery) {

    const recoveryDefault = isAiGeneratorCostSaverEnabled() ? '2' : '5';

    const envRaw = process.env.AI_GENERATOR_RECOVERY_VALIDATION_MAX_ATTEMPTS;

    const parsed = Number.parseInt(String(envRaw ?? recoveryDefault), 10);

    // Capped at 3 (one more than the normal path — a record that already failed
    // deserves a little more headroom) and paired with dedup capped at 2, so
    // recovery is bounded at 6 full generations instead of 25.
    return Math.min(3, Math.max(1, Number.isFinite(parsed) ? parsed : Number(recoveryDefault)));

  }

  const envRaw = process.env.AI_GENERATOR_VALIDATION_MAX_ATTEMPTS;

  if (isAiGeneratorUltraEconomyEnabled() && !recovery) {
    if (isBatchVariant) {
      const parsed = Number.parseInt(String(envRaw ?? '2'), 10);
      return Math.min(3, Math.max(2, Number.isFinite(parsed) ? parsed : 2));
    }
    return 1;
  }

  if (
    !recovery &&
    isBatchVariant &&
    !isAiGeneratorGreatQualityEnabled() &&
    (isAiGeneratorCostSaverEnabled() || isAiGeneratorSectionPadEnabled())
  ) {
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
  let attempts = Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : Number(fallback)));

  /*
   * Completeness is enforced on EVERY path, batch included.
   *
   * Previously this branch carried `!isBatchVariant`, which exempted batch from
   * the strict path. Batch produces ~90% of the corpus, so the one path that
   * mattered was the one path not held to completeness — that is why the July
   * 2026 census found 3,271 incomplete records (16% of 20,356), concentrated in
   * the high-volume batch tools.
   *
   * But completeness is NOT bought with full-record retries any more. Re-rolling
   * a 12-section record to fix 3 thin sections costs a whole generation
   * (~3k output tokens, ~0.5 INR on 3.1 Flash-Lite) and typically loses a
   * DIFFERENT three sections, so attempts 2..4 were largely wasted spend. The
   * old 4x4 dedup x validation ceiling could reach 16 generations (~8 INR) for
   * one saved record.
   *
   * Gaps are now closed by repairMissingSectionsViaLlm, which re-emits only the
   * missing sections (~500 output tokens, ~0.07 INR). So we cap full-record
   * attempts low and let targeted repair carry completeness.
   */
  const COST_CAPPED_FULL_ATTEMPTS = 2;
  if (isAiGeneratorCompleteOnlySaveEnabled() && !recovery) {
    attempts = Math.min(attempts, COST_CAPPED_FULL_ATTEMPTS);
  }

  return attempts;

}



export function shouldUpgradeFlashOnDedupRetry(isBatchVariant = false, dedupTry = 1, recovery = false) {

  if (isAiGeneratorFlashLiteOnlyEnabled() || isAiGeneratorCostSaverEnabled()) return false;

  if (recovery) return true;

  if (!isBatchVariant) return false;

  if (isAiGeneratorBatchQualityEnabled()) return dedupTry >= 2;

  if (isAiGeneratorFastBatchEnabled()) return dedupTry >= 2;

  return dedupTry >= 3;

}



/** Use Flash from validation attempt 2+ when all sections are required (better completeness). */
export function shouldUpgradeFlashOnValidationAttempt(isBatchVariant = false, attempt = 1, recovery = false) {

  if (isAiGeneratorFlashLiteOnlyEnabled() || isAiGeneratorCostSaverEnabled() || isAiGeneratorUltraEconomyEnabled()) {

    return false;

  }

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

/** Max outer retries per batch slot (uniqueness / slot recovery). */
export function getBatchSlotMaxAttempts() {
  const envRaw =
    process.env.BOOK_GENERATOR_SLOT_MAX_ATTEMPTS ||
    process.env.AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS;
  const parsed = Number.parseInt(String(envRaw ?? ''), 10);
  const fromEnv = Number.isFinite(parsed) && parsed > 0 ? Math.min(5, parsed) : null;
  if (isAiGeneratorUltraEconomyEnabled()) {
    return fromEnv ?? 1;
  }
  if (fromEnv) return fromEnv;
  return shouldEnforceBatchUniquenessRetries() ? 3 : 1;
}

/** Book-Based Generator: default 3 slot attempts (503 / validation / duplicate recovery). */
export function getBookBatchSlotMaxAttempts() {
  const envRaw = process.env.BOOK_GENERATOR_SLOT_MAX_ATTEMPTS;
  const parsed = Number.parseInt(String(envRaw ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(5, parsed);
  return 3;
}

/** Max Gemini re-generations for single-record uniqueness (AI Generator API). Default 1 with cost saver. */
export function getUniquenessMaxAttempts() {
  const envRaw = process.env.AI_GENERATOR_UNIQUENESS_MAX_ATTEMPTS;
  const parsed = Number.parseInt(String(envRaw ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(5, parsed);
  return shouldEnforceBatchUniquenessRetries() ? 3 : 1;
}

