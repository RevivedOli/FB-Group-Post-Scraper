import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { groupsRouter } from './routes/groups.routes.js';
import { browserRouter } from './routes/browser.routes.js';
import { runsRouter } from './routes/runs.routes.js';
import { postsRouter } from './routes/posts.routes.js';
import { referralsRouter } from './routes/referrals.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import { SchemaOutOfDateError } from './db/schema-preflight.js';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api/health', healthRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/browser', browserRouter);
app.use('/api/runs', runsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/ai', aiRouter);
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SchemaOutOfDateError) {
    res.status(503).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  const status = /out of date|not found|invalid|enter a valid|configure/i.test(message) ? 400 : 400;
  res.status(status).json({ error: message });
});
