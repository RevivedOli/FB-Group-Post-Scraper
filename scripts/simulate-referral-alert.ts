import {prisma} from '../apps/api/src/db/prisma.js';
import {queuePostForAi,runAssessment} from '../apps/api/src/services/ai-assessment.service.js';
import {notificationConfig,deliverNotifications,telegramToken} from '../apps/api/src/services/notifications.service.js';
async function main(){
 const sourceId=process.argv[2];if(!sourceId||!/^\d+$/.test(sourceId))throw new Error('Supply one numeric Facebook post ID.');
 const posts=await prisma.post.findMany({where:{facebookPostId:sourceId}});if(posts.length!==1)throw new Error('Expected exactly one saved post.');const post=posts[0];
 const config=await notificationConfig();if(!config.enabled||!config.chatId||!await telegramToken())throw new Error('Enable and configure Telegram first.');
 const queued=await queuePostForAi(post.id,{force:true,process:false,bypassPrefilter:false});
 if(!queued.assessment||queued.assessment.status!=='pending')throw new Error('Post did not pass normal AI eligibility/prefilter.');
 const id=queued.assessment.id;
 const claim=await prisma.postAiAssessment.updateMany({where:{id,status:'pending'},data:{status:'running',startedAt:new Date()}});
 if(claim.count!==1)throw new Error('Assessment was claimed by another worker; it was not run twice.');
 const result=await runAssessment(id,{notifyExistingPost:true});
 console.log(JSON.stringify({assessmentId:id,status:result.status}));
 await deliverNotifications();
 const assessment=await prisma.postAiAssessment.findUnique({where:{id},select:{model:true,intent:true,isReferralOpportunity:true}});
 const deliveries=await prisma.notificationDelivery.findMany({where:{postId:post.id},select:{id:true,status:true,attempts:true,sentAt:true,messageId:true,errorMessage:true}});
 console.log(JSON.stringify({assessment,deliveries}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Simulation failed.');process.exitCode=1;}).finally(()=>prisma.$disconnect());
