// Process entry point: start the HTTP server and wire graceful shutdown.

import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { closeBrowser, getBrowser } from './browser/createBrowser';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('linkedin-share-resolver listening', {
    port: config.port,
    debugArtifacts: config.enableDebugArtifacts,
    pageTimeoutMs: config.pageTimeoutMs,
  });

  // Warm the browser in the background so the first request isn't slow.
  // Failures here are non-fatal; the first /resolve will retry the launch.
  getBrowser().catch((err) => logger.warn('Browser warm-up failed', { err: String(err) }));
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal });

  // Stop accepting new connections.
  server.close((err) => {
    if (err) logger.warn('Error closing HTTP server', { err: String(err) });
  });

  // Close the shared browser.
  await closeBrowser();

  // Give in-flight logs a tick, then exit.
  setTimeout(() => process.exit(0), 250);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: String(err) });
});
