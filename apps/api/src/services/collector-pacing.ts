export type CollectorPacing={intervalMinMinutes:number;intervalMaxMinutes:number;requestMinSeconds:number;requestMaxSeconds:number;pageMinSeconds:number;pageMaxSeconds:number;groupMinSeconds:number;groupMaxSeconds:number;groupDeadlineSeconds:number;shuffleGroups:boolean};
export function normalizePacing(input:Partial<CollectorPacing>&{intervalMinutes?:number}):CollectorPacing{
 const min=Number(input.intervalMinMinutes ?? input.intervalMinutes ?? 60);
 const value={intervalMinMinutes:min,intervalMaxMinutes:Number(input.intervalMaxMinutes ?? Math.min(10080,min+15)),requestMinSeconds:Number(input.requestMinSeconds ?? 5),requestMaxSeconds:Number(input.requestMaxSeconds ?? 10),pageMinSeconds:Number(input.pageMinSeconds ?? 10),pageMaxSeconds:Number(input.pageMaxSeconds ?? 20),groupMinSeconds:Number(input.groupMinSeconds ?? 10),groupMaxSeconds:Number(input.groupMaxSeconds ?? 30),groupDeadlineSeconds:Number(input.groupDeadlineSeconds ?? 180),shuffleGroups:input.shuffleGroups===undefined?true:Boolean(input.shuffleGroups)};
 for(const [low,high,floor,ceiling,label] of [
  [value.intervalMinMinutes,value.intervalMaxMinutes,15,10080,'Cycle interval (minutes)'],
  [value.requestMinSeconds,value.requestMaxSeconds,2,120,'Request spacing (seconds)'],
  [value.pageMinSeconds,value.pageMaxSeconds,2,300,'Page pause (seconds)'],
  [value.groupMinSeconds,value.groupMaxSeconds,2,600,'Group pause (seconds)'],
 ] as const){if(!Number.isFinite(low)||!Number.isFinite(high)||low<floor||high>ceiling||high<low)throw new Error(`${label}: minimum must be at least ${floor}, maximum no more than ${ceiling}, and maximum must be at least minimum.`);}
 if(!Number.isFinite(value.groupDeadlineSeconds)||value.groupDeadlineSeconds<30||value.groupDeadlineSeconds>600)throw new Error('Group time budget must be between 30 and 600 seconds.');
 return value;
}
export function randomBetween(min:number,max:number,random:()=>number=Math.random){return min+(max-min)*random();}
