import type {RequestHandler} from 'express';
/** Browser controls must originate from the local UI. CLI requests have no Origin. */
export const localControl:RequestHandler=(req,res,next)=>{
 const origin=req.get('origin');if(!origin){next();return;}
 const ports=new Set(['5173','5182',process.env.COLLECTOR_UI_PORT ?? '5182',process.env.PORT ?? '3001']);
 try{const url=new URL(origin);if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&ports.has(url.port)){next();return;}}catch{}
 res.status(403).json({error:'Open this control from the local Group Monitor UI.'});
};
