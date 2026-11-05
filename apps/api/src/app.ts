import fs from 'node:fs';
import path from 'node:path';
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

import { collectorRouter } from './routes/collector.routes.js';

import { notificationsRouter } from './routes/notifications.routes.js';

import {visitorsRouter} from './routes/visitors.routes.js';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api/visitors', visitorsRouter);
app.use('/api/notifications',notificationsRouter);
app.use('/api/collector', collectorRouter);
app.use('/api/health', healthRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/browser', browserRouter);
app.use('/api/runs', runsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/ai', aiRouter);

const webDist = process.env.WEB_DIST?.trim();
if (webDist && fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(webDist, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SchemaOutOfDateError) {
    res.status(503).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  const status = /out of date|not found|invalid|enter a valid|configure/i.test(message) ? 400 : 400;
  res.status(status).json({ error: message });
});
