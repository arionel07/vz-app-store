'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
	reportEmployeesResponseSchema,
	reportFiltersSchema,
	reportMetricDefinitionsResponseSchema,
	reportOperationsResponseSchema,
	reportOverviewResponseSchema,
	reportPageFiltersSchema,
	reportPhotosResponseSchema,
	reportSchedulesResponseSchema,
	reportStoresResponseSchema,
	reportTasksResponseSchema,
	reportTimeSeriesResponseSchema,
	reportTrainingResponseSchema,
	type ReportFilters,
	type ReportMetricDefinition,
	type ReportPeriodPreset,
	type ReportStoreRow,
	type ReportTimeSeriesResponse,
} from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { managementFetch } from '@/lib/management-client'
import {
	defaultCustomPeriod,
	formatReportDate,
	formatReportNumber,
	formatReportPercent,
	isCurrentReportingResult,
	mergeReportingSearch,
	REPORT_PAGE_SIZE,
	REPORT_OPERATION_LINKS,
	REPORT_PERIODS,
	REPORT_TIMEZONE,
	reportErrorMessage,
	reportQuery,
	reportingRequestKey,
	validateReportFilters,
} from '@/lib/reporting-state'
import { DailyActivityChart, type DailyActivityMetric, StatusBreakdown, StoreComparisonChart } from '@/components/reporting-charts'

type View = 'overview' | 'stores' | 'employees' | 'training' | 'photos' | 'tasks' | 'schedules' | 'operations'
type Definition = ReportMetricDefinition
type StoreOption = { storeId: string; storeName: string }
type ReportingData = {
	overview?: import('@vizaje/contracts').ReportOverviewResponse
	timeSeries?: ReportTimeSeriesResponse
	stores?: import('@vizaje/contracts').ReportStoresResponse
	employees?: import('@vizaje/contracts').ReportEmployeesResponse
	training?: import('@vizaje/contracts').ReportTrainingResponse
	photos?: import('@vizaje/contracts').ReportPhotosResponse
	tasks?: import('@vizaje/contracts').ReportTasksResponse
	schedules?: import('@vizaje/contracts').ReportSchedulesResponse
	operations?: import('@vizaje/contracts').ReportOperationsResponse
}
type Snapshot = { key: string; data: ReportingData }

const views: Array<{ value: View; label: string }> = [
	{ value: 'overview', label: 'Обзор' },
	{ value: 'stores', label: 'Магазины' },
	{ value: 'employees', label: 'Сотрудники' },
	{ value: 'training', label: 'Обучение' },
	{ value: 'photos', label: 'Фотоотчёты' },
	{ value: 'tasks', label: 'Задания' },
	{ value: 'schedules', label: 'Расписание' },
	{ value: 'operations', label: 'Операции' },
]

const titles: Record<View, string> = {
	overview: 'Обзор аналитики', stores: 'Сравнение магазинов', employees: 'Сотрудники', training: 'Обучение',
	photos: 'Фотоотчёты', tasks: 'Задания', schedules: 'Расписание', operations: 'Операции',
}

function validView(value: string | null): View {
	return views.find((item) => item.value === value)?.value ?? 'overview'
}

function safePage(value: string | null): number {
	const parsed = Number(value)
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

function reportPath(pathname: string, search: string): string {
	return search ? `${pathname}?${search}` : pathname
}

function call<T>(path: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, signal: AbortSignal): Promise<T> {
	return managementFetch(path, schema, { signal })
}

async function fetchView(view: View, filters: ReportFilters, page: number, employeeId: string | undefined, signal: AbortSignal): Promise<ReportingData> {
	const baseQuery = reportQuery(filters)
	switch (view) {
		case 'overview': {
			const [overview, timeSeries] = await Promise.all([
				call(`/api/admin/reports/overview?${baseQuery}`, reportOverviewResponseSchema, signal),
				call(`/api/admin/reports/time-series?${baseQuery}`, reportTimeSeriesResponseSchema, signal),
			])
			return { overview, timeSeries }
		}
		case 'stores': {
			const query = reportQuery(filters, { page, pageSize: REPORT_PAGE_SIZE })
			return { stores: await call(`/api/admin/reports/stores?${query}`, reportStoresResponseSchema, signal) }
		}
		case 'employees': {
			const query = reportQuery(filters, { page, pageSize: REPORT_PAGE_SIZE, employeeId })
			return { employees: await call(`/api/admin/reports/employees?${query}`, reportEmployeesResponseSchema, signal) }
		}
		case 'training':
			return { training: await call(`/api/admin/reports/training?${baseQuery}`, reportTrainingResponseSchema, signal) }
		case 'photos': {
			const [photos, timeSeries] = await Promise.all([
				call(`/api/admin/reports/photos?${baseQuery}`, reportPhotosResponseSchema, signal),
				call(`/api/admin/reports/time-series?${baseQuery}`, reportTimeSeriesResponseSchema, signal),
			])
			return { photos, timeSeries }
		}
		case 'tasks': {
			const [tasks, timeSeries] = await Promise.all([
				call(`/api/admin/reports/tasks?${baseQuery}`, reportTasksResponseSchema, signal),
				call(`/api/admin/reports/time-series?${baseQuery}`, reportTimeSeriesResponseSchema, signal),
			])
			return { tasks, timeSeries }
		}
		case 'schedules':
			return { schedules: await call(`/api/admin/reports/schedules?${baseQuery}`, reportSchedulesResponseSchema, signal) }
		case 'operations':
			return { operations: await call(`/api/admin/reports/operations?${baseQuery}`, reportOperationsResponseSchema, signal) }
	}
}

function MetricHelp({ definitions, metric }: { definitions: Definition[]; metric: string }) {
	const definition = definitions.find((item) => item.key === metric)
	return definition ? <details className="report-metric-help"><summary aria-label={`Определение метрики «${metric}»`}>i</summary><div className="report-metric-popover"><strong>{definition.definition}</strong><p>{definition.dateAttribution}</p><p>{definition.historyBehavior}</p>{definition.denominator ? <p>Знаменатель: {definition.denominator}</p> : null}</div></details> : null
}

function MetricCard({ label, value, note, definitions, metric, tone = 'blue' }: { label: string; value: string | number; note?: string; definitions: Definition[]; metric: string; tone?: 'blue' | 'green' | 'orange' }) {
	return <article className="report-metric-card">
		<div className="report-metric-card-top"><span className={`report-metric-mark report-tone-${tone}`} aria-hidden="true" /><MetricHelp definitions={definitions} metric={metric} /></div>
		<strong className="report-metric-value">{typeof value === 'number' ? formatReportNumber(value) : value}</strong>
		<span className="report-metric-label">{label}</span>
		{note ? <small>{note}</small> : null}
	</article>
}

function MetricGrid({ children }: { children: ReactNode }) {
	return <section className="report-metric-grid" aria-label="Ключевые показатели">{children}</section>
}

function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
	return <section className="management-surface report-panel"><header className="report-panel-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header><div className="report-panel-content">{children}</div></section>
}

function EmptyState({ title, text }: { title: string; text: string }) {
	return <div className="management-state report-empty"><div><strong>{title}</strong><p>{text}</p></div></div>
}

function MetricCardsSkeleton() {
	return <div className="report-metric-grid" aria-label="Загрузка отчёта" aria-busy="true"><span className="sr-only">Загружаем отчёт…</span>{[1, 2, 3, 4, 5].map((item) => <div className="report-metric-card" key={item}><span className="skeleton" /><span className="skeleton report-skeleton-value" /><span className="skeleton report-skeleton-label" /></div>)}</div>
}

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
	return <div className="management-pagination"><span>Записей: {formatReportNumber(total)} · Страница {page} из {Math.max(1, totalPages)}</span><div className="management-pagination-actions"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Назад</Button><Button variant="outline" size="sm" disabled={totalPages === 0 || page >= totalPages} onClick={() => onChange(page + 1)}>Далее</Button></div></div>
}

function StoreTable({ rows, onSelect }: { rows: ReportStoreRow[]; onSelect: (storeId: string) => void }) {
	return rows.length === 0 ? <EmptyState title="Магазинов нет" text="В выбранной области доступа нет активных магазинов." /> : <div className="table-scroll"><table className="data-table report-table report-store-table"><thead><tr><th>Магазин</th><th>Сотрудники</th><th>Задания</th><th>Проверено</th><th className="report-column-photos">Фотоотчёты</th><th className="report-column-quizzes">Попытки тестов</th><th>Активность</th></tr></thead><tbody>{rows.map((row) => <tr key={row.storeId}><td><button className="report-table-link" type="button" onClick={() => onSelect(row.storeId)}>{row.storeName}</button></td><td>{row.activeAssignedEmployeeCount}</td><td>{row.assignedTaskCount}</td><td>{row.checkedTaskCount}</td><td className="report-column-photos">{row.photoReportCount}</td><td className="report-column-quizzes">{row.submittedQuizAttemptCount}</td><td><Badge tone={row.participated ? 'green' : 'neutral'}>{row.participated ? 'Участвует' : 'Нет событий'}</Badge></td></tr>)}</tbody></table></div>
}

function EmployeeTable({ rows, onSelect }: { rows: NonNullable<ReportingData['employees']>['data']; onSelect: (employeeId: string) => void }) {
	return rows.length === 0 ? <EmptyState title="Сотрудников нет" text="В выбранных активных магазинах нет сотрудников для отчёта." /> : <div className="table-scroll"><table className="data-table report-table report-employee-table"><thead><tr><th>Сотрудник</th><th className="report-column-memberships">Магазины</th><th>Попытки · зачёт / нет</th><th>Задания: назначено / проверено</th><th className="report-column-photos">Фотоотчёты</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employeeId}><td><button className="report-table-link" type="button" onClick={() => onSelect(row.employeeId)}>{row.displayName}</button></td><td className="report-column-memberships">{row.assignedStoreCount}</td><td>{row.submittedQuizAttemptCount} · {row.passedExamAttemptCount} / {row.failedExamAttemptCount}</td><td>{row.assignedTaskCount} / {row.checkedTaskCount}</td><td className="report-column-photos">{row.submittedPhotoReportCount}</td></tr>)}</tbody></table></div>
}

function OverviewView({ data, definitions, metric, onMetricChange, onOpenStores }: { data: ReportingData; definitions: Definition[]; metric: DailyActivityMetric; onMetricChange: (metric: DailyActivityMetric) => void; onOpenStores: () => void }) {
	const overview = data.overview
	const series = data.timeSeries
	if (!overview || !series) return null
	const metrics = overview.metrics
	return <>
		<MetricGrid>
			<MetricCard label="Активные магазины" value={metrics.activeStoreCount} definitions={definitions} metric="activeStoreCount" />
			<MetricCard label="Активные назначенные сотрудники" value={metrics.activeAssignedEmployeeCount} definitions={definitions} metric="activeAssignedEmployeeCount" />
			<MetricCard label="Магазины с событиями периода" value={metrics.participatingStoreCount} definitions={definitions} metric="participatingStoreCount" tone="green" />
			<MetricCard label="Проверено заданий" value={formatReportPercent(metrics.taskCompletionRate)} note={`${formatReportNumber(metrics.checkedTaskCount)} из ${formatReportNumber(metrics.assignedTaskCount)} созданных в периоде`} definitions={definitions} metric="taskCompletionRate" tone="green" />
			<MetricCard label="Ожидают проверки" value={metrics.outstandingReviewCount} note="Текущий срез, включая ответы тестов на ручную проверку" definitions={definitions} metric="outstandingReviewCount" tone="orange" />
		</MetricGrid>
		<Panel title="Активность по дням" description={`События по локальным датам · ${series.period.timezone}`} action={<Button variant="outline" size="sm" onClick={onOpenStores}>Сравнить магазины</Button>}>
			<DailyActivityChart points={series.data} metric={metric} onMetricChange={onMetricChange} />
		</Panel>
		<p className="report-snapshot-note">События относятся к выбранному периоду. Статусы и численность — срез на момент запроса, а не исторический снимок.</p>
	</>
}

function StoresView({ response, onSelectStore, onPage, page }: { response: NonNullable<ReportingData['stores']>; onSelectStore: (storeId: string) => void; onPage: (page: number) => void; page: number }) {
	return <>
		<p className="report-snapshot-note">Магазинов в доступной области: {formatReportNumber(response.pagination.total)}.</p>
		<Panel title="Задания по магазинам" description="На графике — количества из API; порядок строк задаётся API по названию магазина.">
			<StoreComparisonChart stores={response.data} />
		</Panel>
		<Panel title="Показатели магазинов" description="Попытки тестов распределяются по текущим memberships и могут повторяться между магазинами. Не суммируйте их для сетевого итога.">
			<StoreTable rows={response.data} onSelect={onSelectStore} />
			<Pagination page={response.pagination.page} totalPages={response.pagination.totalPages} total={response.pagination.total} onChange={onPage} />
		</Panel>
	</>
}

function EmployeesView({ response, onSelectEmployee, onPage, page, employeeId }: { response: NonNullable<ReportingData['employees']>; onSelectEmployee: (employeeId: string) => void; onPage: (page: number) => void; page: number; employeeId?: string }) {
	return <>
		{employeeId ? <div className="report-filter-chip"><span>Отчёт по выбранному сотруднику</span><Button variant="ghost" size="sm" onClick={() => onSelectEmployee('')}>Сбросить выбор</Button></div> : null}
		<Panel title="Участие сотрудников" description="Только активные сотрудники с membership в выбранных активных магазинах. Контакты и HR-поля не передаются.">
			<EmployeeTable rows={response.data} onSelect={onSelectEmployee} />
			<Pagination page={response.pagination.page} totalPages={response.pagination.totalPages} total={response.pagination.total} onChange={onPage} />
		</Panel>
	</>
}

function TrainingView({ response, definitions }: { response: NonNullable<ReportingData['training']>; definitions: Definition[] }) {
	const { quizzes, knowledge } = response
	return <>
		<MetricGrid>
			<MetricCard label="Доступные назначения тестов" value={quizzes.availableAssignmentCount} definitions={definitions} metric="availableAssignmentCount" />
			<MetricCard label="Завершённые назначения" value={quizzes.completedCurrentAssignmentCount} note={`Выполнение: ${formatReportPercent(quizzes.completionRate)}`} definitions={definitions} metric="completedCurrentAssignmentCount" tone="green" />
			<MetricCard label="Отправленные попытки" value={quizzes.submittedAttemptCount} definitions={definitions} metric="submittedAttemptCount" />
			<MetricCard label="Средний балл экзаменов" value={formatReportPercent(quizzes.averageExamScore)} note="Только оценённые экзаменационные попытки" definitions={definitions} metric="averageExamScore" tone="green" />
			<MetricCard label="Средний балл практики" value={formatReportPercent(quizzes.averagePracticeScore)} note="Отдельно от экзаменов и опросов" definitions={definitions} metric="averagePracticeScore" />
			<MetricCard label="Подтверждения базы знаний" value={`${knowledge.acknowledgedCount} / ${knowledge.requiredAcknowledgmentCount}`} note={`Выполнение: ${formatReportPercent(knowledge.completionRate)}`} definitions={definitions} metric="knowledgeAcknowledgmentProgress" tone="green" />
		</MetricGrid>
		<div className="report-two-columns">
			<Panel title="Попытки по режимам" description="Режимы не объединяются в средний балл.">
				<StatusBreakdown label="Количество попыток экзамена, практики и опросов" items={[{ label: 'Экзамены', value: quizzes.examAttemptCount, tone: 'blue' }, { label: 'Практика', value: quizzes.practiceAttemptCount, tone: 'green' }, { label: 'Опросы без оценки', value: quizzes.surveyAttemptCount, tone: 'orange' }]} />
			</Panel>
			<Panel title="Результаты экзаменов" description="Зачёт и незачёт — только попытки экзаменов с явно сохранённым результатом.">
				<StatusBreakdown label="Результаты экзаменационных попыток" items={[{ label: 'Зачёт', value: quizzes.passedExamAttemptCount, tone: 'green' }, { label: 'Незачёт', value: quizzes.failedExamAttemptCount, tone: 'red' }]} />
			</Panel>
		</div>
	</>
}

function PhotosView({ response, series, definitions, metric, onMetricChange }: { response: NonNullable<ReportingData['photos']>; series: ReportTimeSeriesResponse; definitions: Definition[]; metric: DailyActivityMetric; onMetricChange: (metric: DailyActivityMetric) => void }) {
	return <>
		<MetricGrid>
			<MetricCard label="Уникальные фотоотчёты" value={response.submittedReportCount} note="По первой отправленной версии за период" definitions={definitions} metric="submittedReportCount" />
			<MetricCard label="Отправленные версии" value={response.submittedVersionCount} definitions={definitions} metric="submittedVersionCount" />
			<MetricCard label="Повторные отправки" value={response.resubmissionCount} definitions={definitions} metric="resubmissionCount" tone="orange" />
			<MetricCard label="Среднее время проверки" value={response.averageReviewHours === null ? '—' : `${formatReportNumber(response.averageReviewHours)} ч`} note="Для версий, проверенных в периоде" definitions={definitions} metric="photoReviewTurnaroundHours" />
		</MetricGrid>
		<div className="report-two-columns">
			<Panel title="Текущий статус фотоотчётов" description="Срез последней версии каждого отчёта на момент запроса; не ограничен выбранным периодом.">
				<StatusBreakdown label="Текущие статусы фотоотчётов" items={[{ label: 'Ожидают проверки', value: response.currentStatus.pending, tone: 'orange' }, { label: 'Проверены', value: response.currentStatus.checked, tone: 'green' }, { label: 'Отклонены', value: response.currentStatus.rejected, tone: 'red' }]} />
			</Panel>
			<Panel title="Отправки по дням" description="Считает версии фотоотчётов, а не уникальные отчёты.">
				<DailyActivityChart points={series.data} metric="photoVersionsSubmitted" onMetricChange={onMetricChange} />
			</Panel>
		</div>
		<p className="report-snapshot-note">История рассмотрения: {formatReportNumber(response.reviewEventCount)} событий за период. Среднее время — {response.averageReviewHours === null ? 'нет наблюдений' : `${formatReportNumber(response.averageReviewHours)} часов`}.</p>
	</>
}

function TasksView({ response, series, definitions, metric, onMetricChange }: { response: NonNullable<ReportingData['tasks']>; series: ReportTimeSeriesResponse; definitions: Definition[]; metric: DailyActivityMetric; onMetricChange: (metric: DailyActivityMetric) => void }) {
	return <>
		<MetricGrid>
			<MetricCard label="Назначенные задания" value={response.assignedTaskCount} note="Повторяющиеся экземпляры считаются отдельно" definitions={definitions} metric="assignedTaskCount" />
			<MetricCard label="Проверено" value={`${response.checkedTaskCount} · ${formatReportPercent(response.completionRate)}`} note="Отклонённые не считаются завершёнными" definitions={definitions} metric="taskCompletionRate" tone="green" />
			<MetricCard label="Требуют внимания" value={response.overdueTaskCount} note="Просрочены и ещё не проверены" definitions={definitions} metric="overdueTaskCount" tone="orange" />
			<MetricCard label="Отправки на проверку" value={response.submissionEventCount} note="Включая повторные отправки" definitions={definitions} metric="taskSubmissionEventCount" />
		</MetricGrid>
		<div className="report-two-columns">
			<Panel title="Статусы заданий" description="Задания созданы в периоде; статусы показаны на момент запроса.">
				<StatusBreakdown label="Статусы заданий за выбранный период" items={[{ label: 'В работе', value: response.inProgressTaskCount, tone: 'blue' }, { label: 'Отправлены', value: response.submittedTaskCount, tone: 'orange' }, { label: 'Проверены', value: response.checkedTaskCount, tone: 'green' }, { label: 'Отклонены', value: response.rejectedTaskCount, tone: 'red' }]} />
			</Panel>
			<Panel title="Создание заданий по дням" description="Каждый recurring occurrence считается отдельным заданием.">
				<DailyActivityChart points={series.data} metric="taskOccurrencesCreated" onMetricChange={onMetricChange} />
			</Panel>
		</div>
	</>
}

function SchedulesView({ response, definitions }: { response: NonNullable<ReportingData['schedules']>; definitions: Definition[] }) {
	return <>
		<MetricGrid>
			<MetricCard label="Опубликованные смены" value={response.shiftCount} definitions={definitions} metric="publishedShiftCount" />
			<MetricCard label="Плановые часы" value={`${formatReportNumber(response.plannedHours)} ч`} note="Плановая длительность по UTC; не фактически отработанное время" definitions={definitions} metric="plannedHours" tone="green" />
			<MetricCard label="Запланированные выходные" value={response.scheduledDayOffCount} definitions={definitions} metric="scheduledDayOffCount" />
		</MetricGrid>
		<Panel title="Покрытие по магазинам" description="Число локальных дат со сменами; не показывает минимальный штат или посещаемость.">
			{response.stores.length === 0 ? <EmptyState title="Опубликованных смен нет" text="За выбранный период нет смен в опубликованных расписаниях." /> : <div className="table-scroll"><table className="data-table report-table"><thead><tr><th>Магазин</th><th>Смены</th><th>Плановые часы</th><th>Выходные</th><th>Даты со сменами</th></tr></thead><tbody>{response.stores.map((store) => <tr key={store.storeId}><td>{store.storeName}</td><td>{store.shiftCount}</td><td>{formatReportNumber(store.plannedHours)}</td><td>{store.scheduledDayOffCount}</td><td>{store.coveredLocalDateCount}</td></tr>)}</tbody></table></div>}
		</Panel>
	</>
}

function OperationsView({ response, definitions, storeId }: { response: NonNullable<ReportingData['operations']>; definitions: Definition[]; storeId?: string }) {
	return <>
		<MetricGrid>
			<MetricCard label="Активные кампании" value={response.campaigns.activeCampaignCount} definitions={definitions} metric="campaignLiveCount" />
			<MetricCard label="Целевые магазины кампаний" value={response.campaigns.targetedStoreCount} note="Кампании пересекаются с выбранным периодом" definitions={definitions} metric="targetedStoreCount" />
			<MetricCard label="Исполнение кампаний" value={formatReportPercent(response.campaigns.completionRate)} note={`${response.campaigns.checkedExecutionCount} проверено из ${response.campaigns.targetedExecutionCount} целевых пар`} definitions={definitions} metric="campaignCompletionRate" tone="green" />
			<MetricCard label="Открытые проблемы" value={response.issues.openCount} note={`В работе: ${response.issues.inProgressCount}`} definitions={definitions} metric="issueCurrentStatus" tone="orange" />
		</MetricGrid>
		<div className="report-two-columns">
			<Panel title="Исполнение кампаний" description="Статусы на момент запроса; процент рассчитан API по целевым парам кампания × магазин.">
				<StatusBreakdown label="Статусы исполнения кампаний" items={[{ label: 'Проверено', value: response.campaigns.checkedExecutionCount, tone: 'green' }, { label: 'Ожидает / не начато', value: response.campaigns.pendingExecutionCount, tone: 'orange' }, { label: 'Отклонено', value: response.campaigns.rejectedExecutionCount, tone: 'red' }]} />
				<p className="report-inline-note">Отправок версий за период: {response.campaigns.submissionEventCount}.</p>
			</Panel>
			<Panel title="Проверки выкладки" description="Текущие статусы инспекций; отправки и среднее время относятся к выбранному периоду.">
				<StatusBreakdown label="Статусы проверок выкладки" items={[{ label: 'Ожидают', value: response.merchandising.pendingInspectionCount, tone: 'orange' }, { label: 'Проверены', value: response.merchandising.checkedInspectionCount, tone: 'green' }, { label: 'Отклонены', value: response.merchandising.rejectedInspectionCount, tone: 'red' }]} />
				<p className="report-inline-note">Отправлено: {response.merchandising.submittedInspectionCount} · повторно: {response.merchandising.resubmissionCount} · средняя проверка: {response.merchandising.averageReviewHours === null ? '—' : `${formatReportNumber(response.merchandising.averageReviewHours)} ч`}.</p>
			</Panel>
			<Panel title="Проблемы магазинов" description="Текущий срез статусов и приоритетов.">
				<StatusBreakdown label="Статусы проблем магазинов" items={[{ label: 'Открыты', value: response.issues.openCount, tone: 'orange' }, { label: 'В работе', value: response.issues.inProgressCount, tone: 'blue' }, { label: 'Решены', value: response.issues.resolvedCount, tone: 'green' }, { label: 'Закрыты', value: response.issues.closedCount, tone: 'green' }]} />
				<p className="report-inline-note">Срочные: {response.issues.urgentCount} · высокий приоритет: {response.issues.highPriorityCount} · переходов в решённое/закрытое за период: {response.issues.resolutionEventCount}.</p>
			</Panel>
			<Panel title="Операционные заявки" description="Статусы на момент запроса; решения и завершения — события за период.">
				<StatusBreakdown label="Статусы операционных заявок" items={[{ label: 'Новые', value: response.requests.submittedCount, tone: 'blue' }, { label: 'Одобрены', value: response.requests.approvedCount, tone: 'green' }, { label: 'Отклонены', value: response.requests.rejectedCount, tone: 'red' }, { label: 'В работе', value: response.requests.inProgressCount, tone: 'orange' }, { label: 'Выполнены', value: response.requests.completedCount, tone: 'green' }]} />
				<p className="report-inline-note">Решений за период: {response.requests.decisionEventCount} · среднее до решения: {response.requests.averageDecisionHours === null ? '—' : `${formatReportNumber(response.requests.averageDecisionHours)} ч`} · до выполнения: {response.requests.averageCompletionHours === null ? '—' : `${formatReportNumber(response.requests.averageCompletionHours)} ч`}.</p>
			</Panel>
		</div>
		<Panel title="Управление операциями" description={storeId ? 'Ссылки ведут в существующие модули; доступ к данным там повторно проверяется API.' : 'Откройте существующий модуль управления. Менеджеры сохраняют серверную область доступа.'}>
			<nav className="report-operation-links" aria-label="Модули управления операциями">{REPORT_OPERATION_LINKS.map((item) => <Link className="report-operation-link" href={item.href} key={item.href}>{item.label}<span aria-hidden="true">↗</span></Link>)}</nav>
		</Panel>
	</>
}

export function ReportingPage() {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const search = searchParams.toString()
	const view = validView(searchParams.get('view'))
	const page = safePage(searchParams.get('page'))
	const employeeId = searchParams.get('employeeId') || undefined
	const filterState = useMemo(() => validateReportFilters(Object.fromEntries(new URLSearchParams(search))), [search])
	const filters = filterState.filters
	const dataKey = filters ? reportingRequestKey(view, filters, page, view === 'employees' ? employeeId : undefined) : `invalid:${view}:${search}`
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
	const [retryCount, setRetryCount] = useState(0)
	const [definitions, setDefinitions] = useState<Definition[]>([])
	const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
	const [storeOptionsLoading, setStoreOptionsLoading] = useState(true)
	const [storeOptionsError, setStoreOptionsError] = useState<string | null>(null)
	const [referenceRetryCount, setReferenceRetryCount] = useState(0)
	const [dailyMetric, setDailyMetric] = useState<DailyActivityMetric>('taskOccurrencesCreated')
	const filterPeriod = REPORT_PERIODS.some((item) => item.value === searchParams.get('period')) ? searchParams.get('period') as ReportPeriodPreset : 'last_30_days'

	const updateSearch = useCallback((patch: Record<string, string | null>) => {
		const next = mergeReportingSearch(search, patch)
		router.replace(reportPath(pathname, next), { scroll: false })
	}, [pathname, router, search])

	useEffect(() => {
		const controller = new AbortController()
		async function loadReferenceData() {
			setStoreOptionsLoading(true)
			setStoreOptionsError(null)
			try {
				const [first, definitionResponse] = await Promise.all([
					managementFetch(`/api/admin/reports/stores?${reportQuery({ period: 'today', timezone: REPORT_TIMEZONE }, { page: 1, pageSize: 100 })}`, reportStoresResponseSchema, { signal: controller.signal }),
					managementFetch('/api/admin/reports/metric-definitions', reportMetricDefinitionsResponseSchema, { signal: controller.signal }),
				])
				const laterPages = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) => {
					const query = reportQuery({ period: 'today', timezone: REPORT_TIMEZONE }, { page: index + 2, pageSize: 100 })
					return managementFetch(`/api/admin/reports/stores?${query}`, reportStoresResponseSchema, { signal: controller.signal })
				}))
				if (controller.signal.aborted) return
				setStoreOptions([first, ...laterPages].flatMap((response) => response.data.map(({ storeId, storeName }) => ({ storeId, storeName }))))
				setDefinitions(definitionResponse.data)
			} catch (error) {
				if (!controller.signal.aborted) setStoreOptionsError(reportErrorMessage(error))
			} finally {
				if (!controller.signal.aborted) setStoreOptionsLoading(false)
			}
		}
		void loadReferenceData()
		return () => controller.abort()
	}, [referenceRetryCount])

	useEffect(() => {
		if (!filters) return
		const controller = new AbortController()
		async function load() {
			try {
				const data = await fetchView(view, filters!, page, view === 'employees' ? employeeId : undefined, controller.signal)
				if (!controller.signal.aborted) {
					setSnapshot({ key: dataKey, data })
					setFailure(null)
				}
			} catch (error) {
				if (!controller.signal.aborted) setFailure({ key: dataKey, message: reportErrorMessage(error) })
			}
		}
		void load()
		return () => controller.abort()
	}, [dataKey, employeeId, filters, page, retryCount, view])

	const resultIsCurrent = isCurrentReportingResult(snapshot?.key, dataKey)
	const data = resultIsCurrent ? snapshot?.data ?? null : null
	const currentFailure = failure?.key === dataKey ? failure.message : null
	const loading = Boolean(filters) && !resultIsCurrent && !currentFailure
	const storeId = filters?.storeId
	const selectedStore = storeOptions.find((option) => option.storeId === storeId)
	const startValue = searchParams.get('startDate') ?? ''
	const endValue = searchParams.get('endDate') ?? ''
	const responsePeriod = data?.overview?.period ?? data?.timeSeries?.period ?? data?.stores?.period ?? data?.employees?.period ?? data?.training?.period ?? data?.photos?.period ?? data?.tasks?.period ?? data?.schedules?.period ?? data?.operations?.period

	function changePeriod(value: string) {
		if (value === 'custom') {
			const defaults = defaultCustomPeriod()
			updateSearch({ period: 'custom', startDate: startValue || defaults.startDate, endDate: endValue || defaults.endDate, timezone: REPORT_TIMEZONE, page: '1', employeeId: null })
		} else updateSearch({ period: value, startDate: null, endDate: null, timezone: REPORT_TIMEZONE, page: '1', employeeId: null })
	}

	function setStore(value: string) {
		updateSearch({ storeId: value || null, page: '1', employeeId: null })
	}

	function setPage(value: number) {
		updateSearch({ page: String(value) })
	}

	function resetFilters() {
		updateSearch({ period: 'last_30_days', startDate: null, endDate: null, storeId: null, timezone: REPORT_TIMEZONE, page: '1', employeeId: null })
	}

	function openStore(store: string) {
		updateSearch({ storeId: store, view: 'overview', page: '1', employeeId: null })
	}

	function selectEmployee(employee: string) {
		updateSearch({ employeeId: employee || null, page: '1' })
	}

	const filtersDisabled = !filters || storeOptionsLoading
	return <div className="management-page reporting-page">
		<header className="page-header reporting-header"><div><p className="eyebrow">Отчётность</p><h1 className="page-title">{titles[view]}</h1><p className="page-subtitle">{responsePeriod ? `${formatReportDate(responsePeriod.startDate)} — ${formatReportDate(responsePeriod.endDate)} · ${responsePeriod.timezone}` : `Календарный период · ${REPORT_TIMEZONE}`}{selectedStore ? ` · ${selectedStore.storeName}` : ''}</p></div><Button variant="outline" size="sm" disabled={loading || !filters} onClick={() => setRetryCount((count) => count + 1)}><span className={loading ? 'report-spin' : ''} aria-hidden="true">↻</span>Обновить</Button></header>

		<nav className="report-navigation" aria-label="Разделы аналитики">{views.map((item) => {
			const next = mergeReportingSearch(search, { view: item.value, page: '1', ...(item.value === 'employees' ? {} : { employeeId: null }) })
			return <Link key={item.value} href={reportPath(pathname, next)} aria-current={view === item.value ? 'page' : undefined} className={view === item.value ? 'report-nav-link report-nav-link-active' : 'report-nav-link'}>{item.label}</Link>
		})}</nav>

		<section className="management-filters reporting-filters" aria-label="Фильтры отчёта">
			<div className="form-field"><label htmlFor="report-period">Период</label><Select id="report-period" value={filterPeriod} onChange={(event) => changePeriod(event.target.value)}>{REPORT_PERIODS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</Select></div>
			<div className="form-field"><label htmlFor="report-store">Магазин</label><Select id="report-store" value={storeId ?? ''} onChange={(event) => setStore(event.target.value)} disabled={filtersDisabled}><option value="">Все доступные магазины</option>{storeOptions.map((option) => <option value={option.storeId} key={option.storeId}>{option.storeName}</option>)}</Select></div>
			{filterPeriod === 'custom' ? <>
				<div className="form-field"><label htmlFor="report-start">Начало периода</label><input id="report-start" className="field-control" type="date" value={startValue} onChange={(event) => updateSearch({ startDate: event.target.value, timezone: REPORT_TIMEZONE, page: '1' })} /></div>
				<div className="form-field"><label htmlFor="report-end">Конец периода</label><input id="report-end" className="field-control" type="date" value={endValue} onChange={(event) => updateSearch({ endDate: event.target.value, timezone: REPORT_TIMEZONE, page: '1' })} /></div>
			</> : null}
			<div className="report-filter-actions"><span>{storeOptionsLoading ? 'Загружаем доступные магазины…' : storeOptions.length === 0 ? 'Нет доступных магазинов' : `Часовой пояс: ${REPORT_TIMEZONE}`}</span><Button variant="ghost" size="sm" onClick={resetFilters}>Сбросить</Button></div>
		</section>
		{storeOptionsError ? <div className="management-error report-message" role="alert">{storeOptionsError}<button type="button" onClick={() => setReferenceRetryCount((count) => count + 1)}>Повторить загрузку магазинов</button></div> : null}
		{filterState.error ? <div className="management-error report-message" role="alert">{filterState.error}</div> : null}
		{currentFailure ? <div className="management-error report-message" role="alert">{currentFailure}<button type="button" onClick={() => setRetryCount((count) => count + 1)}>Повторить</button>{currentFailure.includes('Сбросьте фильтр') ? <button type="button" onClick={() => resetFilters()}>Сбросить фильтры</button> : null}{currentFailure.includes('Войдите') ? <Link href="/login">Войти</Link> : null}</div> : null}
		{loading ? <MetricCardsSkeleton /> : null}
		{data && !currentFailure ? <div className="report-content" key={dataKey}>
			{view === 'overview' ? <OverviewView data={data} definitions={definitions} metric={dailyMetric} onMetricChange={setDailyMetric} onOpenStores={() => updateSearch({ view: 'stores', page: '1' })} /> : null}
			{view === 'stores' && data.stores ? <StoresView response={data.stores} page={page} onPage={setPage} onSelectStore={openStore} /> : null}
			{view === 'employees' && data.employees ? <EmployeesView response={data.employees} page={page} employeeId={employeeId} onPage={setPage} onSelectEmployee={selectEmployee} /> : null}
			{view === 'training' && data.training ? <TrainingView response={data.training} definitions={definitions} /> : null}
			{view === 'photos' && data.photos && data.timeSeries ? <PhotosView response={data.photos} series={data.timeSeries} definitions={definitions} metric={dailyMetric} onMetricChange={setDailyMetric} /> : null}
			{view === 'tasks' && data.tasks && data.timeSeries ? <TasksView response={data.tasks} series={data.timeSeries} definitions={definitions} metric={dailyMetric} onMetricChange={setDailyMetric} /> : null}
			{view === 'schedules' && data.schedules ? <SchedulesView response={data.schedules} definitions={definitions} /> : null}
			{view === 'operations' && data.operations ? <OperationsView response={data.operations} definitions={definitions} storeId={storeId} /> : null}
		</div> : null}
		{!loading && !data && !currentFailure && !filterState.error ? <EmptyState title="Отчёт недоступен" text="Обновите страницу или проверьте фильтры." /> : null}
	</div>
}
