import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  exec:vi.fn(), queue:vi.fn(),
  db:{ setting:{findUnique:vi.fn(),upsert:vi.fn()}, group:{findFirst:vi.fn(),upsert:vi.fn(),count:vi.fn()}, post:{findFirst:vi.fn(),create:vi.fn(),update:vi.fn()} },
}));
vi.mock('node:util', () => ({ promisify: () => () => mocks.exec().then((data:unknown) => ({stdout:JSON.stringify(data)})) }));
vi.mock('../../src/db/prisma.js', () => ({ prisma:mocks.db }));
vi.mock('../../src/services/ai-assessment.service.js', () => ({ queuePostAfterScrape:mocks.queue }));
import { syncCollectorBridge } from '../../src/services/collector-bridge.service.js';
const post = {group_id:'123',post_id:'456',text:'Looking for a plumber',published_at:null,first_observed_at:'2026-11-04T12:00:00Z',last_observed_at:'2026-11-04T13:00:00Z',revision:1};
const snapshot = { connected:true,total_posts:1,groups:[{id:'123',name:'Example'}],posts:[post] };
beforeEach(() => { vi.clearAllMocks(); mocks.exec.mockResolvedValue(snapshot); mocks.db.setting.findUnique.mockResolvedValue(null); mocks.db.group.findFirst.mockResolvedValue(null); mocks.db.group.upsert.mockResolvedValue({id:'g1'}); mocks.db.group.count.mockResolvedValue(0); mocks.db.post.findFirst.mockResolvedValue(null); mocks.db.post.create.mockResolvedValue({id:'p1'}); mocks.db.post.update.mockResolvedValue({id:'p1'}); mocks.queue.mockResolvedValue({queued:false}); });
describe('collector handoff', () => {
  it('commits a stable post before queueing and advancing its durable cursor', async () => {
    const result = await syncCollectorBridge();
    expect(result.error).toBeNull();
    expect(mocks.db.post.create.mock.calls[0][0].data).toMatchObject({id:'collector-post-123-456',firstCapturedText:post.text});
    expect(mocks.queue).toHaveBeenCalledWith('p1');
    expect(mocks.db.setting.upsert.mock.calls[0][0].update.value).toEqual([post.last_observed_at,'123','456']);
    expect(mocks.db.group.upsert.mock.calls[0][0].create.enabled).toBe(false);
  });
  it('retains review decisions and first discovery on replay', async () => {
    mocks.db.post.findFirst.mockResolvedValue({id:'p1',groupId:'g1',reviewStatus:'reviewed'});
    await syncCollectorBridge();
    expect(mocks.db.post.create).not.toHaveBeenCalled();
    expect(mocks.db.post.update.mock.calls[0][0].data).not.toHaveProperty('reviewStatus');
    expect(mocks.db.post.update.mock.calls[0][0].data).not.toHaveProperty('firstDiscoveredAt');
  });
  it('leaves the cursor pending on downstream failure and sanitizes the error', async () => {
    mocks.queue.mockRejectedValue(new Error('private provider secret'));
    const result = await syncCollectorBridge();
    expect(mocks.db.setting.upsert).not.toHaveBeenCalled();
    expect(result.error).toContain('will retry');
    expect(JSON.stringify(result)).not.toContain('private provider secret');
  });
  it('coalesces concurrent sync requests', async () => {
    await Promise.all([syncCollectorBridge(),syncCollectorBridge()]);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });
});
