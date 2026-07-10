import { PrismaClient } from '@prisma/client';

// Prevent multiple PrismaClient instances during development (hot reload)
const prisma = globalThis.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

/**
 * Establishes the database connection and logs the status.
 */
export async function connectDatabase() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const env = process.env.NODE_ENV || 'development';
    console.log(`[DATABASE] ✅ Successfully connected to PostgreSQL via Prisma (${env}).`);
  } catch (error) {
    console.error('[DATABASE] ❌ Database connection error:', error);
    process.exit(1);
  }
}

/**
 * Safely disconnects the database client.
 */
export async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
    console.log('[DATABASE] 🛑 Database connection closed gracefully.');
  } catch (error) {
    console.error('[DATABASE] ❌ Error during database disconnection:', error);
  }
}

// Handle graceful shutdown events
const handleShutdown = async (signal) => {
  console.log(`\n[DATABASE] Received ${signal}. Initiating graceful shutdown...`);
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Gracefully disconnect when the Node.js event loop is empty
process.on('beforeExit', async () => {
  await disconnectDatabase();
});

export default prisma;
