const TRANSIENT_ERROR_NAMES = new Set([
  'PoolClearedOnNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoTimeoutError',
]);

export function isMongoTransientError(error) {
  if (!error) return false;

  const labels = error.errorLabels;
  if (labels?.has?.('RetryableWriteError') || labels?.has?.('RetryableReadError')) {
    return true;
  }

  if (TRANSIENT_ERROR_NAMES.has(error.name)) return true;

  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('server monitor timeout') ||
    message.includes('connection pool') ||
    message.includes('interrupted due to')
  );
}

export async function withMongoRetry(fn, { attempts = 3, delayMs = 600 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isMongoTransientError(error) || attempt === attempts) throw error;
      const wait = delayMs * attempt;
      console.warn(
        `[mongo-retry] transient error (attempt ${attempt}/${attempts}), retrying in ${wait}ms:`,
        error?.message || error,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}
