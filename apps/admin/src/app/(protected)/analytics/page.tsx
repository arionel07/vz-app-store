import { ReportingPage } from '@/components/reporting-page'
import { AdminShell } from '@/components/admin-shell'

export default function AnalyticsRoute() {
	return <AdminShell><ReportingPage /></AdminShell>
}
