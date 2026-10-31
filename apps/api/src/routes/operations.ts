import type { Context, Hono } from "hono";
import { z } from "zod";
import { campaignActionSchema } from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { OperationsService } from "../domain/operations/service";
import type { PrincipalResolver } from "./management";

export interface OperationsRoutesOptions { operations: OperationsService; resolvePrincipal: PrincipalResolver; }
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const r=schema.safeParse(value);if(!r.success)throw new DomainError(400,"VALIDATION_ERROR",r.error.issues[0]?.message??"Некорректные данные");return r.data;}
async function principal(resolve:PrincipalResolver,c:Context):Promise<TrustedPrincipal>{const p=await resolve(c);if(!p)throw new DomainError(401,"UNAUTHENTICATED","Требуется вход");return p;}
async function body(c:Context){try{return await c.req.json();}catch{throw new DomainError(400,"INVALID_JSON","Некорректный JSON");}}
function idempotencyKey(c:Context):string|undefined{const value=c.req.header("Idempotency-Key");return value===undefined?undefined:parse(z.string().trim().min(8).max(128),value);}
const uuid=z.string().uuid();
export function registerOperationsRoutes(app:Hono,o:OperationsRoutesOptions){
  app.get("/api/v1/management/operations/campaigns",async c=>c.json(await o.operations.listCampaigns(await principal(o.resolvePrincipal,c),c.req.query()),200));
  app.get("/api/v1/operations/campaigns",async c=>c.json(await o.operations.listCampaigns(await principal(o.resolvePrincipal,c),c.req.query()),200));
  app.post("/api/v1/management/operations/campaigns",async c=>c.json(await o.operations.createCampaign(await principal(o.resolvePrincipal,c),await body(c)),201));
  app.patch("/api/v1/management/operations/campaigns/:id",async c=>c.json(await o.operations.updateCampaign(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.post("/api/v1/management/operations/campaigns/:id/transition",async c=>{const action=parse(campaignActionSchema,await body(c)).action;return c.json(await o.operations.transitionCampaign(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),action),200)});
  app.post("/api/v1/management/operations/campaigns/:id/publish",async c=>c.json(await o.operations.publishCampaign(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/operations/campaigns/:id",async c=>c.json(await o.operations.getCampaign(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/operations/campaigns/:id/history",async c=>c.json(await o.operations.campaignHistory(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/management/operations/campaigns/:id/history",async c=>c.json(await o.operations.campaignHistory(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.post("/api/v1/operations/campaigns/:id/stores/:storeId/submit",async c=>c.json(await o.operations.submitCampaign(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),parse(uuid,c.req.param("storeId")),await body(c)),200));
  app.post("/api/v1/management/operations/campaign-executions/:id/review",async c=>c.json(await o.operations.reviewCampaign(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.post("/api/v1/management/operations/merchandising/displays",async c=>c.json(await o.operations.createDisplay(await principal(o.resolvePrincipal,c),await body(c)),201));
  app.patch("/api/v1/management/operations/merchandising/displays/:id",async c=>c.json(await o.operations.updateDisplay(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.post("/api/v1/operations/merchandising/displays/:id/inspections",async c=>c.json(await o.operations.submitInspection(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),201));
  app.post("/api/v1/management/operations/merchandising/inspections/:id/review",async c=>c.json(await o.operations.reviewInspection(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.post("/api/v1/operations/issues",async c=>c.json(await o.operations.createIssue(await principal(o.resolvePrincipal,c),await body(c),idempotencyKey(c)),201));
  app.get("/api/v1/operations/issues",async c=>c.json(await o.operations.listIssues(await principal(o.resolvePrincipal,c),c.req.query()),200));
  app.get("/api/v1/operations/issues/:id",async c=>c.json(await o.operations.getIssue(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/operations/issues/:id/history",async c=>c.json(await o.operations.issueHistory(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.patch("/api/v1/management/operations/issues/:id",async c=>c.json(await o.operations.updateIssue(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.post("/api/v1/management/operations/issues/:id/priority",async c=>c.json(await o.operations.changeIssuePriority(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.post("/api/v1/operations/requests",async c=>c.json(await o.operations.createRequest(await principal(o.resolvePrincipal,c),await body(c),idempotencyKey(c)),201));
  app.get("/api/v1/operations/requests",async c=>c.json(await o.operations.listRequests(await principal(o.resolvePrincipal,c),c.req.query()),200));
  app.get("/api/v1/operations/requests/:id",async c=>c.json(await o.operations.getRequest(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/operations/requests/:id/history",async c=>c.json(await o.operations.requestHistory(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/operations/merchandising",async c=>c.json(await o.operations.listDisplays(await principal(o.resolvePrincipal,c),c.req.query()),200));
  app.get("/api/v1/operations/merchandising/inspections/:id",async c=>c.json(await o.operations.getInspection(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/management/operations/merchandising",async c=>c.json(await o.operations.listDisplays(await principal(o.resolvePrincipal,c),c.req.query()),200));
  app.get("/api/v1/operations/merchandising/inspections/:id/history",async c=>c.json(await o.operations.inspectionHistory(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id"))),200));
  app.get("/api/v1/operations/evidence/:kind/:recordId/:photoId",async c=>{const result=await o.operations.getEvidence(await principal(o.resolvePrincipal,c),c.req.param("kind"),parse(uuid,c.req.param("recordId")),parse(uuid,c.req.param("photoId")));const bytes=new ArrayBuffer(result.body.byteLength);new Uint8Array(bytes).set(result.body);return new Response(bytes,{status:200,headers:{"Content-Type":result.mimeType,"Content-Length":String(result.body.byteLength),"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(result.filename)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})});
  app.post("/api/v1/management/operations/requests/:id/decision",async c=>c.json(await o.operations.decideRequest(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
  app.patch("/api/v1/management/operations/requests/:id",async c=>c.json(await o.operations.updateRequest(await principal(o.resolvePrincipal,c),parse(uuid,c.req.param("id")),await body(c)),200));
}
