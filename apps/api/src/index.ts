import './config/env.js';
import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});

function shutdown() {
  server.closeAllConnections?.();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(0);
  }, 1000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
