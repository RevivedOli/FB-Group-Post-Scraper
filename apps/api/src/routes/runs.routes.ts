import { Router } from 'express';
import {
  cancelActiveRun,
  getRunStartOptions,
  getRunSummary,
  listRunEvents,
  runEnabledGroups,
} from '../services/runs.service.js';

export const runsRouter = Router();

runsRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await getRunSummary());
  } catch (error) {
    next(error);
  }
});

runsRouter.get('/start-options', async (_req, res, next) => {
  try {
    res.json(await getRunStartOptions());
  } catch (error) {
    next(error);
  }
});

runsRouter.get('/events', async (req, res, next) => {
  try {
    res.json(await listRunEvents(Number(req.query.limit ?? 25)));
  } catch (error) {
    next(error);
  }
});

runsRouter.post('/start', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'remaining' ? 'remaining' : 'all';
    res.json(await runEnabledGroups({ mode }));
  } catch (error) {
    next(error);
  }
});

runsRouter.post('/cancel', async (_req, res, next) => {
  try {
    res.json(await cancelActiveRun());
  } catch (error) {
    next(error);
  }
});
