'use client'

import {
	ArrowRight,
	ArrowUpRight,
	ClipboardCheck,
	FileCheck2,
	Image as ImageIcon,
	ImagePlus,
	MapPin,
	MoreHorizontal,
	Store,
	UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { demoActivity, demoEmployees, demoKpis, demoStores } from '@/lib/demo-data'
import { cn } from 'cn'

const kpiIcons = { users: UsersRound, stores: Store, tests: ClipboardCheck, photos: ImageIcon }

function Avatar({ initials, tone }: { initials: string; tone: string }) {
	return <span className={cn('avatar', `avatar-${tone}`)}>{initials}</span>
}

function Header() {
	return <header className="page-header"><div><p className="eyebrow">Панель управления</p><h1 className="page-title">Обзор</h1><p className="page-subtitle">Сегодня, 27 октября · <span className="demo-note">демонстрационные данные</span></p></div><Button onClick={() => toast.info('Данные обновятся после подключения API')} variant="outline" size="sm">Обновить данные <ArrowRight size={15} /></Button></header>
}

export function OverviewPage() {
	return <div className="overview-page">
		<Header />
		<div className="kpi-grid">{demoKpis.map((kpi) => { const Icon = kpiIcons[kpi.icon]; return <Card key={kpi.label} className="kpi-card"><CardContent><div className={cn('kpi-icon', `tone-${kpi.tone}`)}><Icon size={19} /></div><div className="kpi-meta"><span>{kpi.label}</span><strong>{kpi.value}</strong></div><div className="kpi-change"><span className={cn(kpi.change === '0%' ? 'change-muted' : 'change-positive')}>{kpi.change}<ArrowUpRight size={13} /></span><small>{kpi.note}</small></div></CardContent></Card> })}</div>
		<div className="content-grid">
			<Card><CardHeader><div><p className="eyebrow">События</p><CardTitle>Последняя активность</CardTitle></div><Button variant="ghost" size="sm" onClick={() => toast.info('Журнал событий будет доступен после подключения API')}>Все события <ArrowRight size={14} /></Button></CardHeader><CardContent className="panel-list">{demoActivity.map((event) => <div className="activity-row" key={`${event.name}-${event.time}`}><Avatar initials={event.initials} tone={event.tone} /><div className="activity-copy"><p><strong>{event.name}</strong> {event.action}</p><small><MapPin size={12} />{event.store}</small></div><time>{event.time}</time><span className={cn('activity-kind', event.kind === 'photo' ? 'kind-photo' : 'kind-test')}>{event.kind === 'photo' ? <ImagePlus size={14} /> : <FileCheck2 size={14} />}</span></div>)}</CardContent></Card>
			<Card><CardHeader><div><p className="eyebrow">Сеть магазинов</p><CardTitle>Обзор магазинов</CardTitle></div><Button variant="ghost" size="sm" onClick={() => toast.info('Управление магазинами будет доступно после подключения API')}>Все магазины <ArrowRight size={14} /></Button></CardHeader><CardContent className="panel-list">{demoStores.slice(0, 5).map((store) => <div className="store-row" key={store.name}><div className="store-symbol"><Store size={16} /></div><div className="store-copy"><strong>{store.name}</strong><small>{store.city} · {store.active} активных</small><div className="progress-track"><span className="progress-bar" style={{ width: `${store.progress}%` }} /></div></div><span className="store-progress">{store.progress}%</span></div>)}</CardContent></Card>
		</div>
		<Card className="employees-panel"><CardHeader><div><p className="eyebrow">Команда</p><CardTitle>Недавние сотрудники</CardTitle></div><Button variant="ghost" size="sm" onClick={() => toast.info('Список сотрудников будет доступен после подключения API')}>Все сотрудники <ArrowRight size={14} /></Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Сотрудник</TableHead><TableHead>Магазин</TableHead><TableHead>Роль</TableHead><TableHead>Тесты</TableHead><TableHead>Последняя активность</TableHead><TableHead>Статус</TableHead><TableHead aria-label="Действия" /></TableRow></TableHeader><TableBody>{demoEmployees.map((employee) => <TableRow key={employee.name}><TableCell><div className="table-person"><Avatar initials={employee.initials} tone={employee.tone} /><strong>{employee.name}</strong></div></TableCell><TableCell>{employee.store}</TableCell><TableCell className="cell-muted">{employee.role}</TableCell><TableCell>{employee.tests}</TableCell><TableCell className="cell-muted">{employee.activity}</TableCell><TableCell><Badge tone={employee.status === 'Активен' ? 'green' : 'orange'}>{employee.status}</Badge></TableCell><TableCell><Button variant="ghost" size="icon-sm" aria-label={`Действия: ${employee.name}`} onClick={() => toast.info(`Действия для ${employee.name} недоступны в демо`)}><MoreHorizontal size={16} /></Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
		<div className="demo-footer"><span><span className="demo-dot" />Демонстрационный режим</span><span>Подключение API отключено · изменения не сохраняются</span></div>
	</div>
}
