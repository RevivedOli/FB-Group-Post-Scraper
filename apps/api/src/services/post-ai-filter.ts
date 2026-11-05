import {Prisma} from '@prisma/client';
export type AiPostFilters={aiIntent?:string;aiReferralOnly?:boolean;aiMemberId?:string};
export function hasAiPostFilter(options:AiPostFilters){return Boolean(options.aiReferralOnly||(options.aiIntent&&options.aiIntent!=='all')||(options.aiMemberId&&options.aiMemberId!=='all'));}
/** Apply all selected AI predicates to the same latest completed decision. */
export function latestCompletedPostFilter(options:AiPostFilters){
 const predicates=[Prisma.sql`a."status" = 'completed'`,Prisma.sql`a."id" = (SELECT n."id" FROM "PostAiAssessment" n WHERE n."postId"=a."postId" AND n."status"='completed' ORDER BY n."createdAt" DESC,n."id" DESC LIMIT 1)`];
 if(options.aiIntent&&options.aiIntent!=='all')predicates.push(Prisma.sql`a."intent"=${options.aiIntent}`);
 if(options.aiReferralOnly)predicates.push(Prisma.sql`a."isReferralOpportunity"=1`);
 if(options.aiMemberId&&options.aiMemberId!=='all')predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM "AiMemberMatch" m WHERE m."assessmentId"=a."id" AND m."referralMemberId"=${options.aiMemberId})`);
 else if(options.aiReferralOnly)predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM "AiMemberMatch" m WHERE m."assessmentId"=a."id")`);
 return Prisma.sql`SELECT a."postId" FROM "PostAiAssessment" a WHERE ${Prisma.join(predicates,' AND ')}`;
}
