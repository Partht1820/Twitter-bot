import Fastify from 'fastify';
import { CONFIG } from './config.js';
import { connectDatabase } from './database.js';

const server = Fastify({
  logger: true,
  trustProxy: true
});

// Global error handler
server.setErrorHandler((error, request, reply) => {
  server.log.error(error);
  reply.status(error.statusCode || 500).send({
    success: false,
    message: error.message || 'Internal Server Error'
  });
});

// Not found handler
server.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    success: false,
    message: 'Route not found.'
  });
});

// Health check endpoint
server.get('/', async (request, reply) => {
  return {
    status: 'online',
    service: 'Telegram OTP Bot V2'
  };
});

/**
 * Initializes and starts the Fastify server.
 */
const start = async () => {
  try {
    // Ensure database connection is established before starting the server
    await connectDatabase();

    await server.listen({
      port: CONFIG.server.port,
      host: CONFIG.server.host
    });

    server.log.info(`[SERVER] 🚀 Server started successfully on http://${CONFIG.server.host}:${CONFIG.server.port}`);
  } catch (error) {
    server.log.error(error, '[SERVER] ❌ Failed to start the server');
    process.exit(1);
  }
};

start();

export default server;
