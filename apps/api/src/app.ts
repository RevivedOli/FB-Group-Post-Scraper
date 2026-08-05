import express from 'express'; import cors from 'cors';
import { healthRouter } from './routes/health.routes.js'; import { settingsRouter } from './routes/settings.routes.js'; import { groupsRouter } from './routes/groups.routes.js'; import { browserRouter } from './routes/browser.routes.js'; import { runsRouter } from './routes/runs.routes.js'; import { postsRouter } from './routes/posts.routes.js'; import { referralsRouter } from './routes/referrals.routes.js';
export const app=express(); app.use(cors()); app.use(express.json()); app.use('/api/health',healthRouter); app.use('/api/settings',settingsRouter); app.use('/api/groups',groupsRouter);
app.use('/api/browser', browserRouter);
app.use('/api/runs', runsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/referrals', referralsRouter);
app.use((err:any,_req:any,res:any,_next:any)=>res.status(400).json({error:err?.message ?? 'Unexpected error'}));
