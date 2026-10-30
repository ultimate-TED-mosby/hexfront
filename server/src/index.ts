// Entry point: listens on PORT and serves the built client from client/dist in production.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const clientDist = process.env.CLIENT_DIST ?? path.resolve(here, '../../client/dist');

const { httpServer, close } = createApp({ clientDist });

httpServer.listen(port, () => {
  console.log(`HEXFRONT server listening on http://localhost:${port}`);
});

/** Graceful shutdown so hosting platforms can restart the service cleanly. */
function shutdown(signal: string): void {
  console.log(`${signal} received, closing server.`);
  void close().then(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
