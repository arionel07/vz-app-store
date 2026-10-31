'use client'

import type { ReportTimeSeriesPoint, ReportStoreRow } from '@vizaje/contracts'
import { formatReportDate, formatReportNumber } from '@/lib/reporting-state'

export type DailyActivityMetric = 'taskOccurrencesCreated' | 'photoVersionsSubmitted' | 'quizAttemptsSubmitted' | 'campaignSubmissions' | 'merchandisingInspectionsSubmitted' | 'issuesCreated' | 'requestsCreated'
export type DailyChartDatum = { localDate: string; value: number }

export function mapDailyChartPoints(points: ReportTimeSeriesPoint[], metric: DailyActivityMetric): DailyChartDatum[] {
	return points.map((point) => ({ localDate: point.localDate, value: point[metric] }))
}

const dailyMetrics: Array<{ key: DailyActivityMetric; label: string }> = [
	{ key: 'taskOccurrencesCreated', label: 'Созданные задания' },
	{ key: 'photoVersionsSubmitted', label: 'Версии фотоотчётов' },
	{ key: 'quizAttemptsSubmitted', label: 'Отправленные попытки тестов' },
	{ key: 'campaignSubmissions', label: 'Отправки кампаний' },
	{ key: 'merchandisingInspectionsSubmitted', label: 'Проверки выкладки' },
	{ key: 'issuesCreated', label: 'Созданные проблемы' },
	{ key: 'requestsCreated', label: 'Созданные заявки' },
]

export function DailyActivityChart({ points, metric, onMetricChange }: { points: ReportTimeSeriesPoint[]; metric: DailyActivityMetric; onMetricChange: (value: DailyActivityMetric) => void }) {
	const selected = dailyMetrics.find((item) => item.key === metric) ?? dailyMetrics[0]!
	const chartPoints = mapDailyChartPoints(points, metric)
	const values = chartPoints.map((point) => point.value)
	const max = Math.max(1, ...values)
	const hasEvents = values.some((value) => value > 0)
	const width = 720
	const height = 210
	const padX = 26
	const padY = 18
	const coordinates = chartPoints.map((point, index) => {
		const x = chartPoints.length < 2 ? width / 2 : padX + (index * (width - padX * 2)) / (chartPoints.length - 1)
		const y = height - padY - (point.value / max) * (height - padY * 2)
		return { x, y, point }
	})
	const path = coordinates.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
	const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].filter((index) => index >= 0)
	return <div className="report-chart-wrap">
		<div className="report-chart-heading"><span className="report-legend-dot" aria-hidden="true" /><span>{selected.label}</span><label className="report-chart-select"><span className="sr-only">Показатель временного ряда</span><select className="field-control" value={metric} onChange={(event) => onMetricChange(event.target.value as DailyActivityMetric)}>{dailyMetrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
		{chartPoints.length === 0 ? <div className="report-chart-empty">За выбранный период нет точек временного ряда.</div> : !hasEvents ? <>
			<div className="report-chart-empty">За выбранный период событий этого типа нет.</div>
			<details className="report-chart-data"><summary>Показать значения по дням</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Дата</th><th>{selected.label}</th></tr></thead><tbody>{chartPoints.map((point) => <tr key={point.localDate}><td>{formatReportDate(point.localDate)}</td><td>{formatReportNumber(point.value)}</td></tr>)}</tbody></table></div></details>
		</> : <>
			<svg className="report-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="daily-chart-title daily-chart-description">
				<title id="daily-chart-title">{selected.label} по дням</title>
				<desc id="daily-chart-description">Значения по календарным дням в часовом поясе отчёта. Точные данные доступны в таблице под графиком.</desc>
				<line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="report-chart-axis" />
				<line x1={padX} y1={padY} x2={width - padX} y2={padY} className="report-chart-gridline" />
				<text x="2" y={padY + 4} className="report-chart-tick">{formatReportNumber(max)}</text>
				<text x="13" y={height - padY} className="report-chart-tick">0</text>
				<path d={path} className="report-chart-line" />
				{coordinates.map(({ x, y, point }) => <circle key={point.localDate} cx={x} cy={y} r="2.5" className="report-chart-point"><title>{`${formatReportDate(point.localDate)} · ${selected.label}: ${formatReportNumber(point.value)}`}</title></circle>)}
				{labelIndexes.map((index) => <text key={index} x={coordinates[index]?.x ?? 0} y={height - 2} textAnchor={index === 0 ? 'start' : index === chartPoints.length - 1 ? 'end' : 'middle'} className="report-chart-tick">{formatReportDate(chartPoints[index]!.localDate)}</text>)}
			</svg>
			<details className="report-chart-data"><summary>Показать значения по дням</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Дата</th><th>{selected.label}</th></tr></thead><tbody>{chartPoints.map((point) => <tr key={point.localDate}><td>{formatReportDate(point.localDate)}</td><td>{formatReportNumber(point.value)}</td></tr>)}</tbody></table></div></details>
		</>}
	</div>
}

export function StatusBreakdown({ items, label }: { items: Array<{ label: string; value: number; tone?: 'blue' | 'green' | 'orange' | 'red' }>; label: string }) {
	const max = Math.max(1, ...items.map((item) => item.value))
	return <div className="report-breakdown" role="group" aria-label={label}>
		{items.map((item) => <div className="report-breakdown-row" key={item.label}>
			<span className="report-breakdown-label">{item.label}</span>
			<span className="report-breakdown-track" aria-hidden="true"><span className={`report-breakdown-fill report-tone-${item.tone ?? 'blue'}`} style={{ width: `${(item.value / max) * 100}%` }} /></span>
			<strong>{formatReportNumber(item.value)}</strong>
		</div>)}
	</div>
}

export function StoreComparisonChart({ stores }: { stores: ReportStoreRow[] }) {
	const max = Math.max(1, ...stores.flatMap((store) => [store.assignedTaskCount, store.checkedTaskCount]))
	return <div className="report-store-chart" role="group" aria-label="Сравнение количества назначенных и проверенных заданий по магазинам">
		{stores.length === 0 ? <div className="report-chart-empty">Нет доступных магазинов.</div> : stores.map((store) => <div className="report-store-chart-row" key={store.storeId}>
			<div className="report-store-chart-name" title={store.storeName}>{store.storeName}</div>
			<div className="report-store-chart-bars" aria-hidden="true">
				<span className="report-store-bar report-tone-blue" style={{ width: `${(store.assignedTaskCount / max) * 100}%` }} />
				<span className="report-store-bar report-tone-green" style={{ width: `${(store.checkedTaskCount / max) * 100}%` }} />
			</div>
			<div className="report-store-chart-values" aria-label={`${store.assignedTaskCount} назначено, ${store.checkedTaskCount} проверено`}>{store.assignedTaskCount} / {store.checkedTaskCount}</div>
		</div>)}
		<div className="report-chart-legend"><span><i className="report-legend-dot" />Назначено</span><span><i className="report-legend-dot report-tone-green" />Проверено</span></div>
	</div>
}
