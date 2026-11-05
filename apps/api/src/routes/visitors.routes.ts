import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { localControl } from './local-control.js';
import { visitorDirectory, trialVisitors, updateVisitor, saveCategory, updateExclusion, mergeVisitors } from '../services/visitors.service.js';
export const visitorsRouter = Router();
visitorsRouter.use(localControl);
visitorsRouter.get('/', async (req, res, next) => { try {
    res.json(await visitorDirectory(Number(req.query.days ?? 30)));
}
catch (e) {
    next(e);
} });
visitorsRouter.post('/trial', async (_req, res, next) => { try {
    res.json(await trialVisitors());
}
catch (e) {
    next(e);
} });
visitorsRouter.post('/categories', async (req, res, next) => { try {
    res.json(await saveCategory(randomUUID(), req.body));
}
catch (e) {
    next(e);
} });
visitorsRouter.patch('/categories/:id', async (req, res, next) => { try {
    res.json(await saveCategory(req.params.id, req.body));
}
catch (e) {
    next(e);
} });
visitorsRouter.patch('/businesses/:id', async (req, res, next) => { try {
    res.json(await updateVisitor(req.params.id, req.body));
}
catch (e) {
    next(e);
} });
visitorsRouter.patch('/exclusions/:id', async (req, res, next) => { try {
    res.json(await updateExclusion(req.params.id, req.body));
}
catch (e) {
    next(e);
} });
visitorsRouter.post('/businesses/:id/merge', async (req, res, next) => { try {
    if (typeof req.body?.targetId !== 'string')
        throw Error('Invalid merge target');
    res.json(await mergeVisitors(req.params.id, req.body.targetId));
}
catch (e) {
    next(e);
} });
