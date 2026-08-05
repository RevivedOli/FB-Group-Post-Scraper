import { Router } from 'express';
import {
  getAiStatus,
  getAiActivity,
  listAiAssessments,
  processAiQueue,
  queueEligiblePosts,
  queuePostForAi,
  resetStaleRunningAssessments,
  startAiQueueProcessor,
} from '../services/ai-assessment.service.js';

export const aiRouter = Router();

aiRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getAiStatus());
  } catch (error) {
    next(error);
  }
});

aiRouter.get('/activity', async (_req, res, next) => {
  try {
    res.json(getAiActivity());
  } catch (error) {
    next(error);
  }
});

aiRouter.get('/assessments', async (req, res, next) => {
  try {
    res.json(await listAiAssessments({
      status: typeof req.query.status === 'string' ? req.query.status : 'all',
      intent: typeof req.query.intent === 'string' ? req.query.intent : 'all',
      referral: typeof req.query.referral === 'string' ? req.query.referral : 'all',
      match: typeof req.query.match === 'string' ? req.query.match : 'all',
      memberId: typeof req.query.memberId === 'string' && req.query.memberId ? req.query.memberId : undefined,
      minConfidence: typeof req.query.minConfidence === 'string' && req.query.minConfidence ? Number(req.query.minConfidence) : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
    }));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/queue', async (req, res, next) => {
  try {
    res.json(await queueEligiblePosts(Number(req.body?.limit ?? 200)));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/process', async (req, res, next) => {
  try {
    if (req.body?.wait === true) {
      res.json(await processAiQueue(Number(req.body?.limit ?? 1000)));
      return;
    }
    res.json(startAiQueueProcessor(Number(req.body?.limit ?? 1000)));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/reset-stale', async (req, res, next) => {
  try {
    res.json(await resetStaleRunningAssessments(
      typeof req.body?.maxAgeSeconds === 'number' ? req.body.maxAgeSeconds : undefined,
    ));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/posts/:postId/run', async (req, res, next) => {
  try {
    res.json(await queuePostForAi(req.params.postId, { force: Boolean(req.body?.force), process: Boolean(req.body?.process) }));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/rerun-all', async (req, res, next) => {
  try {
    const queued = await queueEligiblePosts(Number(req.body?.limit ?? 1000), { force: true });
    if (req.body?.process) {
      res.json({ queued, processing: startAiQueueProcessor(Number(req.body?.processLimit ?? 1000)) });
      return;
    }
    res.json({ queued });
  } catch (error) {
    next(error);
  }
});
