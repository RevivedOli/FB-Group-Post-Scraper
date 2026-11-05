import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../../src/services/ai-credentials.service.js',()=>({getProviderApiKey:vi.fn().mockResolvedValue('test-key')}));
import {getProviderApiKey} from '../../src/services/ai-credentials.service.js';
import {callAiProvider,getProviderConfig} from '../../src/services/ai-provider.service.js';
import {normalizeSettings} from '../../src/services/settings.service.js';
const provider=getProviderConfig(normalizeSettings({ai:{provider:'openai',openaiModel:'gpt-6-luna'}}));
beforeEach(()=>vi.mocked(getProviderApiKey).mockResolvedValue('test-key'));
afterEach(()=>vi.restoreAllMocks());
describe('GPT-6 Luna API contract',()=>{
 it('uses Responses structured output with explicit nonreasoning and correct pricing',async()=>{
  const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'completed',output_text:'{}',usage:{input_tokens:100,output_tokens:10}}),{status:200}));
  await callAiProvider('System','Input',provider,30);
  const body=JSON.parse(request.mock.calls[0][1]?.body as string);
  expect(body).toMatchObject({model:'gpt-6-luna',reasoning:{effort:'none'},max_output_tokens:2000,text:{format:{type:'json_schema',strict:true}}});
  expect(provider.pricing).toMatchObject({inputCostPerMillion:0.1,outputCostPerMillion:0.5});
 });
 it('fails explicitly on incomplete output without interpreting it as a referral decision',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}),{status:200}));
  await expect(callAiProvider('System','Input',provider,30)).rejects.toThrow('incomplete');
 });
});
