import { EmployeesPage } from '@/components/employees-page'
import { AdminShell } from '@/components/admin-shell'

export default function EmployeesRoute() {
	return <AdminShell><EmployeesPage /></AdminShell>
}
