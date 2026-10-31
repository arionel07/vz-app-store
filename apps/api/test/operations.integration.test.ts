import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { loadEnv } from "../src/config/env";
import { domainEvents, merchandisingDisplays, merchandisingInspections, merchandisingReviewHistory, notificationEventConsumptions, notificationOutbox, notifications, operationalRequestHistory, operationalRequestPhotos, operationalRequests, photos, retailCampaignExecutions, retailCampaignReferencePhotos, retailCampaignReviews, retailCampaignStores, retailCampaignSubmissionPhotos, retailCampaignSubmissions, retailCampaigns, storeIssueHistory, storeIssuePhotos, storeIssues, stores, userStores, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { OperationsService } from "../src/domain/operations/service";
import { createNotificationsService } from "../src/domain/notifications/service";
import { LocalPhotoStorage } from "../src/storage/photo-storage";

const suite = Bun.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;
suite("Retail operations PostgreSQL integration",()=>{
 const {db,client}=createDatabase(loadEnv()); const storage=new LocalPhotoStorage(`/tmp/vizaje-operations-${crypto.randomUUID()}`);const service=new OperationsService(db,storage); const suffix=crypto.randomUUID().slice(0,8);
 let adminId="",managerId="",staffId="",otherStaffId="",storeId="",otherStoreId="",campaignId="",issueId="",requestId="",photoId="",photoId2="",otherPhotoId="";const photoKeys:string[]=[];const issueIds:string[]=[];const requestIds:string[]=[];const displayIds:string[]=[];const campaignIds:string[]=[];
 const admin=():TrustedPrincipal=>({userId:adminId,role:"admin",storeIds:[],isActive:true});
 const manager=():TrustedPrincipal=>({userId:managerId,role:"manager",storeIds:[storeId],isActive:true});
 const staff=():TrustedPrincipal=>({userId:staffId,role:"staff",storeIds:[storeId,otherStoreId],isActive:true});
 const other=():TrustedPrincipal=>({userId:otherStaffId,role:"staff",storeIds:[otherStoreId],isActive:true});
 beforeAll(async()=>{
  const s=await db.insert(stores).values([{name:`Ops ${suffix}`,code:`OPS-${suffix}`},{name:`Ops other ${suffix}`,code:`OPS2-${suffix}`}]).returning({id:stores.id}); storeId=s[0]!.id;otherStoreId=s[1]!.id;
  const u=await db.insert(users).values([{firstName:"Ops",lastName:"Admin",email:`ops-a-${suffix}@example.com`,role:"admin"},{firstName:"Ops",lastName:"Manager",email:`ops-m-${suffix}@example.com`,role:"manager"},{firstName:"Ops",lastName:"Staff",email:`ops-s-${suffix}@example.com`,role:"staff"},{firstName:"Ops",lastName:"Other",email:`ops-o-${suffix}@example.com`,role:"staff"}]).returning({id:users.id}); [adminId,managerId,staffId,otherStaffId]=u.map(x=>x.id);
  await db.insert(userStores).values([{userId:managerId,storeId},{userId:staffId,storeId},{userId:staffId,storeId:otherStoreId},{userId:otherStaffId,storeId:otherStoreId}]);
  const media=[] as Array<{storeId:string;uploadedBy:string;storageKey:string;originalFilename:string;mimeType:string;fileSize:number}>;
  for(const [sid,label,uploader] of [[storeId,"one",staffId],[storeId,"two",staffId],[otherStoreId,"other",otherStaffId]] as const){const key=`operations-test/${suffix}-${label}.jpg`;photoKeys.push(key);await storage.put(key,new TextEncoder().encode(`private ${label}`),"image/jpeg");media.push({storeId:sid,uploadedBy:uploader,storageKey:key,originalFilename:`${label}.jpg`,mimeType:"image/jpeg",fileSize:12});}
  const createdPhotos=await db.insert(photos).values(media).returning({id:photos.id});[photoId,photoId2,otherPhotoId]=createdPhotos.map(x=>x.id);
 });
 afterAll(async()=>{
  const allCampaignIds=[...new Set([campaignId,...campaignIds].filter(Boolean))];for(const cid of allCampaignIds){const executions=await db.select({id:retailCampaignExecutions.id}).from(retailCampaignExecutions).where(eq(retailCampaignExecutions.campaignId,cid));if(executions.length){const ids=executions.map(x=>x.id);const submissions=await db.select({id:retailCampaignSubmissions.id}).from(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId,ids));if(submissions.length)await db.delete(retailCampaignSubmissionPhotos).where(inArray(retailCampaignSubmissionPhotos.submissionId,submissions.map(s=>s.id)));await db.delete(retailCampaignReviews).where(inArray(retailCampaignReviews.executionId,ids));await db.delete(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId,ids));}await db.delete(retailCampaignReferencePhotos).where(eq(retailCampaignReferencePhotos.campaignId,cid));await db.delete(retailCampaignExecutions).where(eq(retailCampaignExecutions.campaignId,cid));await db.delete(retailCampaignStores).where(eq(retailCampaignStores.campaignId,cid));await db.delete(retailCampaigns).where(eq(retailCampaigns.id,cid));}
  if(displayIds.length){const inspections=await db.select({id:merchandisingInspections.id}).from(merchandisingInspections).where(inArray(merchandisingInspections.displayId,displayIds));if(inspections.length){const ids=inspections.map(x=>x.id);await db.delete(merchandisingReviewHistory).where(inArray(merchandisingReviewHistory.inspectionId,ids));await db.delete(merchandisingInspections).where(inArray(merchandisingInspections.id,ids));}await db.delete(merchandisingDisplays).where(inArray(merchandisingDisplays.id,displayIds));}
  if(issueIds.length){await db.delete(storeIssueHistory).where(inArray(storeIssueHistory.issueId,issueIds));await db.delete(storeIssuePhotos).where(inArray(storeIssuePhotos.issueId,issueIds));await db.delete(storeIssues).where(inArray(storeIssues.id,issueIds));}
  const allRequestIds=[...new Set([requestId,...requestIds].filter(Boolean))];if(allRequestIds.length){await db.delete(operationalRequestHistory).where(inArray(operationalRequestHistory.requestId,allRequestIds));await db.delete(operationalRequestPhotos).where(inArray(operationalRequestPhotos.requestId,allRequestIds));await db.delete(operationalRequests).where(inArray(operationalRequests.id,allRequestIds));}
  if(photoId){await db.delete(photos).where(inArray(photos.id,[photoId,photoId2,otherPhotoId]));for(const key of photoKeys)await storage.delete(key);}
  const actorEvents=await db.select({id:domainEvents.id}).from(domainEvents).where(inArray(domainEvents.actorId,[adminId,managerId,staffId,otherStaffId]));const eventIds=actorEvents.map(x=>x.id);if(eventIds.length){const notificationIds=(await db.select({id:notifications.id}).from(notifications).where(inArray(notifications.sourceEventId,eventIds))).map(x=>x.id);if(notificationIds.length)await db.delete(notificationOutbox).where(inArray(notificationOutbox.notificationId,notificationIds));await db.delete(notifications).where(inArray(notifications.sourceEventId,eventIds));await db.delete(notificationEventConsumptions).where(inArray(notificationEventConsumptions.domainEventId,eventIds));await db.delete(domainEvents).where(inArray(domainEvents.id,eventIds));}
  await db.delete(userStores).where(inArray(userStores.userId,[managerId,staffId,otherStaffId]));await db.delete(users).where(inArray(users.id,[adminId,managerId,staffId,otherStaffId]));await db.delete(stores).where(inArray(stores.id,[storeId,otherStoreId]));await client.end();
 });
 test("isolates campaign execution by store and validates review transitions",async()=>{
  const c=await service.createCampaign(admin(),{title:"Новая выкладка",description:"",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId,otherStoreId],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]});campaignId=c.id;
  const published=await service.publishCampaign(admin(),campaignId);expect(published).toMatchObject({id:campaignId,status:"active",storeIds:[storeId,otherStoreId]}); expect((await service.listCampaigns(staff(),{page:1,pageSize:10})).pagination.total).toBe(1); const submission={actionResults:[],photoIds:[photoId],idempotencyKey:"campaign-submit-key-01"}; await expect(service.submitCampaign(other(),campaignId,storeId,submission)).rejects.toMatchObject({status:403});
  await service.submitCampaign(staff(),campaignId,storeId,submission); await expect(service.submitCampaign(staff(),campaignId,storeId,submission)).resolves.toMatchObject({status:"submitted",version:1}); await expect(service.submitCampaign(staff(),campaignId,storeId,{...submission,actionResults:[true]})).rejects.toMatchObject({status:409}); const execution=c.executions?.find(x=>x.storeId===storeId); expect(execution).toBeDefined();const campaignDetail=await service.getCampaign(manager(),campaignId);expect(campaignDetail.executions?.find((item:any)=>item.storeId===storeId)).toMatchObject({version:1,submittedBy:staffId,evidencePhotoIds:[photoId]});
  const row=await db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,campaignId),eq(retailCampaignExecutions.storeId,storeId))).limit(1);
  await expect(service.reviewCampaign(manager(),row[0]!.id,{decision:"rejected",comment:"Исправить оформление"})).resolves.toMatchObject({status:"rejected"});
  await expect(service.reviewCampaign(manager(),row[0]!.id,{decision:"checked",comment:""})).rejects.toMatchObject({status:409});
  await service.submitCampaign(staff(),campaignId,storeId,{actionResults:[],photoIds:[],idempotencyKey:"campaign-submit-key-02"});await service.reviewCampaign(admin(),row[0]!.id,{decision:"checked",comment:"Принято"});
  const otherExecution=await db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,campaignId),eq(retailCampaignExecutions.storeId,otherStoreId))).limit(1);await service.submitCampaign(other(),campaignId,otherStoreId,{actionResults:[],photoIds:[],idempotencyKey:"campaign-submit-key-03"});await service.reviewCampaign(admin(),otherExecution[0]!.id,{decision:"checked",comment:"Принято"});
  await expect(service.transitionCampaign(admin(),campaignId,"complete")).resolves.toMatchObject({status:"completed"});await expect(service.transitionCampaign(admin(),campaignId,"archive")).resolves.toMatchObject({status:"archived"});await expect(service.transitionCampaign(admin(),campaignId,"archive")).rejects.toMatchObject({status:409});expect((await service.campaignHistory(admin(),campaignId)).data.length).toBeGreaterThanOrEqual(5);
 });
 test("records issue and request status history and blocks cross-store access",async()=>{
  const issue=await service.createIssue(staff(),{storeId,category:"lighting",title:"Не горит свет",description:"Зона кассы",priority:"high",photoIds:[]});issueId=issue.id;issueIds.push(issueId);
  await expect(service.updateIssue(other(),issueId,{status:"in_progress"})).rejects.toMatchObject({status:403});
  await service.updateIssue(manager(),issueId,{status:"in_progress"});await service.updateIssue(manager(),issueId,{status:"resolved",resolutionNotes:"Лампа заменена"});
  const request=await service.createRequest(staff(),{storeId,category:"supplies",description:"Нужны пакеты",attachmentPhotoIds:[]});requestId=request.id;requestIds.push(request.id);
  await expect(service.updateRequest(manager(),requestId,{status:"completed"})).rejects.toMatchObject({status:409});
  await service.decideRequest(manager(),requestId,{decision:"approved",comment:""});await service.updateRequest(manager(),requestId,{status:"in_progress"});await service.updateRequest(manager(),requestId,{status:"completed"});
  expect((await db.select().from(storeIssueHistory).where(eq(storeIssueHistory.issueId,issueId))).length).toBe(3);expect((await service.listIssues(staff(),{page:1,pageSize:10})).pagination.total).toBe(1);expect((await service.issueHistory(manager(),issueId)).data.length).toBe(3);
  expect((await db.select().from(operationalRequestHistory).where(eq(operationalRequestHistory.requestId,requestId))).length).toBe(4);expect((await service.listRequests(staff(),{page:1,pageSize:10})).pagination.total).toBe(1);expect((await service.requestHistory(manager(),requestId)).data.length).toBe(4);
 });

 test("deduplicates repeated mobile issue and request creation keys",async()=>{
  const issueInput={storeId,category:"equipment" as const,title:"Idempotent issue",description:"Same mobile retry",priority:"normal" as const,photoIds:[]};
  const issueKey=`issue-create-${suffix}`;
  const [issueA,issueRetry]=await Promise.all([service.createIssue(staff(),issueInput,issueKey),service.createIssue(staff(),issueInput,issueKey)]);
  issueIds.push(issueA.id);
  expect(issueRetry.id).toBe(issueA.id);
  expect((await db.select().from(storeIssueHistory).where(eq(storeIssueHistory.issueId,issueA.id))).length).toBe(1);
  await expect(service.createIssue(staff(),{...issueInput,title:"Different payload"},issueKey)).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_CONFLICT"});

  const requestInput={storeId,category:"supplies" as const,description:"Idempotent request",attachmentPhotoIds:[]};
  const requestKey=`request-create-${suffix}`;
  const [requestA,requestRetry]=await Promise.all([service.createRequest(staff(),requestInput,requestKey),service.createRequest(staff(),requestInput,requestKey)]);
  requestIds.push(requestA.id);
  expect(requestRetry.id).toBe(requestA.id);
  expect((await db.select().from(operationalRequestHistory).where(eq(operationalRequestHistory.requestId,requestA.id))).length).toBe(1);
  await expect(service.createRequest(staff(),{...requestInput,description:"Different payload"},requestKey)).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_CONFLICT"});
 });
 test("serves evidence only through an authorized parent operation",async()=>{
  const issue=await service.createIssue(staff(),{storeId,category:"equipment",title:"Касса",description:"Проверка закрытого файла",priority:"normal",photoIds:[photoId]});issueId=issue.id;issueIds.push(issueId);
  await expect(service.getEvidence(other(),"store_issue",issueId,photoId)).rejects.toMatchObject({status:404});
  await expect(service.getEvidence(staff(),"store_issue",issueId,photoId)).resolves.toMatchObject({mimeType:"image/jpeg",filename:"one.jpg"});
  await expect(service.getEvidence(staff(),"store_issue",issueId,crypto.randomUUID())).rejects.toMatchObject({status:404});
 });

 test("serializes concurrent campaign and inspection reviews, and inspection retries",async()=>{
  const campaign=await service.createCampaign(admin(),{title:"Concurrent review",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]});campaignIds.push(campaign.id);await service.publishCampaign(admin(),campaign.id);await service.submitCampaign(staff(),campaign.id,storeId,{actionResults:[],photoIds:[],idempotencyKey:"parallel-campaign-submit"});
  const [execution]=await db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,campaign.id),eq(retailCampaignExecutions.storeId,storeId))).limit(1);
  const campaignReviews=await Promise.allSettled([service.reviewCampaign(manager(),execution!.id,{decision:"checked",comment:""}),service.reviewCampaign(admin(),execution!.id,{decision:"rejected",comment:"Нужна корректировка"})]);
  expect(campaignReviews.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(campaignReviews.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect(campaignReviews.find(x=>x.status==="rejected")).toMatchObject({reason:{status:409}});
  expect((await db.select().from(retailCampaignReviews).where(eq(retailCampaignReviews.executionId,execution!.id))).length).toBe(1);
  expect((await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,execution!.id),inArray(domainEvents.eventType,["campaign.execution_checked","campaign.execution_rejected"])))).length).toBe(1);

  const display=await service.createDisplay(manager(),{storeId,name:"Промо",brand:"A",referencePhotoId:photoId,checklist:["Цена"]});displayIds.push(display.id);
  const samePayload={actualPhotoId:photoId2,checklistResults:[true],idempotencyKey:"parallel-inspection-same"};
  const duplicate=await Promise.all([service.submitInspection(staff(),display.id,samePayload),service.submitInspection(staff(),display.id,samePayload)]);expect(duplicate[0]!.id).toBe(duplicate[1]!.id);
  const [inspection]=await db.select().from(merchandisingInspections).where(eq(merchandisingInspections.idempotencyKey,samePayload.idempotencyKey));expect(inspection).toBeDefined();
  expect((await db.select().from(merchandisingReviewHistory).where(eq(merchandisingReviewHistory.inspectionId,inspection!.id))).length).toBe(1);
  expect((await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,inspection!.id),eq(domainEvents.eventType,"merchandising.submitted")))).length).toBe(1);

  const conflicting={idempotencyKey:"parallel-inspection-conflict",checklistResults:[true]};
  const conflict=await Promise.allSettled([service.submitInspection(staff(),display.id,{...conflicting,actualPhotoId:photoId}),service.submitInspection(staff(),display.id,{...conflicting,actualPhotoId:photoId2})]);
  expect(conflict.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(conflict.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect(conflict.find(x=>x.status==="rejected")).toMatchObject({reason:{status:409}});
  const conflictRows=await db.select().from(merchandisingInspections).where(eq(merchandisingInspections.idempotencyKey,conflicting.idempotencyKey));expect(conflictRows).toHaveLength(1);expect(conflictRows[0]!.version).toBe(2);
  expect((await db.select().from(merchandisingReviewHistory).where(eq(merchandisingReviewHistory.inspectionId,conflictRows[0]!.id))).length).toBe(1);expect((await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,conflictRows[0]!.id),eq(domainEvents.eventType,"merchandising.submitted")))).length).toBe(1);
  const inspectionReviews=await Promise.allSettled([service.reviewInspection(manager(),inspection!.id,{decision:"checked",comment:""}),service.reviewInspection(admin(),inspection!.id,{decision:"rejected",comment:"Повторить"})]);
  expect(inspectionReviews.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(inspectionReviews.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect(inspectionReviews.find(x=>x.status==="rejected")).toMatchObject({reason:{status:409}});
  expect((await db.select().from(merchandisingReviewHistory).where(eq(merchandisingReviewHistory.inspectionId,inspection!.id))).length).toBe(2);
  expect((await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,inspection!.id),inArray(domainEvents.eventType,["merchandising.checked","merchandising.rejected"])))).length).toBe(1);
 });

 test("serializes conflicting issue and request decisions with single history and event rows",async()=>{
  const issue=await service.createIssue(staff(),{storeId,category:"equipment",title:"Терминал",description:"Не включается",priority:"normal",photoIds:[]});issueIds.push(issue.id);
  const priority=await Promise.allSettled([service.changeIssuePriority(manager(),issue.id,{priority:"high",expectedPriority:"normal"}),service.changeIssuePriority(admin(),issue.id,{priority:"urgent",expectedPriority:"normal"})]);
  expect(priority.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(priority.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect(priority.find(x=>x.status==="rejected")).toMatchObject({reason:{status:409}});
  expect((await db.select().from(storeIssueHistory).where(and(eq(storeIssueHistory.issueId,issue.id),eq(storeIssueHistory.action,"priority_changed")))).length).toBe(1);
  const [priorityHistory]=await db.select().from(storeIssueHistory).where(and(eq(storeIssueHistory.issueId,issue.id),eq(storeIssueHistory.action,"priority_changed")));expect(priorityHistory).toMatchObject({previousPriority:"normal"});expect(priorityHistory!.newPriority).not.toBeNull();expect(["high","urgent"]).toContain(priorityHistory!.newPriority as string);expect((await service.getIssue(manager(),issue.id)).status).toBe("open");
  expect((await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,issue.id),eq(domainEvents.eventType,"store_issue.priority_changed")))).length).toBe(1);
  await expect(service.changeIssuePriority(other(),issue.id,{priority:"low",expectedPriority:"normal"})).rejects.toMatchObject({status:403});
  await expect(service.changeIssuePriority(manager(),issue.id,{priority:"low",expectedPriority:"normal"})).rejects.toMatchObject({status:409});
  await expect(service.changeIssuePriority(manager(),issue.id,{priority:"critical",expectedPriority:"normal"})).rejects.toMatchObject({status:400});

  const request=await service.createRequest(staff(),{storeId,category:"supplies",description:"Перчатки",attachmentPhotoIds:[]});requestId=request.id;requestIds.push(request.id);
  const decisions=await Promise.allSettled([service.decideRequest(manager(),request.id,{decision:"approved",comment:""}),service.decideRequest(admin(),request.id,{decision:"rejected",comment:"Нет в наличии"})]);
  expect(decisions.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(decisions.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect(decisions.find(x=>x.status==="rejected")).toMatchObject({reason:{status:409}});
  expect((await db.select().from(operationalRequestHistory).where(eq(operationalRequestHistory.requestId,request.id))).length).toBe(2);
  expect((await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,request.id),inArray(domainEvents.eventType,["operational_request.approved","operational_request.rejected"])))).length).toBe(1);
 });

 test("authorizes evidence per parent, snapshots inspection media, and keeps campaign references shared only to targets",async()=>{
  const campaign=await service.createCampaign(admin(),{title:"Shared reference",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId,storeId,otherStoreId],requiredActions:[],requiresPhoto:true,referencePhotoIds:[photoId]});campaignIds.push(campaign.id);
  expect(campaign.storeIds.sort()).toEqual([storeId,otherStoreId].sort());expect(campaign.referencePhotoIds).toEqual([photoId]);
  await service.updateCampaign(admin(),campaign.id,{storeIds:[storeId,otherStoreId,otherStoreId]});expect((await service.getCampaign(admin(),campaign.id)).storeIds).toHaveLength(2);
  await expect(service.updateCampaign(admin(),campaign.id,{storeIds:[]})).rejects.toMatchObject({status:400});
  await expect(service.createCampaign(admin(),{title:"Empty targets",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]})).rejects.toMatchObject({status:400});
  await expect(service.createCampaign(admin(),{title:"Invalid store",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[crypto.randomUUID()],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]})).rejects.toMatchObject({status:404});
  await expect(service.createCampaign(admin(),{title:"Invalid target media",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId],requiredActions:[],requiresPhoto:false,referencePhotoIds:[otherPhotoId]})).rejects.toMatchObject({status:403});
  const race=await service.createCampaign(admin(),{title:"Before publish",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]});campaignIds.push(race.id);
  const raceResults=await Promise.allSettled([service.updateCampaign(admin(),race.id,{title:"Updated before publish"}),service.publishCampaign(admin(),race.id)]);expect(raceResults[1]!.status).toBe("fulfilled");const raceCurrent=await service.getCampaign(admin(),race.id);expect(raceCurrent.status).not.toBe("draft");expect(raceCurrent.title).toMatch(/Before publish|Updated before publish/);
  const raceTargets=await db.select().from(retailCampaignStores).where(eq(retailCampaignStores.campaignId,race.id));const raceExecutions=await db.select().from(retailCampaignExecutions).where(eq(retailCampaignExecutions.campaignId,race.id));expect(raceTargets.map(x=>x.storeId).sort()).toEqual(raceExecutions.map(x=>x.storeId).sort());
  await service.publishCampaign(admin(),campaign.id);
  await expect(service.updateCampaign(admin(),campaign.id,{storeIds:[storeId]})).rejects.toMatchObject({status:409});
  await expect(service.getEvidence(other(),"campaign_reference",campaign.id,photoId)).resolves.toMatchObject({filename:"one.jpg"});
  await service.submitCampaign(staff(),campaign.id,storeId,{actionResults:[],photoIds:[photoId2],employeeNote:"Выполнение подтверждено",idempotencyKey:"campaign-evidence-1"});
  expect((await service.getCampaign(staff(),campaign.id)).executions?.find((x:any)=>x.storeId===storeId)).toMatchObject({employeeNote:"Выполнение подтверждено"});
  expect((await service.campaignHistory(staff(),campaign.id)).data).toContainEqual(expect.objectContaining({action:"submitted",comment:"Выполнение подтверждено"}));
  const [execution]=await db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,campaign.id),eq(retailCampaignExecutions.storeId,storeId))).limit(1);
  const [submission]=await db.select().from(retailCampaignSubmissions).where(eq(retailCampaignSubmissions.executionId,execution!.id));
  expect((await db.select().from(retailCampaignSubmissionPhotos).where(eq(retailCampaignSubmissionPhotos.submissionId,submission!.id))).map(x=>x.photoId)).toEqual([photoId2]);
  await expect(service.getEvidence(staff(),"campaign_execution",execution!.id,photoId2)).resolves.toMatchObject({filename:"two.jpg"});
  await expect(service.getEvidence(other(),"campaign_execution",execution!.id,photoId2)).rejects.toMatchObject({status:404});
  await expect(service.submitCampaign(staff(),campaign.id,storeId,{actionResults:[],photoIds:[otherPhotoId],idempotencyKey:"campaign-cross-store-photo"})).rejects.toMatchObject({status:403});
  await service.reviewCampaign(manager(),execution!.id,{decision:"rejected",comment:"Переснять"});await service.submitCampaign(staff(),campaign.id,storeId,{actionResults:[],photoIds:[photoId],idempotencyKey:"campaign-evidence-2"});
  const versions=await db.select().from(retailCampaignSubmissions).where(eq(retailCampaignSubmissions.executionId,execution!.id)).orderBy(desc(retailCampaignSubmissions.version));expect(versions.map(x=>x.version)).toEqual([2,1]);
  await expect(service.getEvidence(staff(),"campaign_submission",versions[1]!.id,photoId2)).resolves.toMatchObject({filename:"two.jpg"});
  await expect(service.getEvidence(staff(),"campaign_execution",execution!.id,photoId2)).rejects.toMatchObject({status:404});
  await expect(service.getEvidence(staff(),"campaign_execution",execution!.id,photoId)).resolves.toMatchObject({filename:"one.jpg"});

  const display=await service.createDisplay(manager(),{storeId,name:"Витрина A",brand:"Brand",referencePhotoId:photoId2,checklist:["Прайс"]});displayIds.push(display.id);
  expect((await service.listDisplays(staff(),{storeId,page:1,pageSize:10})).data).toContainEqual(expect.objectContaining({displayId:display.id,status:"draft",active:true}));
  await expect(service.getEvidence(staff(),"merchandising_display",display.id,photoId2)).resolves.toMatchObject({filename:"two.jpg"});
  await expect(service.getEvidence(other(),"merchandising_display",display.id,photoId2)).rejects.toMatchObject({status:403});
  const inspection=await service.submitInspection(staff(),display.id,{actualPhotoId:photoId,checklistResults:[true],employeeNote:"Фото сделано после поправки",idempotencyKey:"snapshot-inspection"});
  await expect(service.getInspection(staff(),inspection.id)).resolves.toMatchObject({id:inspection.id,employeeNote:"Фото сделано после поправки",displayId:display.id});
  await expect(service.getInspection(other(),inspection.id)).rejects.toMatchObject({status:404});
  await service.updateDisplay(manager(),display.id,{name:"Витрина B",brand:"New brand",referencePhotoId:photoId});
  const inspectionList=await service.listDisplays(manager(),{page:1,pageSize:10,status:"submitted"});const historic=inspectionList.data.find((x:any)=>x.id===inspection.id);
  expect(historic).toMatchObject({displayName:"Витрина A",brand:"Brand",referencePhotoId:photoId2,employeeNote:"Фото сделано после поправки"});
  await expect(service.getEvidence(staff(),"merchandising_inspection",inspection.id,photoId2)).resolves.toMatchObject({filename:"two.jpg"});
  await expect(service.getEvidence(staff(),"merchandising_inspection",inspection.id,otherPhotoId)).rejects.toMatchObject({status:404});
  await expect(service.updateDisplay(other(),display.id,{name:"Cross-store"})).rejects.toMatchObject({status:403});
  await service.updateDisplay(manager(),display.id,{active:false});await expect(service.submitInspection(staff(),display.id,{actualPhotoId:photoId,checklistResults:[true],idempotencyKey:"inactive-display"})).rejects.toMatchObject({status:404});
  expect((await service.listDisplays(manager(),{page:1,pageSize:10})).data.some((row:any)=>row.displayId===display.id)).toBe(false);
  expect((await service.listDisplays(manager(),{page:1,pageSize:10,includeInactive:true})).data.find((row:any)=>row.displayId===display.id)).toMatchObject({active:false,currentDisplay:{active:false,name:"Витрина B"}});
  expect((await service.listDisplays(manager(),{page:1,pageSize:10,active:false})).data.some((row:any)=>row.displayId===display.id)).toBe(true);
  expect((await service.listDisplays(staff(),{storeId,page:1,pageSize:10,active:false,includeInactive:true})).data.some((row:any)=>row.displayId===display.id)).toBe(false);
  expect((await service.inspectionHistory(manager(),inspection.id)).data).toHaveLength(1);await expect(service.getEvidence(staff(),"merchandising_inspection",inspection.id,photoId2)).resolves.toMatchObject({filename:"two.jpg"});

  const issue=await service.createIssue(staff(),{storeId,category:"equipment",title:"Issue evidence",description:"evidence",photoIds:[photoId]});issueIds.push(issue.id);
  const request=await service.createRequest(staff(),{storeId,category:"supplies",description:"Request evidence",attachmentPhotoIds:[photoId2]});requestIds.push(request.id);
  expect((await db.select().from(storeIssuePhotos).where(eq(storeIssuePhotos.issueId,issue.id))).map(x=>x.photoId)).toEqual([photoId]);
  expect((await db.select().from(operationalRequestPhotos).where(eq(operationalRequestPhotos.requestId,request.id))).map(x=>x.photoId)).toEqual([photoId2]);
  await expect(service.getEvidence(staff(),"store_issue",issue.id,photoId)).resolves.toMatchObject({filename:"one.jpg"});
  await expect(service.getEvidence(staff(),"operational_request",request.id,photoId2)).resolves.toMatchObject({filename:"two.jpg"});
  await expect(service.getEvidence(staff(),"store_issue",issue.id,photoId2)).rejects.toMatchObject({status:404});
  await expect(service.createRequest(staff(),{storeId,category:"supplies",description:"bad evidence",attachmentPhotoIds:[otherPhotoId]})).rejects.toMatchObject({status:403});
  await expect(service.getEvidence(staff(),"operational_request",request.id,crypto.randomUUID())).rejects.toMatchObject({status:404});
  await expect(service.getEvidence(staff(),"store_issue",crypto.randomUUID(),photoId)).rejects.toMatchObject({status:404});
  await db.delete(userStores).where(and(eq(userStores.userId,staffId),eq(userStores.storeId,storeId)));
  await expect(service.getEvidence(staff(),"store_issue",issue.id,photoId)).rejects.toMatchObject({status:403});
  await db.insert(userStores).values({userId:staffId,storeId});
 });

 test("enforces live RBAC scope, active identities, assignees and self-review rules",async()=>{
  const issue1=await service.createIssue(staff(),{storeId,category:"lighting",title:"Store one",description:"one",photoIds:[]});issueIds.push(issue1.id);
  const issue2=await service.createIssue(other(),{storeId:otherStoreId,category:"lighting",title:"Store two",description:"two",photoIds:[]});issueIds.push(issue2.id);
  expect((await service.listIssues(manager(),{page:1,pageSize:50})).data.map((x:any)=>x.id)).toContain(issue1.id);
  expect((await service.listIssues(manager(),{page:1,pageSize:50})).data.map((x:any)=>x.id)).not.toContain(issue2.id);
  expect((await service.listIssues(manager(),{page:1,pageSize:50,storeId:otherStoreId})).pagination.total).toBe(0);
  await expect(service.getIssue(manager(),issue2.id)).rejects.toMatchObject({status:403});await expect(service.issueHistory(manager(),issue2.id)).rejects.toMatchObject({status:403});
  await expect(service.getIssue(other(),issue1.id)).rejects.toMatchObject({status:404});
  const managerReported=await service.createIssue(manager(),{storeId,category:"lighting",title:"Not staff-owned",description:"manager report",photoIds:[]});issueIds.push(managerReported.id);await expect(service.getIssue(staff(),managerReported.id)).rejects.toMatchObject({status:404});
  await expect(service.updateIssue(manager(),issue1.id,{assignedTo:otherStaffId})).rejects.toMatchObject({status:400});
  await expect(service.getIssue(admin(),issue2.id)).resolves.toMatchObject({id:issue2.id});
  await db.delete(userStores).where(and(eq(userStores.userId,managerId),eq(userStores.storeId,storeId)));
  await expect(service.getIssue(manager(),issue1.id)).rejects.toMatchObject({status:403});
  await db.insert(userStores).values({userId:managerId,storeId});
  await db.update(users).set({isActive:false}).where(eq(users.id,staffId));
  expect((await service.listRequests(staff(),{page:1,pageSize:50})).pagination.total).toBe(0);
  await db.update(users).set({isActive:true}).where(eq(users.id,staffId));
  await db.update(stores).set({isActive:false}).where(eq(stores.id,otherStoreId));
  expect((await service.listIssues(other(),{page:1,pageSize:50})).pagination.total).toBe(0);
  await expect(service.getIssue(other(),issue2.id)).rejects.toMatchObject({status:404});
  await db.update(stores).set({isActive:true}).where(eq(stores.id,otherStoreId));

  const campaign=await service.createCampaign(admin(),{title:"No self review",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]});campaignIds.push(campaign.id);await service.publishCampaign(admin(),campaign.id);
  await service.submitCampaign(manager(),campaign.id,storeId,{actionResults:[],photoIds:[],idempotencyKey:"self-review-check"});
  const [execution]=await db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,campaign.id),eq(retailCampaignExecutions.storeId,storeId))).limit(1);
  await expect(service.reviewCampaign(manager(),execution!.id,{decision:"checked",comment:""})).rejects.toMatchObject({status:403});
 });

 test("routes durable operation events to scoped recipients once with safe operation targets",async()=>{
  const notificationService=createNotificationsService(db);
  const campaign=await service.createCampaign(admin(),{title:"Notification campaign",startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),timezone:"Europe/Chisinau",storeIds:[storeId,otherStoreId],requiredActions:[],requiresPhoto:false,referencePhotoIds:[]});campaignIds.push(campaign.id);await service.publishCampaign(admin(),campaign.id);
  const [published]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,campaign.id),eq(domainEvents.eventType,"campaign.published"))).limit(1);expect(published).toBeDefined();expect(await notificationService.consumeEvent(published!.id)).toBe(true);expect(await notificationService.consumeEvent(published!.id)).toBe(false);
  const publishedNotifications=await db.select().from(notifications).where(eq(notifications.sourceEventId,published!.id));expect(publishedNotifications.map(n=>n.recipientUserId).sort()).toEqual([staffId,otherStaffId].sort());expect(publishedNotifications.filter(n=>n.recipientUserId===staffId)).toHaveLength(1);expect(publishedNotifications.every(n=>n.targetKind==="operation"&&n.targetId===campaign.id)).toBe(true);

  await service.submitCampaign(staff(),campaign.id,storeId,{actionResults:[],photoIds:[],idempotencyKey:"notification-submit"});const [execution]=await db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,campaign.id),eq(retailCampaignExecutions.storeId,storeId))).limit(1);await service.reviewCampaign(manager(),execution!.id,{decision:"checked",comment:""});
  const [reviewEvent]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,execution!.id),eq(domainEvents.eventType,"campaign.execution_checked"))).limit(1);await notificationService.consumeEvent(reviewEvent!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,reviewEvent!.id))).map(n=>n.recipientUserId)).toEqual([staffId]);

  const display=await service.createDisplay(manager(),{storeId,name:"Notify display",brand:"Brand",referencePhotoId:photoId,checklist:[]});displayIds.push(display.id);const inspection=await service.submitInspection(staff(),display.id,{actualPhotoId:photoId2,checklistResults:[],idempotencyKey:"notify-inspection"});await service.reviewInspection(manager(),inspection.id,{decision:"rejected",comment:"Повторить"});const [inspectionEvent]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,inspection.id),eq(domainEvents.eventType,"merchandising.rejected"))).limit(1);await notificationService.consumeEvent(inspectionEvent!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,inspectionEvent!.id))).map(n=>n.recipientUserId)).toEqual([staffId]);
  const approvedDisplay=await service.createDisplay(manager(),{storeId,name:"Approved display",brand:"Brand",referencePhotoId:photoId,checklist:[]});displayIds.push(approvedDisplay.id);const approvedInspection=await service.submitInspection(staff(),approvedDisplay.id,{actualPhotoId:photoId2,checklistResults:[],idempotencyKey:"notify-inspection-approved"});await service.reviewInspection(manager(),approvedInspection.id,{decision:"checked",comment:""});const [approvedInspectionEvent]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,approvedInspection.id),eq(domainEvents.eventType,"merchandising.checked"))).limit(1);await notificationService.consumeEvent(approvedInspectionEvent!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,approvedInspectionEvent!.id))).map(n=>n.recipientUserId)).toEqual([staffId]);

  const issue=await service.createIssue(staff(),{storeId,category:"equipment",title:"Assigned issue",description:"notify",photoIds:[]});issueIds.push(issue.id);await service.updateIssue(manager(),issue.id,{assignedTo:staffId});const [issueAssigned]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,issue.id),eq(domainEvents.eventType,"store_issue.assigned"))).limit(1);await notificationService.consumeEvent(issueAssigned!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,issueAssigned!.id))).map(n=>n.recipientUserId)).toEqual([staffId]);await db.insert(userStores).values({userId:otherStaffId,storeId});await service.updateIssue(manager(),issue.id,{assignedTo:otherStaffId});const [issueReassigned]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,issue.id),eq(domainEvents.eventType,"store_issue.assigned"))).orderBy(desc(domainEvents.createdAt)).limit(1);await notificationService.consumeEvent(issueReassigned!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,issueReassigned!.id))).map(n=>n.recipientUserId)).toEqual([otherStaffId]);await db.delete(userStores).where(and(eq(userStores.userId,otherStaffId),eq(userStores.storeId,storeId)));

  const request=await service.createRequest(staff(),{storeId,category:"supplies",description:"Notify request",attachmentPhotoIds:[]});requestIds.push(request.id);await service.decideRequest(manager(),request.id,{decision:"approved",comment:""});const [decision]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,request.id),eq(domainEvents.eventType,"operational_request.approved"))).limit(1);await notificationService.consumeEvent(decision!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,decision!.id))).map(n=>n.recipientUserId)).toEqual([staffId]);await service.updateRequest(manager(),request.id,{status:"in_progress"});await service.updateRequest(manager(),request.id,{status:"completed"});const [completed]=await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateId,request.id),eq(domainEvents.eventType,"operational_request.completed"))).limit(1);await notificationService.consumeEvent(completed!.id);expect((await db.select().from(notifications).where(eq(notifications.sourceEventId,completed!.id))).map(n=>n.recipientUserId)).toEqual([staffId]);

  const before=(await db.select().from(domainEvents).where(and(eq(domainEvents.actorId,staffId),eq(domainEvents.eventType,"store_issue.created")))).length;await expect(service.createIssue(staff(),{storeId,category:"equipment",title:"Rollback",description:"invalid",photoIds:[otherPhotoId]})).rejects.toMatchObject({status:403});expect((await db.select().from(domainEvents).where(and(eq(domainEvents.actorId,staffId),eq(domainEvents.eventType,"store_issue.created")))).length).toBe(before);
 });
});
