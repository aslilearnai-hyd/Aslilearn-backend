/** Shared Mongoose / MongoDB driver options for Atlas resilience. */
export const MONGOOSE_CONNECT_OPTIONS = {
  serverSelectionTimeoutMS: 30_000,
  socketTimeoutMS: 45_000,
  connectTimeoutMS: 30_000,
  heartbeatFrequencyMS: 10_000,
  maxPoolSize: 10,
  minPoolSize: 2,
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
