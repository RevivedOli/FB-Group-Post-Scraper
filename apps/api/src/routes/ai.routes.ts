import { Router } from 'express';
import {
  getAiStatus,
  getAiActivity,
  getAiUsageReport,
  listAiAssessments,
  processAiQueue,
  queueEligiblePosts,
  queueFilteredPostsForAi,
  queuePostForAi,
  requeueAssessment,
  requeueFailedAssessments,
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

aiRouter.get('/usage', async (req, res, next) => {
  try {
    res.json(await getAiUsageReport({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
      model: typeof req.query.model === 'string' ? req.query.model : undefined,
    }));
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
    res.json(await queuePostForAi(req.params.postId, {
      force: Boolean(req.body?.force),
      process: Boolean(req.body?.process),
      bypassPrefilter: req.body?.bypassPrefilter === undefined
        ? Boolean(req.body?.force)
        : Boolean(req.body?.bypassPrefilter),
    }));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/assessments/:id/requeue', async (req, res, next) => {
  try {
    res.json(await requeueAssessment(req.params.id, {
      process: req.body?.process !== false,
      bypassPrefilter: Boolean(req.body?.bypassPrefilter),
    }));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/requeue-failed', async (req, res, next) => {
  try {
    const statusRaw = typeof req.body?.status === 'string' ? req.body.status : 'failed';
    const status = (['failed', 'skipped', 'failed_or_skipped'] as const).includes(statusRaw as 'failed')
      ? statusRaw as 'failed' | 'skipped' | 'failed_or_skipped'
      : 'failed';
    res.json(await requeueFailedAssessments({
      limit: Number(req.body?.limit ?? 500),
      process: req.body?.process !== false,
      bypassPrefilter: Boolean(req.body?.bypassPrefilter),
      status,
    }));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/rerun-all', async (req, res, next) => {
  try {
    res.json(await queueFilteredPostsForAi({
      limit: Number(req.body?.limit ?? 1000),
      force: true,
      bypassPrefilter: Boolean(req.body?.bypassPrefilter),
      process: Boolean(req.body?.process),
      groupId: typeof req.body?.groupId === 'string' ? req.body.groupId : undefined,
      reviewStatus: typeof req.body?.reviewStatus === 'string' ? req.body.reviewStatus : undefined,
      analysisScope: typeof req.body?.analysisScope === 'string' ? req.body.analysisScope : undefined,
      discoveredWithinDays: typeof req.body?.discoveredWithinDays === 'number' ? req.body.discoveredWithinDays : undefined,
      lastObservedWithinDays: typeof req.body?.lastObservedWithinDays === 'number' ? req.body.lastObservedWithinDays : undefined,
      minExtractionConfidence: typeof req.body?.minExtractionConfidence === 'number' ? req.body.minExtractionConfidence : undefined,
      search: typeof req.body?.search === 'string' ? req.body.search : undefined,
    }));
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/rerun-filtered', async (req, res, next) => {
  try {
    const analysisScopeRaw = typeof req.body?.analysisScope === 'string' ? req.body.analysisScope : 'all';
    const analysisScope = (['all', 'not_analysed', 'previously_analysed', 'skipped_prefilter', 'failed'] as const)
      .includes(analysisScopeRaw as 'all')
      ? analysisScopeRaw as 'all' | 'not_analysed' | 'previously_analysed' | 'skipped_prefilter' | 'failed'
      : 'all';
    res.json(await queueFilteredPostsForAi({
      limit: Number(req.body?.limit ?? 500),
      force: req.body?.force !== false,
      bypassPrefilter: req.body?.applyPrefilter === false || Boolean(req.body?.bypassPrefilter),
      process: req.body?.process !== false,
      groupId: typeof req.body?.groupId === 'string' ? req.body.groupId : undefined,
      reviewStatus: typeof req.body?.reviewStatus === 'string' ? req.body.reviewStatus : undefined,
      analysisScope,
      discoveredWithinDays: typeof req.body?.discoveredWithinDays === 'number' ? req.body.discoveredWithinDays : undefined,
      lastObservedWithinDays: typeof req.body?.lastObservedWithinDays === 'number' ? req.body.lastObservedWithinDays : undefined,
      minExtractionConfidence: typeof req.body?.minExtractionConfidence === 'number' ? req.body.minExtractionConfidence : undefined,
      search: typeof req.body?.search === 'string' ? req.body.search : undefined,
    }));
  } catch (error) {
    next(error);
  }
});
