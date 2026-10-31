import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { domainEvents, merchandisingDisplays, merchandisingInspections, merchandisingReviewHistory, operationalRequestHistory, operationalRequestPhotos, operationalRequests, photos, retailCampaignExecutions, retailCampaignReferencePhotos, retailCampaignReviews, retailCampaignStores, retailCampaignSubmissionPhotos, retailCampaignSubmissions, retailCampaigns, storeIssueHistory, storeIssuePhotos, storeIssues, stores, userStores, users } from "../../db/schema";
import type { TrustedPrincipal } from "../authz";
import { assertActivePrincipal } from "../authz";
import { DomainError } from "../errors";
import { campaignCreateSchema, campaignUpdateSchema, campaignQuerySchema, campaignReviewSchema, campaignSubmissionSchema, issueCreateSchema, issuePriorityChangeSchema, issueQuerySchema, issueUpdateSchema, merchandisingDisplayCreateSchema, merchandisingDisplayUpdateSchema, merchandisingQuerySchema, merchandisingReviewSchema, inspectionSubmitSchema, requestCreateSchema, requestDecisionSchema, requestQuerySchema, requestUpdateSchema } from "@vizaje/contracts";
import type { PhotoStorage } from "../../storage/photo-storage";
import { z } from "zod";

type Tx = any;
function parseInput<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const parsed=schema.safeParse(value);if(!parsed.success)throw new DomainError(400,"VALIDATION_ERROR",parsed.error.issues[0]?.message??"Некорректные данные");return parsed.data;}
function requestHash(value:unknown):string{return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function manage(principal: TrustedPrincipal) { assertActivePrincipal(principal); if (principal.role === "staff") throw new DomainError(403,"FORBIDDEN","Недостаточно прав для управления операциями"); }
function scope(principal: TrustedPrincipal, storeId: string) { assertActivePrincipal(principal); if (principal.role !== "admin" && !principal.storeIds.includes(storeId)) throw new DomainError(403,"STORE_FORBIDDEN","Магазин находится вне зоны доступа"); }
function iso(value: Date) { return value.toISOString(); }

export class OperationsService {
  constructor(private readonly db: Database, private readonly storage: PhotoStorage) {}
  private async activeStore(storeId: string, tx: Tx = this.db) { const [store] = await tx.select().from(stores).where(eq(stores.id,storeId)).limit(1); if (!store?.isActive) throw new DomainError(404,"STORE_NOT_FOUND","Магазин не найден или неактивен"); return store; }
  private async activeScopeIds(p:TrustedPrincipal):Promise<string[]>{assertActivePrincipal(p);if(p.role==="admin"){const rows=await this.db.select({storeId:stores.id}).from(stores).where(eq(stores.isActive,true));return rows.map((row:any)=>row.storeId as string);}const rows=await this.db.select({storeId:userStores.storeId}).from(userStores).innerJoin(users,eq(users.id,userStores.userId)).innerJoin(stores,eq(stores.id,userStores.storeId)).where(and(eq(userStores.userId,p.userId),eq(users.isActive,true),eq(stores.isActive,true)));return rows.map((row:any)=>row.storeId as string);}
  private async enforceScope(p:TrustedPrincipal,storeId:string,tx:Tx=this.db){scope(p,storeId);await this.activeStore(storeId,tx);if(p.role!=="admin"){const [membership]=await tx.select({userId:userStores.userId}).from(userStores).innerJoin(users,eq(users.id,userStores.userId)).where(and(eq(userStores.userId,p.userId),eq(userStores.storeId,storeId),eq(users.isActive,true))).limit(1);if(!membership)throw new DomainError(403,"STORE_FORBIDDEN","Нет активного доступа к магазину");}}
  private async validateAssignee(tx:Tx,storeId:string,userId:string|null|undefined){if(!userId)return;const [row]=await tx.select({id:users.id,role:users.role,isActive:users.isActive}).from(users).innerJoin(userStores,eq(userStores.userId,users.id)).innerJoin(stores,eq(stores.id,userStores.storeId)).where(and(eq(users.id,userId),eq(userStores.storeId,storeId),eq(users.isActive,true),eq(stores.isActive,true))).limit(1);if(!row?.isActive||!['staff','manager'].includes(row.role))throw new DomainError(400,"ASSIGNEE_INVALID","Ответственный должен быть активным сотрудником этого магазина");}
  private async validPhotos(ids: string[], storeId: string|string[], tx: Tx) { if (!ids.length) return; const allowed=Array.isArray(storeId)?storeId:[storeId]; const rows = await tx.select({id:photos.id,storeId:photos.storeId}).from(photos).where(inArray(photos.id,ids)); if (rows.length !== new Set(ids).size || rows.some((p:any)=>!allowed.includes(p.storeId))) throw new DomainError(403,"EVIDENCE_FORBIDDEN","Фото недоступно для целевых магазинов"); }
  async getEvidence(p:TrustedPrincipal,kind:string,recordId:string,photoId:string){
    assertActivePrincipal(p);let authorizedStoreId:string|undefined;let ownerId:string|undefined;let mediaStoreId:string|undefined;let linked=false;
    if(kind==="campaign_execution"){
      const [e]=await this.db.select().from(retailCampaignExecutions).where(eq(retailCampaignExecutions.id,recordId)).limit(1);
      if(e){authorizedStoreId=e.storeId;const [latest]=await this.db.select().from(retailCampaignSubmissions).where(eq(retailCampaignSubmissions.executionId,recordId)).orderBy(desc(retailCampaignSubmissions.version)).limit(1);ownerId=latest?.submittedBy; if(latest){const [subPhoto]=await this.db.select().from(retailCampaignSubmissionPhotos).where(and(eq(retailCampaignSubmissionPhotos.submissionId,latest.id),eq(retailCampaignSubmissionPhotos.photoId,photoId))).limit(1);linked=Boolean(subPhoto);}}
    } else if(kind==="campaign_submission"){
      const [submission]=await this.db.select({submission:retailCampaignSubmissions,storeId:retailCampaignExecutions.storeId}).from(retailCampaignSubmissions).innerJoin(retailCampaignExecutions,eq(retailCampaignExecutions.id,retailCampaignSubmissions.executionId)).where(eq(retailCampaignSubmissions.id,recordId)).limit(1);
      if(submission){authorizedStoreId=submission.storeId;ownerId=submission.submission.submittedBy;const [link]=await this.db.select().from(retailCampaignSubmissionPhotos).where(and(eq(retailCampaignSubmissionPhotos.submissionId,recordId),eq(retailCampaignSubmissionPhotos.photoId,photoId))).limit(1);linked=Boolean(link);}
    } else if(kind==="merchandising_inspection"){
      const [r]=await this.db.select({inspection:merchandisingInspections,display:merchandisingDisplays}).from(merchandisingInspections).innerJoin(merchandisingDisplays,eq(merchandisingDisplays.id,merchandisingInspections.displayId)).where(eq(merchandisingInspections.id,recordId)).limit(1);
      if(r){authorizedStoreId=r.display.storeId;ownerId=r.inspection.submittedBy??undefined;linked=r.inspection.actualPhotoId===photoId||r.inspection.referencePhotoId===photoId;}
    } else if(kind==="merchandising_display"){
      const [display]=await this.db.select().from(merchandisingDisplays).where(eq(merchandisingDisplays.id,recordId)).limit(1);
      if(display){authorizedStoreId=display.storeId;linked=display.referencePhotoId===photoId;}
    } else if(kind==="store_issue"){
      const [r]=await this.db.select().from(storeIssues).where(eq(storeIssues.id,recordId)).limit(1);
      if(r){authorizedStoreId=r.storeId;ownerId=r.reporterId;const [link]=await this.db.select().from(storeIssuePhotos).where(and(eq(storeIssuePhotos.issueId,recordId),eq(storeIssuePhotos.photoId,photoId))).limit(1);linked=Boolean(link);}
    } else if(kind==="operational_request"){
      const [r]=await this.db.select().from(operationalRequests).where(eq(operationalRequests.id,recordId)).limit(1);
      if(r){authorizedStoreId=r.storeId;ownerId=r.requesterId;const [link]=await this.db.select().from(operationalRequestPhotos).where(and(eq(operationalRequestPhotos.requestId,recordId),eq(operationalRequestPhotos.photoId,photoId))).limit(1);linked=Boolean(link);}
    } else if(kind==="campaign_reference"){
      const [link]=await this.db.select({campaignId:retailCampaignReferencePhotos.campaignId}).from(retailCampaignReferencePhotos).where(and(eq(retailCampaignReferencePhotos.campaignId,recordId),eq(retailCampaignReferencePhotos.photoId,photoId))).limit(1);
      if(link){const targetRows=await this.db.select({storeId:retailCampaignStores.storeId}).from(retailCampaignStores).where(eq(retailCampaignStores.campaignId,recordId));const liveScope=await this.activeScopeIds(p);const accessible=targetRows.filter((x:any)=>liveScope.includes(x.storeId));if(accessible.length){authorizedStoreId=accessible[0].storeId;linked=true;const [media]=await this.db.select({storeId:photos.storeId}).from(photos).where(eq(photos.id,photoId)).limit(1);mediaStoreId=media?.storeId;}}
    } else throw new DomainError(404,"EVIDENCE_NOT_FOUND","Файл не найден");
    if(!authorizedStoreId||!linked||(p.role==="staff"&&!['campaign_reference','merchandising_display'].includes(kind)&&ownerId!==p.userId))throw new DomainError(404,"EVIDENCE_NOT_FOUND","Файл не найден");
    await this.enforceScope(p,authorizedStoreId);const [media]=await this.db.select().from(photos).where(and(eq(photos.id,photoId),mediaStoreId?eq(photos.storeId,mediaStoreId):eq(photos.storeId,authorizedStoreId))).limit(1);
    if(!media||kind!=="campaign_reference"&&media.storeId!==authorizedStoreId)throw new DomainError(404,"EVIDENCE_NOT_FOUND","Файл не найден");const body=await this.storage.get(media.storageKey);if(!body)throw new DomainError(503,"PHOTO_STORAGE_UNAVAILABLE","Хранилище фото недоступно");return {body,mimeType:media.mimeType,filename:media.originalFilename};
  }
  private async event(tx: Tx, type: string, kind: string, id: string, actorId: string, storeId: string, extra:Record<string,unknown>={}) { const payload={...(storeId?{storeId}:{}),...extra};await tx.insert(domainEvents).values({eventType:type,aggregateType:kind,aggregateId:id,actorId,payload}); }
  private pagination(page:number,pageSize:number,total:number){return {page,pageSize,total,totalPages:Math.ceil(total/pageSize)}}

  async listCampaigns(p:TrustedPrincipal,input:unknown){assertActivePrincipal(p);const q=parseInput(campaignQuerySchema,input);const activeIds=await this.activeScopeIds(p);if(q.storeId&&!activeIds.includes(q.storeId))return {data:[],pagination:this.pagination(q.page,q.pageSize,0)};const storeFilter=p.role==="admin"?(q.storeId?[q.storeId]:undefined):(q.storeId?[q.storeId]:[...activeIds]);const matches=await this.db.select({id:retailCampaigns.id}).from(retailCampaigns).innerJoin(retailCampaignStores,eq(retailCampaignStores.campaignId,retailCampaigns.id)).where(and(p.role==="staff"?inArray(retailCampaigns.status,["scheduled","active"]):q.status?eq(retailCampaigns.status,q.status):undefined,storeFilter?inArray(retailCampaignStores.storeId,storeFilter):undefined));const ids=[...new Set(matches.map((x:any)=>x.id))];const total=ids.length;const pageIds=ids.slice((q.page-1)*q.pageSize,q.page*q.pageSize);return {data:await Promise.all(pageIds.map(id=>this.getCampaign(p,id))),pagination:this.pagination(q.page,q.pageSize,total)}}
  async campaignHistory(p:TrustedPrincipal,id:string){const c=await this.getCampaign(p,id);const executionIds=c.executions?.map((x:any)=>x.id)??[];if(!executionIds.length)return {data:[]};const [reviews,submissions]=await Promise.all([this.db.select().from(retailCampaignReviews).where(inArray(retailCampaignReviews.executionId,executionIds)),this.db.select().from(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId,executionIds))]);const history=[...reviews.map((r:any)=>({id:r.id,executionId:r.executionId,actorId:r.actorId,action:r.toStatus,comment:r.comment,createdAt:r.createdAt})),...submissions.map((s:any)=>({id:s.id,executionId:s.executionId,actorId:s.submittedBy,action:"submitted",comment:s.employeeNote||null,version:s.version,createdAt:s.submittedAt}))].sort((a:any,b:any)=>a.createdAt.getTime()-b.createdAt.getTime());return {data:history.map((r:any)=>({...r,createdAt:iso(r.createdAt)}))}}
  async listIssues(p:TrustedPrincipal,input:unknown){assertActivePrincipal(p);const q=parseInput(issueQuerySchema,input);const activeIds=await this.activeScopeIds(p);if(q.storeId&&!activeIds.includes(q.storeId))return {data:[],pagination:this.pagination(q.page,q.pageSize,0)};const visibleIds=q.storeId?[q.storeId]:activeIds;const filters=[inArray(storeIssues.storeId,visibleIds),p.role==="staff"?eq(storeIssues.reporterId,p.userId):undefined,q.status?eq(storeIssues.status,q.status):undefined,q.priority?eq(storeIssues.priority,q.priority):undefined,q.from?gte(storeIssues.createdAt,new Date(q.from)):undefined,q.to?lte(storeIssues.createdAt,new Date(q.to)):undefined];const where=and(...filters);const [{total}]=await this.db.select({total:count()}).from(storeIssues).where(where);const rows=await this.db.select().from(storeIssues).where(where).orderBy(desc(storeIssues.createdAt),desc(storeIssues.id)).limit(q.pageSize).offset((q.page-1)*q.pageSize);const linked=rows.length?await this.db.select().from(storeIssuePhotos).where(inArray(storeIssuePhotos.issueId,rows.map((r:any)=>r.id))):[];const evidenceById=new Map<string,string[]>();for(const link of linked){const values=evidenceById.get(link.issueId)??[];values.push(link.photoId);evidenceById.set(link.issueId,values);}return {data:rows.map((r:any)=>({...r,photoIds:evidenceById.get(r.id)??[],createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt),resolvedAt:r.resolvedAt?iso(r.resolvedAt):null})),pagination:this.pagination(q.page,q.pageSize,total)}}
  async issueHistory(p:TrustedPrincipal,id:string){const [r]=await this.db.select().from(storeIssues).where(eq(storeIssues.id,id)).limit(1);if(!r||p.role==="staff"&&r.reporterId!==p.userId)throw new DomainError(404,"ISSUE_NOT_FOUND","Проблема не найдена");await this.enforceScope(p,r.storeId);const rows=await this.db.select().from(storeIssueHistory).where(eq(storeIssueHistory.issueId,id)).orderBy(storeIssueHistory.createdAt,storeIssueHistory.id);return {data:rows.map((x:any)=>({...x,createdAt:iso(x.createdAt)}))}}
  async getIssue(p:TrustedPrincipal,id:string){const [r]=await this.db.select().from(storeIssues).where(eq(storeIssues.id,id)).limit(1);if(!r||p.role==="staff"&&r.reporterId!==p.userId)throw new DomainError(404,"ISSUE_NOT_FOUND","Проблема не найдена");await this.enforceScope(p,r.storeId);const links=await this.db.select({photoId:storeIssuePhotos.photoId}).from(storeIssuePhotos).where(eq(storeIssuePhotos.issueId,id));return {...r,photoIds:links.map((x:any)=>x.photoId),createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt),resolvedAt:r.resolvedAt?iso(r.resolvedAt):null}}
  async listRequests(p:TrustedPrincipal,input:unknown){assertActivePrincipal(p);const q=parseInput(requestQuerySchema,input);const activeIds=await this.activeScopeIds(p);if(q.storeId&&!activeIds.includes(q.storeId))return {data:[],pagination:this.pagination(q.page,q.pageSize,0)};const visibleIds=q.storeId?[q.storeId]:activeIds;const filters=[inArray(operationalRequests.storeId,visibleIds),p.role==="staff"?eq(operationalRequests.requesterId,p.userId):undefined,q.status?eq(operationalRequests.status,q.status):undefined,q.from?gte(operationalRequests.createdAt,new Date(q.from)):undefined,q.to?lte(operationalRequests.createdAt,new Date(q.to)):undefined];const where=and(...filters);const [{total}]=await this.db.select({total:count()}).from(operationalRequests).where(where);const rows=await this.db.select().from(operationalRequests).where(where).orderBy(desc(operationalRequests.createdAt),desc(operationalRequests.id)).limit(q.pageSize).offset((q.page-1)*q.pageSize);const linked=rows.length?await this.db.select().from(operationalRequestPhotos).where(inArray(operationalRequestPhotos.requestId,rows.map((r:any)=>r.id))):[];const evidenceById=new Map<string,string[]>();for(const link of linked){const values=evidenceById.get(link.requestId)??[];values.push(link.photoId);evidenceById.set(link.requestId,values);}return {data:rows.map((r:any)=>({...r,attachmentPhotoIds:evidenceById.get(r.id)??[],createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt)})),pagination:this.pagination(q.page,q.pageSize,total)}}
  async requestHistory(p:TrustedPrincipal,id:string){const [r]=await this.db.select().from(operationalRequests).where(eq(operationalRequests.id,id)).limit(1);if(!r||p.role==="staff"&&r.requesterId!==p.userId)throw new DomainError(404,"REQUEST_NOT_FOUND","Заявка не найдена");await this.enforceScope(p,r.storeId);const rows=await this.db.select().from(operationalRequestHistory).where(eq(operationalRequestHistory.requestId,id)).orderBy(operationalRequestHistory.createdAt,operationalRequestHistory.id);return {data:rows.map((x:any)=>({...x,createdAt:iso(x.createdAt)}))}}
  async getRequest(p:TrustedPrincipal,id:string){const [r]=await this.db.select().from(operationalRequests).where(eq(operationalRequests.id,id)).limit(1);if(!r||p.role==="staff"&&r.requesterId!==p.userId)throw new DomainError(404,"REQUEST_NOT_FOUND","Заявка не найдена");await this.enforceScope(p,r.storeId);const links=await this.db.select({photoId:operationalRequestPhotos.photoId}).from(operationalRequestPhotos).where(eq(operationalRequestPhotos.requestId,id));return {...r,attachmentPhotoIds:links.map((x:any)=>x.photoId),createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt)}}
  async listDisplays(p:TrustedPrincipal,input:unknown){
    assertActivePrincipal(p);
    const q=parseInput(merchandisingQuerySchema,input);
    const activeIds=await this.activeScopeIds(p);
    if(q.storeId&&!activeIds.includes(q.storeId))return {data:[],pagination:this.pagination(q.page,q.pageSize,0)};
    const visibleIds=q.storeId?[q.storeId]:activeIds;
    const includeInactive=q.includeInactive===true&&p.role!=="staff";
    const activeFilter=p.role==="staff"?eq(merchandisingDisplays.active,true):q.active!==undefined?eq(merchandisingDisplays.active,q.active):includeInactive?undefined:eq(merchandisingDisplays.active,true);
    const filters=[activeFilter,inArray(merchandisingDisplays.storeId,visibleIds)];
    const rows=await this.db.select().from(merchandisingDisplays).where(and(...filters)).orderBy(desc(merchandisingDisplays.updatedAt),desc(merchandisingDisplays.id));
    const inspections=rows.length?await this.db.select().from(merchandisingInspections).where(and(p.role==="staff"?undefined:q.status?eq(merchandisingInspections.status,q.status):undefined,inArray(merchandisingInspections.displayId,rows.map((r:any)=>r.id)))).orderBy(desc(merchandisingInspections.createdAt)):[];
    const selected=rows.flatMap((d:any)=>{
      const related=inspections.filter((i:any)=>i.displayId===d.id);
      if(p.role==="staff"){
        const latest=related.find((i:any)=>i.submittedBy===p.userId)??null;
        return q.status?(latest?.status===q.status?[{display:d,inspection:latest}]:[]):[{display:d,inspection:latest}];
      }
      return q.status?related.map((i:any)=>({display:d,inspection:i})):related.length?related.map((i:any)=>({display:d,inspection:i})):[{display:d,inspection:null}];
    });
    const total=selected.length;
    const pageRows=selected.slice((q.page-1)*q.pageSize,q.page*q.pageSize);
    return {data:pageRows.map(({display:d,inspection:i}:any)=>({id:i?.id??d.id,displayId:d.id,displayName:i?.displayNameSnapshot??d.name,brand:i?.brandSnapshot??d.brand,storeId:d.storeId,referencePhotoId:i?.referencePhotoId??d.referencePhotoId,actualPhotoId:i?.actualPhotoId??null,checklist:i?.checklistSnapshot??d.checklist,checklistResults:i?.checklistResults??[],status:i?.status??"draft",submittedBy:i?.submittedBy??null,reviewerId:i?.reviewerId??null,comment:i?.comment??null,employeeNote:i?.employeeNote??"",active:d.active,currentDisplay:{name:d.name,brand:d.brand,referencePhotoId:d.referencePhotoId,checklist:d.checklist,active:d.active},version:i?.version??null,submittedAt:i?.submittedAt?iso(i.submittedAt):null,reviewedAt:i?.reviewedAt?iso(i.reviewedAt):null,createdAt:iso(i?.createdAt??d.createdAt),updatedAt:iso(i?.updatedAt??d.updatedAt)})),pagination:this.pagination(q.page,q.pageSize,total)}
  }
  async getInspection(p:TrustedPrincipal,id:string){
    assertActivePrincipal(p);
    const [row]=await this.db.select({inspection:merchandisingInspections,display:merchandisingDisplays}).from(merchandisingInspections).innerJoin(merchandisingDisplays,eq(merchandisingDisplays.id,merchandisingInspections.displayId)).where(eq(merchandisingInspections.id,id)).limit(1);
    if(!row||p.role==="staff"&&row.inspection.submittedBy!==p.userId)throw new DomainError(404,"INSPECTION_NOT_FOUND","Проверка не найдена");
    await this.enforceScope(p,row.display.storeId);
    const i=row.inspection,d=row.display;
    return {id:i.id,displayId:d.id,displayName:i.displayNameSnapshot,brand:i.brandSnapshot,storeId:d.storeId,referencePhotoId:i.referencePhotoId,actualPhotoId:i.actualPhotoId,checklist:i.checklistSnapshot,checklistResults:i.checklistResults,status:i.status,submittedBy:i.submittedBy,reviewerId:i.reviewerId,comment:i.comment,employeeNote:i.employeeNote,active:d.active,currentDisplay:{name:d.name,brand:d.brand,referencePhotoId:d.referencePhotoId,checklist:d.checklist,active:d.active},version:i.version,submittedAt:i.submittedAt?iso(i.submittedAt):null,reviewedAt:i.reviewedAt?iso(i.reviewedAt):null,createdAt:iso(i.createdAt),updatedAt:iso(i.updatedAt)};
  }
  async inspectionHistory(p:TrustedPrincipal,id:string){const [i]=await this.db.select({inspection:merchandisingInspections,display:merchandisingDisplays}).from(merchandisingInspections).innerJoin(merchandisingDisplays,eq(merchandisingDisplays.id,merchandisingInspections.displayId)).where(eq(merchandisingInspections.id,id)).limit(1);if(!i||p.role==="staff"&&i.inspection.submittedBy!==p.userId)throw new DomainError(404,"INSPECTION_NOT_FOUND","Проверка не найдена");await this.enforceScope(p,i.display.storeId);const rows=await this.db.select().from(merchandisingReviewHistory).where(eq(merchandisingReviewHistory.inspectionId,id)).orderBy(merchandisingReviewHistory.createdAt,merchandisingReviewHistory.id);return {data:rows.map((r:any)=>({...r,createdAt:iso(r.createdAt)}))}}

  async createCampaign(p:TrustedPrincipal,input:unknown){
    assertActivePrincipal(p);if(p.role!=="admin")throw new DomainError(403,"FORBIDDEN","Создавать кампании может администратор");const d=parseInput(campaignCreateSchema,input);const storeIds=[...new Set(d.storeIds)];const referencePhotoIds=[...new Set(d.referencePhotoIds)];
    const id=await this.db.transaction(async(tx:Tx)=>{for(const sid of storeIds)await this.activeStore(sid,tx);await this.validPhotos(referencePhotoIds,storeIds,tx);
      const [c]=await tx.insert(retailCampaigns).values({title:d.title,description:d.description,startsAt:new Date(d.startsAt),endsAt:new Date(d.endsAt),timezone:d.timezone,requiredActions:d.requiredActions,requiresPhoto:d.requiresPhoto,referencePhotoIds,createdBy:p.userId,status:"draft"}).returning();
      await tx.insert(retailCampaignStores).values(storeIds.map(storeId=>({campaignId:c.id,storeId})));await tx.insert(retailCampaignExecutions).values(storeIds.map(storeId=>({campaignId:c.id,storeId})));
      if(referencePhotoIds.length)await tx.insert(retailCampaignReferencePhotos).values(referencePhotoIds.map(photoId=>({campaignId:c.id,photoId})));return c.id;
    });return this.getCampaign(p,id);
  }
  async updateCampaign(p:TrustedPrincipal,id:string,input:unknown){
    assertActivePrincipal(p);if(p.role!=="admin")throw new DomainError(403,"FORBIDDEN","Изменять кампании может администратор");const d:any=parseInput(campaignUpdateSchema,input);
    const cid=await this.db.transaction(async(tx:Tx)=>{
      const [c]=await tx.select().from(retailCampaigns).where(eq(retailCampaigns.id,id)).for("update").limit(1);if(!c)throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не найдена");if(c.status!=="draft")throw new DomainError(409,"CAMPAIGN_IMMUTABLE","Опубликованную кампанию нельзя изменять");
      const oldTargets=await tx.select().from(retailCampaignStores).where(eq(retailCampaignStores.campaignId,id));const requestedTargets:string[]=(d.storeIds as string[]|undefined)??oldTargets.map((x:any)=>x.storeId as string);const targets:string[]=[...new Set<string>(requestedTargets)];if(!targets.length)throw new DomainError(400,"CAMPAIGN_TARGETS_REQUIRED","Добавьте хотя бы один целевой магазин");for(const sid of targets)await this.activeStore(sid,tx);
      const refs:string[]=d.referencePhotoIds===undefined?(await tx.select({photoId:retailCampaignReferencePhotos.photoId}).from(retailCampaignReferencePhotos).where(eq(retailCampaignReferencePhotos.campaignId,id))).map((x:any)=>x.photoId as string):[...new Set<string>(d.referencePhotoIds as string[])];await this.validPhotos(refs,targets,tx);
      const removed=oldTargets.map((x:any)=>x.storeId).filter((sid:string)=>!targets.includes(sid));
      for(const sid of removed){const [execution]=await tx.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,id),eq(retailCampaignExecutions.storeId,sid))).for("update").limit(1);if(execution&&execution.status!=="not_started")throw new DomainError(409,"CAMPAIGN_TARGET_IN_USE","Нельзя удалить магазин с начатым исполнением");if(execution)await tx.delete(retailCampaignExecutions).where(eq(retailCampaignExecutions.id,execution.id));}
      const newTargets=targets.filter((sid:string)=>!oldTargets.some((x:any)=>x.storeId===sid));if(newTargets.length){await tx.insert(retailCampaignStores).values(newTargets.map((storeId:string)=>({campaignId:id,storeId})));await tx.insert(retailCampaignExecutions).values(newTargets.map((storeId:string)=>({campaignId:id,storeId})));}
      for(const sid of removed)await tx.delete(retailCampaignStores).where(and(eq(retailCampaignStores.campaignId,id),eq(retailCampaignStores.storeId,sid)));
      const values:any={updatedAt:new Date()};if(d.title!==undefined)values.title=d.title;if(d.description!==undefined)values.description=d.description;if(d.startsAt!==undefined)values.startsAt=new Date(d.startsAt);if(d.endsAt!==undefined)values.endsAt=new Date(d.endsAt);if(d.timezone!==undefined)values.timezone=d.timezone;if(d.requiredActions!==undefined)values.requiredActions=d.requiredActions;if(d.requiresPhoto!==undefined)values.requiresPhoto=d.requiresPhoto;
      if(values.startsAt&&values.endsAt&&values.startsAt>=values.endsAt)throw new DomainError(400,"CAMPAIGN_DATE_RANGE_INVALID","Дата окончания должна быть позже начала");
      if(d.referencePhotoIds!==undefined||d.storeIds!==undefined){values.referencePhotoIds=refs;await tx.delete(retailCampaignReferencePhotos).where(eq(retailCampaignReferencePhotos.campaignId,id));if(refs.length)await tx.insert(retailCampaignReferencePhotos).values(refs.map((photoId:string)=>({campaignId:id,photoId})));}
      await tx.update(retailCampaigns).set(values).where(eq(retailCampaigns.id,id));return id;
    });return this.getCampaign(p,cid);
  }
  async transitionCampaign(p:TrustedPrincipal,id:string,action:"complete"|"archive"|"cancel"){
    assertActivePrincipal(p);if(p.role!=="admin")throw new DomainError(403,"FORBIDDEN","Изменять кампании может администратор");
    return this.db.transaction(async(tx:Tx)=>{
      const [c]=await tx.select().from(retailCampaigns).where(eq(retailCampaigns.id,id)).for("update").limit(1);if(!c)throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не найдена");
      const executions=await tx.select().from(retailCampaignExecutions).where(eq(retailCampaignExecutions.campaignId,id)).for("update");let status:"completed"|"archived"|"cancelled";
      if(action==="complete"){if(!["active","scheduled"].includes(c.status))throw new DomainError(409,"CAMPAIGN_TRANSITION_INVALID","Кампания не может быть завершена из текущего статуса");if(!executions.length||executions.some((e:any)=>e.status!=="checked"))throw new DomainError(409,"CAMPAIGN_EXECUTIONS_PENDING","Все магазины должны быть проверены до завершения");status="completed";}
      else if(action==="archive"){if(!["completed","cancelled"].includes(c.status))throw new DomainError(409,"CAMPAIGN_TRANSITION_INVALID","Архивировать можно завершённую или отменённую кампанию");status="archived";}
      else{if(!["draft","scheduled","active"].includes(c.status))throw new DomainError(409,"CAMPAIGN_TRANSITION_INVALID","Кампанию нельзя отменить из текущего статуса");status="cancelled";}
      await tx.update(retailCampaigns).set({status,updatedAt:new Date()}).where(eq(retailCampaigns.id,id));
      if(status==="completed"||status==="cancelled"){const storeIds=executions.map((e:any)=>e.storeId);await this.event(tx,`campaign.${status}`,"retail_campaign",id,p.userId,storeIds[0]??"",{storeIds});}
      return {id,status};
    });
  }
  async publishCampaign(p: TrustedPrincipal,id:string) {
    manage(p);
    if(p.role!=="admin") throw new DomainError(403,"FORBIDDEN","Публиковать кампании может администратор");
    await this.db.transaction(async(tx:Tx)=>{
      const [c]=await tx.select().from(retailCampaigns).where(eq(retailCampaigns.id,id)).for("update").limit(1);
      if(!c||c.status!=="draft") throw new DomainError(409,"CAMPAIGN_TRANSITION_INVALID","Кампания уже опубликована или недоступна");
      const targets=await tx.select().from(retailCampaignStores).where(eq(retailCampaignStores.campaignId,id));
      if(!targets.length)throw new DomainError(409,"CAMPAIGN_TARGETS_REQUIRED","Нет целевых магазинов");
      for(const target of targets)await this.activeStore(target.storeId,tx);
      const refs=await tx.select({photoId:retailCampaignReferencePhotos.photoId}).from(retailCampaignReferencePhotos).where(eq(retailCampaignReferencePhotos.campaignId,id));
      await this.validPhotos(refs.map((row:any)=>row.photoId),targets.map((row:any)=>row.storeId),tx);
      const now=new Date();const status=c.startsAt>now?"scheduled":"active";
      const [updated]=await tx.update(retailCampaigns).set({status,updatedAt:now}).where(and(eq(retailCampaigns.id,id),eq(retailCampaigns.status,"draft"))).returning();
      if(!updated)throw new DomainError(409,"CAMPAIGN_TRANSITION_INVALID","Кампания уже опубликована или недоступна");
      await this.event(tx,"campaign.published","retail_campaign",id,p.userId,targets[0]!.storeId,{storeIds:targets.map((row:any)=>row.storeId)});
    });
    return this.getCampaign(p,id);
  }
  async getCampaign(p:TrustedPrincipal,id:string) { assertActivePrincipal(p); const [c]=await this.db.select().from(retailCampaigns).where(eq(retailCampaigns.id,id)).limit(1); if(!c) throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не найдена"); const targets=await this.db.select().from(retailCampaignStores).where(eq(retailCampaignStores.campaignId,id)); if(p.role==="staff"&&(!["scheduled","active"].includes(c.status)||!targets.some((x:any)=>p.storeIds.includes(x.storeId)))) throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не найдена"); const allowedStores=p.role==="admin"?undefined:await this.activeScopeIds(p); const visibleTargets=targets.filter((x:any)=>!allowedStores||allowedStores.includes(x.storeId));if(!visibleTargets.length&&p.role!=="admin")throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не найдена");if(p.role!=="admin")for(const target of visibleTargets)await this.enforceScope(p,target.storeId); const executions=await this.db.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,id),allowedStores?inArray(retailCampaignExecutions.storeId,[...allowedStores]):undefined));const executionIds=executions.map((x:any)=>x.id);const submissions=executionIds.length?await this.db.select().from(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId,executionIds)).orderBy(desc(retailCampaignSubmissions.version)):[];const latestByExecution=new Map<string,any>();for(const submission of submissions)if(!latestByExecution.has(submission.executionId))latestByExecution.set(submission.executionId,submission);const references=await this.db.select({photoId:retailCampaignReferencePhotos.photoId}).from(retailCampaignReferencePhotos).where(eq(retailCampaignReferencePhotos.campaignId,id)); return {...c,referencePhotoIds:references.map((x:any)=>x.photoId),startsAt:iso(c.startsAt),endsAt:iso(c.endsAt),createdAt:iso(c.createdAt),storeIds:visibleTargets.map((x:any)=>x.storeId),executions:executions.map((x:any)=>{const latest=latestByExecution.get(x.id);return {id:x.id,storeId:x.storeId,status:x.status,submittedAt:x.submittedAt?iso(x.submittedAt):null,reviewComment:x.reviewComment,employeeNote:latest?.employeeNote??"",version:latest?.version??0,submittedBy:x.submittedBy,reviewerId:x.reviewerId,actionResults:x.actionResults,evidencePhotoIds:x.evidencePhotoIds}})}; }
  async submitCampaign(p:TrustedPrincipal,id:string,storeId:string,input:unknown){
    const d=parseInput(campaignSubmissionSchema,input);
    return this.db.transaction(async(tx:Tx)=>{
      await this.enforceScope(p,storeId,tx);
      const [c]=await tx.select().from(retailCampaigns).where(eq(retailCampaigns.id,id)).for("update").limit(1);
      if(!c)throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не найдена");
      const [e]=await tx.select().from(retailCampaignExecutions).where(and(eq(retailCampaignExecutions.campaignId,id),eq(retailCampaignExecutions.storeId,storeId))).for("update").limit(1);
      if(!e)throw new DomainError(404,"CAMPAIGN_NOT_FOUND","Кампания не назначена магазину");
      const [prior]=await tx.select().from(retailCampaignSubmissions).where(and(eq(retailCampaignSubmissions.executionId,e.id),eq(retailCampaignSubmissions.idempotencyKey,d.idempotencyKey))).limit(1);
      if(prior){
        const priorLinks=await tx.select({photoId:retailCampaignSubmissionPhotos.photoId}).from(retailCampaignSubmissionPhotos).where(eq(retailCampaignSubmissionPhotos.submissionId,prior.id));
        const priorPhotos=priorLinks.map((x:any)=>x.photoId as string).sort();const requestPhotos=[...d.photoIds].sort();
        if(prior.submittedBy!==p.userId||JSON.stringify(prior.actionResults)!==JSON.stringify(d.actionResults)||prior.employeeNote!==d.employeeNote||JSON.stringify(priorPhotos)!==JSON.stringify(requestPhotos))throw new DomainError(409,"IDEMPOTENCY_CONFLICT","Ключ уже использован для другой отправки");
        return {id:e.id,status:e.status,submittedAt:iso(prior.submittedAt),version:prior.version};
      }
      if(c.status!=="active"||c.endsAt<new Date())throw new DomainError(409,"CAMPAIGN_NOT_ACTIVE","Кампания сейчас не принимает отчёты");
      await this.validPhotos(d.photoIds,storeId,tx);
      if(!["not_started","in_progress","rejected"].includes(e.status))throw new DomainError(409,"CAMPAIGN_ALREADY_SUBMITTED","Отчёт уже отправлен");
      if(d.actionResults.length!==c.requiredActions.length||d.actionResults.some(x=>!x)||(c.requiresPhoto&&!d.photoIds.length))throw new DomainError(400,"CAMPAIGN_INCOMPLETE","Выполните все действия и приложите необходимые фото");
      const [last]=await tx.select().from(retailCampaignSubmissions).where(eq(retailCampaignSubmissions.executionId,e.id)).orderBy(desc(retailCampaignSubmissions.version)).limit(1);
      const [submission]=await tx.insert(retailCampaignSubmissions).values({executionId:e.id,version:(last?.version??0)+1,submittedBy:p.userId,actionResults:d.actionResults,evidencePhotoIds:d.photoIds,employeeNote:d.employeeNote,idempotencyKey:d.idempotencyKey}).returning();
      if(d.photoIds.length)await tx.insert(retailCampaignSubmissionPhotos).values(d.photoIds.map(photoId=>({submissionId:submission.id,photoId})));
      const [updated]=await tx.update(retailCampaignExecutions).set({status:"submitted",actionResults:d.actionResults,evidencePhotoIds:d.photoIds,submittedBy:p.userId,submittedAt:submission.submittedAt,reviewComment:null,version:e.version+1,updatedAt:new Date()}).where(and(eq(retailCampaignExecutions.id,e.id),eq(retailCampaignExecutions.version,e.version))).returning();
      if(!updated)throw new DomainError(409,"CONCURRENT_UPDATE","Отчёт был изменён параллельно");
      await this.event(tx,"campaign.execution_submitted","retail_campaign_execution",e.id,p.userId,storeId);
      return {id:updated.id,status:updated.status,submittedAt:iso(submission.submittedAt),version:submission.version};
    });
  }
  async reviewCampaign(p:TrustedPrincipal,eid:string,input:unknown) { manage(p); const d=parseInput(campaignReviewSchema,input); return this.db.transaction(async(tx:Tx)=>{const [e]=await tx.select().from(retailCampaignExecutions).where(eq(retailCampaignExecutions.id,eid)).for("update").limit(1); if(!e) throw new DomainError(404,"EXECUTION_NOT_FOUND","Отчёт не найден"); await this.enforceScope(p,e.storeId,tx); if(e.status!=="submitted") throw new DomainError(409,"REVIEW_TRANSITION_INVALID","Отчёт уже рассмотрен"); if(e.submittedBy===p.userId) throw new DomainError(403,"SELF_REVIEW_FORBIDDEN","Нельзя проверять собственный отчёт"); const [submission]=await tx.select().from(retailCampaignSubmissions).where(eq(retailCampaignSubmissions.executionId,eid)).orderBy(desc(retailCampaignSubmissions.version)).limit(1); const next=d.decision;const [updated]=await tx.update(retailCampaignExecutions).set({status:next,reviewerId:p.userId,reviewComment:d.comment||null,version:e.version+1,updatedAt:new Date()}).where(and(eq(retailCampaignExecutions.id,eid),eq(retailCampaignExecutions.status,"submitted"),eq(retailCampaignExecutions.version,e.version))).returning();if(!updated)throw new DomainError(409,"REVIEW_TRANSITION_INVALID","Отчёт уже рассмотрен"); await tx.insert(retailCampaignReviews).values({executionId:eid,submissionId:submission?.id??null,actorId:p.userId,fromStatus:e.status,toStatus:next,comment:d.comment||null}); await this.event(tx,next==="checked"?"campaign.execution_checked":"campaign.execution_rejected","retail_campaign_execution",eid,p.userId,e.storeId); return {id:eid,status:next,comment:d.comment}; }); }

  async createDisplay(p:TrustedPrincipal,input:unknown) { manage(p); const d=parseInput(merchandisingDisplayCreateSchema,input); await this.enforceScope(p,d.storeId); await this.validPhotos([d.referencePhotoId],d.storeId,this.db); const [r]=await this.db.insert(merchandisingDisplays).values({...d,campaignId:d.campaignId??null,createdBy:p.userId}).returning(); return r; }
  async updateDisplay(p:TrustedPrincipal,id:string,input:unknown){manage(p);const d=parseInput(merchandisingDisplayUpdateSchema,input);return this.db.transaction(async(tx:Tx)=>{const [display]=await tx.select().from(merchandisingDisplays).where(eq(merchandisingDisplays.id,id)).for("update").limit(1);if(!display)throw new DomainError(404,"DISPLAY_NOT_FOUND","Выкладка не найдена");await this.enforceScope(p,display.storeId,tx);if(d.referencePhotoId)await this.validPhotos([d.referencePhotoId],display.storeId,tx);const [updated]=await tx.update(merchandisingDisplays).set({...d,updatedAt:new Date()}).where(eq(merchandisingDisplays.id,id)).returning();return updated;});}
  async submitInspection(p:TrustedPrincipal,id:string,input:unknown) {
    const d=parseInput(inspectionSubmitSchema,input);
    return this.db.transaction(async(tx:Tx)=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${p.userId}:${d.idempotencyKey}`}, 1901))`);
      const [display]=await tx.select().from(merchandisingDisplays).where(eq(merchandisingDisplays.id,id)).for("update").limit(1);
      if(!display)throw new DomainError(404,"DISPLAY_NOT_FOUND","Выкладка не найдена");
      await this.enforceScope(p,display.storeId,tx);
      const [prior]=await tx.select().from(merchandisingInspections).where(and(eq(merchandisingInspections.submittedBy,p.userId),eq(merchandisingInspections.idempotencyKey,d.idempotencyKey))).limit(1);
      if(prior){if(prior.displayId!==id||prior.actualPhotoId!==d.actualPhotoId||prior.employeeNote!==d.employeeNote||JSON.stringify(prior.checklistResults)!==JSON.stringify(d.checklistResults))throw new DomainError(409,"IDEMPOTENCY_CONFLICT","Ключ уже использован для другой отправки");return {id:prior.id,displayId:prior.displayId,status:prior.status,version:prior.version,submittedAt:iso(prior.submittedAt??prior.createdAt)};}
      if(!display.active)throw new DomainError(404,"DISPLAY_NOT_FOUND","Выкладка не найдена");
      await this.validPhotos([d.actualPhotoId],display.storeId,tx);
      if(d.checklistResults.length!==display.checklist.length)throw new DomainError(400,"CHECKLIST_INVALID","Ответьте на все пункты проверки");
      const [last]=await tx.select({version:merchandisingInspections.version}).from(merchandisingInspections).where(eq(merchandisingInspections.displayId,id)).orderBy(desc(merchandisingInspections.version)).limit(1);
      const [r]=await tx.insert(merchandisingInspections).values({displayId:id,displayNameSnapshot:display.name,brandSnapshot:display.brand,checklistSnapshot:display.checklist,referencePhotoId:display.referencePhotoId,actualPhotoId:d.actualPhotoId,checklistResults:d.checklistResults,employeeNote:d.employeeNote,status:"submitted",submittedBy:p.userId,version:(last?.version??0)+1,idempotencyKey:d.idempotencyKey,submittedAt:new Date()}).returning();
      await tx.insert(merchandisingReviewHistory).values({inspectionId:r.id,actorId:p.userId,fromStatus:"draft",toStatus:"submitted"});
      await this.event(tx,"merchandising.submitted","merchandising_inspection",r.id,p.userId,display.storeId);return {id:r.id,displayId:r.displayId,status:r.status,version:r.version,submittedAt:iso(r.submittedAt??r.createdAt)};
    });
  }
  async reviewInspection(p:TrustedPrincipal,id:string,input:unknown) { manage(p); const d=parseInput(merchandisingReviewSchema,input); return this.db.transaction(async(tx:Tx)=>{const [r]=await tx.select().from(merchandisingInspections).where(eq(merchandisingInspections.id,id)).for("update").limit(1); if(!r||r.status!=="submitted") throw new DomainError(409,"INSPECTION_TRANSITION_INVALID","Проверка уже обработана"); const [display]=await tx.select().from(merchandisingDisplays).where(eq(merchandisingDisplays.id,r.displayId)).limit(1); await this.enforceScope(p,display.storeId,tx); if(r.submittedBy===p.userId) throw new DomainError(403,"SELF_REVIEW_FORBIDDEN","Нельзя проверять собственную работу"); const status=d.decision;const [updated]=await tx.update(merchandisingInspections).set({status,reviewerId:p.userId,comment:d.comment||null,reviewedAt:new Date(),updatedAt:new Date()}).where(and(eq(merchandisingInspections.id,id),eq(merchandisingInspections.status,"submitted"))).returning();if(!updated)throw new DomainError(409,"INSPECTION_TRANSITION_INVALID","Проверка уже обработана"); await tx.insert(merchandisingReviewHistory).values({inspectionId:id,actorId:p.userId,fromStatus:r.status,toStatus:status,comment:d.comment}); await this.event(tx,status==="checked"?"merchandising.checked":"merchandising.rejected","merchandising_inspection",id,p.userId,display.storeId); return {id,status,comment:d.comment}; }); }

  async createIssue(p:TrustedPrincipal,input:unknown,idempotencyKey?:string) {
    assertActivePrincipal(p);const d=parseInput(issueCreateSchema,input);const payloadHash=requestHash(d);
    return this.db.transaction(async(tx:Tx)=>{
      await this.enforceScope(p,d.storeId,tx);
      if(idempotencyKey){
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${p.userId}:${idempotencyKey}`},1902))`);
        const [prior]=await tx.select().from(storeIssues).where(and(eq(storeIssues.reporterId,p.userId),eq(storeIssues.createIdempotencyKey,idempotencyKey))).limit(1);
        if(prior){if(prior.createRequestHash!==payloadHash)throw new DomainError(409,"IDEMPOTENCY_CONFLICT","Ключ уже использован для другой отправки");return prior;}
      }
      await this.validPhotos(d.photoIds,d.storeId,tx);
      const [r]=await tx.insert(storeIssues).values({...d,reporterId:p.userId,createIdempotencyKey:idempotencyKey??null,createRequestHash:idempotencyKey?payloadHash:null}).returning();
      if(d.photoIds.length)await tx.insert(storeIssuePhotos).values(d.photoIds.map(photoId=>({issueId:r.id,photoId})));
      await tx.insert(storeIssueHistory).values({issueId:r.id,actorId:p.userId,action:"created",toStatus:"open"});
      await this.event(tx,"store_issue.created","store_issue",r.id,p.userId,d.storeId);return r;
    });
  }
  async updateIssue(p:TrustedPrincipal,id:string,input:unknown) {
    manage(p); const d=parseInput(issueUpdateSchema,input);
    return this.db.transaction(async(tx:Tx)=>{
      const [r]=await tx.select().from(storeIssues).where(eq(storeIssues.id,id)).for("update").limit(1);
      if(!r)throw new DomainError(404,"ISSUE_NOT_FOUND","Проблема не найдена"); await this.enforceScope(p,r.storeId,tx); await this.validateAssignee(tx,r.storeId,d.assignedTo);
      const next=d.status??r.status; const allowed=(r.status==="open"&&next==="in_progress")||(r.status==="in_progress"&&next==="resolved"&&!!d.resolutionNotes)||(r.status==="resolved"&&next==="closed")||(["resolved","closed"].includes(r.status)&&next==="open"&&!!d.reopenReason);
      if(next!==r.status&&!allowed)throw new DomainError(409,"ISSUE_TRANSITION_INVALID","Недопустимый переход статуса");
      const [u]=await tx.update(storeIssues).set({status:next,assignedTo:d.assignedTo===undefined?r.assignedTo:d.assignedTo,resolutionNotes:d.resolutionNotes===undefined?r.resolutionNotes:d.resolutionNotes,resolvedAt:next==="resolved"?new Date():next==="open"?null:r.resolvedAt,updatedAt:new Date()}).where(eq(storeIssues.id,id)).returning();
      if(next!==r.status||d.assignedTo!==undefined||d.resolutionNotes!==undefined)await tx.insert(storeIssueHistory).values({issueId:id,actorId:p.userId,action:d.reopenReason?"reopened":d.assignedTo!==undefined?"assigned":"updated",fromStatus:r.status,toStatus:next,reason:d.reopenReason??d.resolutionNotes??null});
      if(d.assignedTo!==undefined&&d.assignedTo!==r.assignedTo&&d.assignedTo)await this.event(tx,"store_issue.assigned","store_issue",id,p.userId,r.storeId,{assignedTo:d.assignedTo});
      if(next!==r.status)await this.event(tx,next==="resolved"?"store_issue.resolved":`store_issue.${next}`,"store_issue",id,p.userId,r.storeId);
      return u;
    });
  }

  async changeIssuePriority(p:TrustedPrincipal,id:string,input:unknown){manage(p);const d=parseInput(issuePriorityChangeSchema,input);return this.db.transaction(async(tx:Tx)=>{const [r]=await tx.select().from(storeIssues).where(eq(storeIssues.id,id)).for("update").limit(1);if(!r)throw new DomainError(404,"ISSUE_NOT_FOUND","Проблема не найдена");await this.enforceScope(p,r.storeId,tx);if(r.priority!==d.expectedPriority)throw new DomainError(409,"ISSUE_PRIORITY_CONFLICT","Приоритет уже изменён другим пользователем");const [updated]=await tx.update(storeIssues).set({priority:d.priority,updatedAt:new Date()}).where(and(eq(storeIssues.id,id),eq(storeIssues.priority,d.expectedPriority))).returning();if(!updated)throw new DomainError(409,"ISSUE_PRIORITY_CONFLICT","Приоритет уже изменён другим пользователем");await tx.insert(storeIssueHistory).values({issueId:id,actorId:p.userId,action:"priority_changed",fromStatus:r.status,toStatus:r.status,previousPriority:r.priority,newPriority:d.priority});await this.event(tx,"store_issue.priority_changed","store_issue",id,p.userId,r.storeId,{previousPriority:r.priority,newPriority:d.priority});return updated;});}

  async createRequest(p:TrustedPrincipal,input:unknown,idempotencyKey?:string) {
    assertActivePrincipal(p);const d=parseInput(requestCreateSchema,input);const payloadHash=requestHash(d);
    return this.db.transaction(async(tx:Tx)=>{
      await this.enforceScope(p,d.storeId,tx);
      if(idempotencyKey){
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${p.userId}:${idempotencyKey}`},1903))`);
        const [prior]=await tx.select().from(operationalRequests).where(and(eq(operationalRequests.requesterId,p.userId),eq(operationalRequests.createIdempotencyKey,idempotencyKey))).limit(1);
        if(prior){if(prior.createRequestHash!==payloadHash)throw new DomainError(409,"IDEMPOTENCY_CONFLICT","Ключ уже использован для другой отправки");return prior;}
      }
      await this.validPhotos(d.attachmentPhotoIds,d.storeId,tx);
      const [r]=await tx.insert(operationalRequests).values({...d,requesterId:p.userId,createIdempotencyKey:idempotencyKey??null,createRequestHash:idempotencyKey?payloadHash:null}).returning();
      if(d.attachmentPhotoIds.length)await tx.insert(operationalRequestPhotos).values(d.attachmentPhotoIds.map(photoId=>({requestId:r.id,photoId})));
      await tx.insert(operationalRequestHistory).values({requestId:r.id,actorId:p.userId,toStatus:"submitted"});
      await this.event(tx,"operational_request.submitted","operational_request",r.id,p.userId,d.storeId);return r;
    });
  }
  async decideRequest(p:TrustedPrincipal,id:string,input:unknown) { manage(p); const d=parseInput(requestDecisionSchema,input); return this.db.transaction(async(tx:Tx)=>{const [r]=await tx.select().from(operationalRequests).where(eq(operationalRequests.id,id)).for("update").limit(1); if(!r||r.status!=="submitted") throw new DomainError(409,"REQUEST_TRANSITION_INVALID","Заявка уже рассмотрена"); await this.enforceScope(p,r.storeId,tx); const status=d.decision; await tx.update(operationalRequests).set({status,decisionComment:d.comment||null,updatedAt:new Date()}).where(eq(operationalRequests.id,id)); await tx.insert(operationalRequestHistory).values({requestId:id,actorId:p.userId,fromStatus:r.status,toStatus:status,comment:d.comment}); await this.event(tx,`operational_request.${status}`,"operational_request",id,p.userId,r.storeId); return {id,status,comment:d.comment}; }); }
  async updateRequest(p:TrustedPrincipal,id:string,input:unknown) {
    manage(p); const d=parseInput(requestUpdateSchema,input);
    return this.db.transaction(async(tx:Tx)=>{
      const [r]=await tx.select().from(operationalRequests).where(eq(operationalRequests.id,id)).for("update").limit(1);
      if(!r)throw new DomainError(404,"REQUEST_NOT_FOUND","Заявка не найдена");await this.enforceScope(p,r.storeId,tx);await this.validateAssignee(tx,r.storeId,d.assignedTo);
      const status=d.status??r.status;const allowed=(r.status==="approved"&&status==="in_progress")||(r.status==="in_progress"&&status==="completed")||(status===r.status&&d.assignedTo!==undefined&&["approved","in_progress"].includes(r.status));if(!allowed)throw new DomainError(409,"REQUEST_TRANSITION_INVALID","Недопустимый переход заявки");
      const [u]=await tx.update(operationalRequests).set({assignedTo:d.assignedTo===undefined?r.assignedTo:d.assignedTo,status,updatedAt:new Date()}).where(eq(operationalRequests.id,id)).returning();
      await tx.insert(operationalRequestHistory).values({requestId:id,actorId:p.userId,fromStatus:r.status,toStatus:status,comment:d.comment});
      if(d.assignedTo&&d.assignedTo!==r.assignedTo)await this.event(tx,"operational_request.assigned","operational_request",id,p.userId,r.storeId,{assignedTo:d.assignedTo});
      if(status!==r.status)await this.event(tx,status==="completed"?"operational_request.completed":"operational_request.in_progress","operational_request",id,p.userId,r.storeId);
      return u;
    });
  }
}
