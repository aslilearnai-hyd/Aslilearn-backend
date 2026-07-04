/** Shared Mongoose / MongoDB driver options for Atlas resilience. */
export const MONGOOSE_CONNECT_OPTIONS = {
  // Fail fast when Atlas is unreachable (don't hang UI for minutes).
  serverSelectionTimeoutMS: 15_000,
  connectTimeoutMS: 15_000,
  // Long AI batches / slow queries must not kill idle sockets at 45s.
  socketTimeoutMS: 0,
  heartbeatFrequencyMS: 10_000,
  maxPoolSize: 20,
  minPoolSize: 2,
  maxIdleTimeMS: 60_000,
  retryWrites: true,
  retryReads: true,
};

export function attachMongooseConnectionListeners(connection) {
  connection.on('error', (err) => {
    console.error('MongoDB connection error:', err?.message || err);
  });
  connection.on('disconnected', () => {
    console.warn('MongoDB disconnected — driver will attempt to reconnect');
  });
  connection.on('reconnected', () => {
    console.log('MongoDB reconnected');
  });
}
