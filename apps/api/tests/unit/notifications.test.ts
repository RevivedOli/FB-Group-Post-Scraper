import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({db:{setting:{findUnique:vi.fn()},notificationDelivery:{findMany:vi.fn(),upsert:vi.fn(),updateMany:vi.fn(),update:vi.fn()}}}));
vi.mock('../../src/db/prisma.js',()=>({prisma:mocks.db}));
vi.mock('node:util',()=>({promisify:()=>async()=>({stdout:'123456:private-bot-secret'})}));
import {deliverNotifications,enqueueReferralNotifications,referralMessage} from '../../src/services/notifications.service.js';
const config={enabled:true,chatId:'123',minMatchPercent:80,enabledAt:'2026-11-04T00:00:00Z'};
const post={id:'p1',firstDiscoveredAt:new Date('2026-11-04T01:00:00Z'),originalPostedAt:null,latestCapturedText:'Need a boiler engineer',canonicalPostUrl:'https://www.facebook.com/groups/123/posts/456',group:{friendlyName:'Example'}};
const members=[{id:'m1',name:'Heating specialist'}];const matches=[{referralMemberId:'m1',score:1,scorePercent:'100%',suggestedIntro:'Can you help?'}];
beforeEach(()=>{vi.clearAllMocks();mocks.db.setting.findUnique.mockResolvedValue({value:config});mocks.db.notificationDelivery.findMany.mockResolvedValue([]);mocks.db.notificationDelivery.updateMany.mockResolvedValue({count:1});});
describe('Telegram notification outbox',()=>{
 it('queues only new qualified referrals and uses a stable deduplication identity',async()=>{
  await enqueueReferralNotifications(mocks.db as never,config,post,members,matches);await enqueueReferralNotifications(mocks.db as never,config,post,members,matches);
  const [first,second]=mocks.db.notificationDelivery.upsert.mock.calls;
  expect(first[0].where.id).toBe(second[0].where.id);expect(first[0].update).toEqual({});
  expect(first[0].create.payload.text).toContain('Need a boiler engineer');expect(first[0].create.payload.text).toContain('Posted: date unavailable');
 });
 it('does not backfill old posts, disabled alerts, weak scores or invalid member IDs',async()=>{
  await enqueueReferralNotifications(mocks.db as never,config,{...post,firstDiscoveredAt:new Date('2026-11-03')},members,matches);
  await enqueueReferralNotifications(mocks.db as never,{...config,enabled:false},post,members,matches);
  await enqueueReferralNotifications(mocks.db as never,config,post,members,[{...matches[0],score:0.6}]);
  await enqueueReferralNotifications(mocks.db as never,config,post,[],matches);
  expect(mocks.db.notificationDelivery.upsert).not.toHaveBeenCalled();
 });
 it('permits an explicitly requested older-post simulation without changing the normal age gate',async()=>{
  const older={...post,firstDiscoveredAt:new Date('2026-11-03')};
  await enqueueReferralNotifications(mocks.db as never,config,older,members,matches);
  expect(mocks.db.notificationDelivery.upsert).not.toHaveBeenCalled();
  await enqueueReferralNotifications(mocks.db as never,config,older,members,matches,{allowExistingPost:true});
  expect(mocks.db.notificationDelivery.upsert).toHaveBeenCalledTimes(1);
 });
 it('retains failed deliveries with a retry time and sanitized error',async()=>{
  mocks.db.notificationDelivery.findMany.mockResolvedValue([{id:'n1',attempts:0,payload:{chat_id:'123',text:'Referral'}}]);
  const request=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('URL contains private-bot-secret'));
  await deliverNotifications();request.mockRestore();
  expect(mocks.db.notificationDelivery.update.mock.calls[0][0].data).toMatchObject({status:'retry',errorMessage:'Telegram request failed or timed out.'});
  expect(mocks.db.notificationDelivery.update.mock.calls[0][0].data.availableAt.getTime()).toBeGreaterThan(Date.now());
 });
 it('never sends a row that another dispatcher already claimed',async()=>{
  mocks.db.notificationDelivery.findMany.mockResolvedValue([{id:'n1',attempts:0,payload:{chat_id:'123'}}]);
  mocks.db.notificationDelivery.updateMany.mockResolvedValue({count:0});const request=vi.spyOn(globalThis,'fetch');await deliverNotifications();expect(request).not.toHaveBeenCalled();request.mockRestore();
 });
 it('includes publication time and source URL in the mobile message',()=>{
  const text=referralMessage({memberName:'Example member',score:'90%',group:'Example group',postedAt:'2026-11-04T12:30:00Z',text:'Looking for help',url:post.canonicalPostUrl});
  expect(text).toContain('04/11/2026');expect(text).toContain(post.canonicalPostUrl);
 });
});
