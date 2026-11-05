import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../apps/api/src/db/prisma.js';
import { getSettings } from '../apps/api/src/services/settings.service.js';
import { callAiProvider,getProviderConfig } from '../apps/api/src/services/ai-provider.service.js';
import { extractJson,validateParsedAssessment } from '../apps/api/src/services/ai-assessment.service.js';
async function main(){
 const settings=await getSettings();
 const provider=getProviderConfig({...settings,ai:{...settings.ai,provider:'openai',openaiModel:'gpt-6-luna'}});
 const candidates=await prisma.postAiAssessment.findMany({where:{status:'completed',provider:'openai',model:'gpt-5.6-luna'},orderBy:{createdAt:'desc'},take:300});
 const seen=new Set<string>();const selected:typeof candidates=[];
 for(const positive of [true,false])for(const item of candidates){
  if(selected.filter(row=>row.isReferralOpportunity===positive).length>=10)break;
  const input=item.inputPayload as {post?:unknown;referralMembers?:unknown[]}|null;
  if(item.isReferralOpportunity!==positive||seen.has(item.postId)||!input?.post||!input.referralMembers?.length)continue;
  selected.push(item);seen.add(item.postId);
 }
 const rows=[];let estimatedCost=0;
 for(const baseline of selected){
  const input=baseline.inputPayload as {post:unknown;referralMembers:unknown[]};
  try{
   const result=await callAiProvider(baseline.renderedPrompt || baseline.promptText || settings.ai.promptTemplate,`ASSESS_THIS_POST:\n${JSON.stringify({post:input.post,referralMembers:input.referralMembers},null,2)}`,provider,settings.ai.requestTimeoutSeconds);
   const parsed=validateParsedAssessment(extractJson(result.text));const previous=baseline.parsed as {recommendedMembers?:{memberId:string}[]};
   const expected=(previous?.recommendedMembers ?? []).map(member=>member.memberId).sort();const actual=parsed.recommendedMembers.map(member=>member.memberId).sort();
   estimatedCost+=result.usage.estimatedCostUsd ?? 0;
   rows.push({postId:baseline.postId,baselineAssessmentId:baseline.id,baselineIntent:baseline.intent,targetIntent:parsed.intent,intentAgrees:baseline.intent===parsed.intent,baselineMembers:expected,targetMembers:actual,membersAgree:JSON.stringify(expected)===JSON.stringify(actual),usage:result.usage,target:parsed});
   console.log(`Compared ${rows.length}/${selected.length}`);
  }catch{rows.push({postId:baseline.postId,error:'Target request failed or returned invalid structured output.'});}
 }
 const successful=rows.filter(row=>!('error' in row));const summary={model:'gpt-6-luna',reasoning:'none',examples:rows.length,successful:successful.length,intentAgreements:successful.filter(row=>row.intentAgrees).length,memberAgreements:successful.filter(row=>row.membersAgree).length,estimatedCostUsd:estimatedCost,notes:'Agreement with historical GPT-5.6 Luna decisions, not independently labelled accuracy. Original saved model inputs are reused. No live assessments, match decisions or notifications are changed.'};
 const file=path.resolve('docs/research/model-comparison-gpt-6-luna.json');await fs.writeFile(file,JSON.stringify({summary,rows},null,2),{mode:0o600});console.log(JSON.stringify(summary));
}
main().catch(()=>{console.error('Model comparison failed; check database and OpenAI credentials.');process.exitCode=1;}).finally(()=>prisma.$disconnect());
