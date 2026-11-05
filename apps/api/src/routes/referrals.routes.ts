import {listMemberFeedback,setMemberFeedbackActive,summarizeMemberFeedback} from '../services/member-feedback.service.js';
import {localControl} from './local-control.js';
import { Router } from 'express';
import {
  applyReferralCsvImport,
  createReferralMember,
  deleteReferralMember,
  generateReferralMatches,
  getReferralCsvTemplate,
  getReferralDirectory,
  listMemberAiMatches,
  listReferralMatches,
  previewReferralCsvImport,
  updateAiMemberMatchStatus,
  updateReferralMatchStatus,
  updateReferralMember,
} from '../services/referrals.service.js';

export const referralsRouter = Router();

referralsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getReferralDirectory());
  } catch (error) {
    next(error);
  }
});

referralsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createReferralMember(req.body));
  } catch (error) {
    next(error);
  }
});

referralsRouter.get('/csv-template', async (_req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="referral-directory-template.csv"');
    res.send(getReferralCsvTemplate());
  } catch (error) {
    next(error);
  }
});

referralsRouter.post('/csv-preview', async (req, res, next) => {
  try {
    res.json(await previewReferralCsvImport(String(req.body?.csv ?? '')));
  } catch (error) {
    next(error);
  }
});

referralsRouter.post('/csv-import', async (req, res, next) => {
  try {
    res.json(await applyReferralCsvImport(String(req.body?.csv ?? ''), req.body?.mode === 'overwrite' ? 'overwrite' : 'skip'));
  } catch (error) {
    next(error);
  }
});

referralsRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await updateReferralMember(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

referralsRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteReferralMember(req.params.id));
  } catch (error) {
    next(error);
  }
});

referralsRouter.post('/matches/generate', async (_req, res, next) => {
  try {
    res.json(await generateReferralMatches());
  } catch (error) {
    next(error);
  }
});

referralsRouter.get('/matches', async (req, res, next) => {
  try {
    res.json(await listReferralMatches(
      typeof req.query.status === 'string' ? req.query.status : 'suggested',
      Number(req.query.page ?? 1),
      Number(req.query.pageSize ?? 25),
    ));
  } catch (error) {
    next(error);
  }
});

referralsRouter.patch('/matches/:id', async (req, res, next) => {
  try {
    res.json(await updateReferralMatchStatus(req.params.id, req.body.status));
  } catch (error) {
    next(error);
  }
});

referralsRouter.get('/:id/ai-matches', async (req, res, next) => {
  try {
    res.json(await listMemberAiMatches(req.params.id, {
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      minScore: typeof req.query.minScore === 'string' ? Number(req.query.minScore) : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
    }));
  } catch (error) {
    next(error);
  }
});

referralsRouter.patch('/ai-matches/:id', localControl, async (req, res, next) => {
  try {
    res.json(await updateAiMemberMatchStatus(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

referralsRouter.get('/:id/feedback',localControl,async(req,res,next)=>{try{res.json(await listMemberFeedback(req.params.id));}catch(error){next(error);}});
referralsRouter.patch('/:id/feedback/:feedbackId',localControl,async(req,res,next)=>{try{res.json(await setMemberFeedbackActive(req.params.id,req.params.feedbackId,req.body?.active));}catch(error){next(error);}});

referralsRouter.post('/:id/feedback/:feedbackId/summarize',localControl,async(req,res,next)=>{try{res.json(await summarizeMemberFeedback(req.params.id,req.params.feedbackId));}catch(error){next(error);}});
