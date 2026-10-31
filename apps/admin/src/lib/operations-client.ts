import {
	campaignActionSchema,
	campaignCreateSchema,
	campaignListResponseSchema,
	campaignResponseSchema,
	campaignReviewResponseSchema,
	campaignUpdateSchema,
	campaignTransitionResponseSchema,
	campaignHistoryResponseSchema,
	inspectionHistoryResponseSchema,
	inspectionReviewResponseSchema,
	issueHistoryResponseSchema,
	issueListResponseSchema,
	issuePriorityChangeSchema,
	issueResponseSchema,
	issueUpdateSchema,
	merchandisingDisplayCreateSchema,
	merchandisingDisplayResponseSchema,
	merchandisingDisplayUpdateSchema,
	merchandisingListResponseSchema,
	requestDecisionResponseSchema,
	requestDecisionSchema,
	requestHistoryResponseSchema,
	requestListResponseSchema,
	requestResponseSchema,
	requestUpdateSchema,
	type CampaignAction,
	type CampaignCreate,
	type CampaignUpdate,
	type IssuePriorityChange,
	type IssueUpdate,
	type MerchandisingDisplayCreate,
	type MerchandisingDisplayUpdate,
	type RequestDecision,
	type RequestUpdate,
} from '@vizaje/contracts'
import { managementFetch } from '@/lib/management-client'

function queryString(values: Record<string, string | number | boolean | undefined>): string {
	const query = new URLSearchParams()
	for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') query.set(key, String(value))
	return query.toString()
}

function body(value: unknown): RequestInit {
	return { method: 'POST', body: JSON.stringify(value) }
}

export const operationsApi = {
	campaigns: {
		list: (query: Record<string, string | number | boolean | undefined>) => managementFetch(`/api/admin/operations/campaigns?${queryString(query)}`, campaignListResponseSchema),
		get: (id: string) => managementFetch(`/api/admin/operations/campaigns/${id}`, campaignResponseSchema),
		create: (input: CampaignCreate) => managementFetch('/api/admin/operations/campaigns', campaignResponseSchema, { ...body(campaignCreateSchema.parse(input)) }),
		update: (id: string, input: CampaignUpdate) => managementFetch(`/api/admin/operations/campaigns/${id}`, campaignResponseSchema, { method: 'PATCH', body: JSON.stringify(campaignUpdateSchema.parse(input)) }),
		publish: (id: string) => managementFetch(`/api/admin/operations/campaigns/${id}/publish`, campaignResponseSchema, body({})),
		transition: (id: string, input: CampaignAction) => managementFetch(`/api/admin/operations/campaigns/${id}/transition`, campaignTransitionResponseSchema, body(campaignActionSchema.parse(input))),
		history: (id: string) => managementFetch(`/api/admin/operations/campaigns/${id}/history`, campaignHistoryResponseSchema),
		review: (executionId: string, input: { decision: 'checked' | 'rejected'; comment: string }) => managementFetch(`/api/admin/operations/executions/${executionId}/review`, campaignReviewResponseSchema, body(input)),
	},
	merchandising: {
		list: (query: Record<string, string | number | boolean | undefined>) => managementFetch(`/api/admin/operations/merchandising?${queryString(query)}`, merchandisingListResponseSchema),
		createDisplay: (input: MerchandisingDisplayCreate) => managementFetch('/api/admin/operations/merchandising/displays', merchandisingDisplayResponseSchema, body(merchandisingDisplayCreateSchema.parse(input))),
		updateDisplay: (id: string, input: MerchandisingDisplayUpdate) => managementFetch(`/api/admin/operations/merchandising/displays/${id}`, merchandisingDisplayResponseSchema, { method: 'PATCH', body: JSON.stringify(merchandisingDisplayUpdateSchema.parse(input)) }),
		review: (id: string, input: { decision: 'checked' | 'rejected'; comment: string }) => managementFetch(`/api/admin/operations/merchandising/inspections/${id}/review`, inspectionReviewResponseSchema, body(input)),
		history: (id: string) => managementFetch(`/api/admin/operations/merchandising/inspections/${id}/history`, inspectionHistoryResponseSchema),
	},
	issues: {
		list: (query: Record<string, string | number | boolean | undefined>) => managementFetch(`/api/admin/operations/issues?${queryString(query)}`, issueListResponseSchema),
		get: (id: string) => managementFetch(`/api/admin/operations/issues/${id}`, issueResponseSchema),
		history: (id: string) => managementFetch(`/api/admin/operations/issues/${id}/history`, issueHistoryResponseSchema),
		update: (id: string, input: IssueUpdate) => managementFetch(`/api/admin/operations/issues/${id}`, issueResponseSchema, { method: 'PATCH', body: JSON.stringify(issueUpdateSchema.parse(input)) }),
		priority: (id: string, input: IssuePriorityChange) => managementFetch(`/api/admin/operations/issues/${id}/priority`, issueResponseSchema, body(issuePriorityChangeSchema.parse(input))),
	},
	requests: {
		list: (query: Record<string, string | number | boolean | undefined>) => managementFetch(`/api/admin/operations/requests?${queryString(query)}`, requestListResponseSchema),
		get: (id: string) => managementFetch(`/api/admin/operations/requests/${id}`, requestResponseSchema),
		history: (id: string) => managementFetch(`/api/admin/operations/requests/${id}/history`, requestHistoryResponseSchema),
		decide: (id: string, input: RequestDecision) => managementFetch(`/api/admin/operations/requests/${id}/decision`, requestDecisionResponseSchema, body(requestDecisionSchema.parse(input))),
		update: (id: string, input: RequestUpdate) => managementFetch(`/api/admin/operations/requests/${id}`, requestResponseSchema, { method: 'PATCH', body: JSON.stringify(requestUpdateSchema.parse(input)) }),
	},
}

export type OperationEvidenceKind = 'campaign_execution' | 'merchandising_inspection' | 'store_issue' | 'operational_request' | 'campaign_reference'
export function operationEvidenceUrl(kind: OperationEvidenceKind, recordId: string, photoId: string): string {
	return `/api/admin/operations/evidence/${kind}/${recordId}/${photoId}`
}

export function operationQuery(values: Record<string, string | number | boolean | undefined>): string {
	return queryString(values)
}
