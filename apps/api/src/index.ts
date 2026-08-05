import './config/env.js';
import { app } from './app.js';
import { env } from './config/env.js';
import { resumeAiQueueIfNeeded } from './services/ai-assessment.service.js';

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
  setTimeout(() => {
    void resumeAiQueueIfNeeded().catch((error) => {
      console.error('AI queue resume failed:', error);
    });
  }, 1000).unref();
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
