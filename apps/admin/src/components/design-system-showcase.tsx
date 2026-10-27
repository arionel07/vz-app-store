'use client'

import { useState } from 'react'
import { Check, Copy, Download, MoreHorizontal, Plus, Search, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'

const tokenColors = [
	{ label: 'Background', value: '--background', className: 'token-background' },
	{ label: 'Surface', value: '--surface', className: 'token-surface' },
	{ label: 'Surface raised', value: '--surface-raised', className: 'token-raised' },
	{ label: 'Primary blue', value: '--brand-blue', className: 'token-blue' },
	{ label: 'Success green', value: '--brand-green', className: 'token-green' },
	{ label: 'Warm orange', value: '--brand-orange', className: 'token-orange' },
]

export function DesignSystemShowcase() {
	const [dialogOpen, setDialogOpen] = useState(false)
	const [copied, setCopied] = useState('')
	const copyToken = (token: string) => { setCopied(token); void navigator.clipboard?.writeText(`var(${token})`); toast.success('Токен скопирован'); setTimeout(() => setCopied(''), 1500) }
	return <div className="design-page">
		<header className="page-header"><div><p className="eyebrow">Визуальная документация</p><h1 className="page-title">Design system</h1><p className="page-subtitle">Компоненты, токены и состояния интерфейса Vizaje Staff</p></div><div className="showcase-header-actions"><Button variant="outline" size="sm" onClick={() => toast.info('Экспорт появится после фиксации токенов')}><Download size={15} />Экспорт</Button><Button size="sm" onClick={() => setDialogOpen(true)}><Plus size={15} />Открыть диалог</Button></div></header>
		<div className="showcase-banner"><Sparkles size={17} /><div><strong>Рабочая спецификация</strong><p>Все примеры ниже интерактивны, но не подключены к API. Страница доступна только в development-сборке.</p></div></div>
		<section className="showcase-section"><div className="section-heading"><div><p className="eyebrow">01 · Цвет</p><h2>Semantic tokens</h2></div><p>Тема переключается в верхней панели. Компоненты используют роли, а не значения цветов.</p></div><div className="token-grid">{tokenColors.map((token) => <button type="button" className="token-card" key={token.value} onClick={() => copyToken(token.value)}><span className={`token-swatch ${token.className}`} /><span><strong>{token.label}</strong><small>{copied === token.value ? <><Check size={12} />Скопировано</> : <>{token.value}<Copy size={12} /></>}</small></span></button>)}</div></section>
		<section className="showcase-section"><div className="section-heading"><div><p className="eyebrow">02 · Типографика</p><h2>Geist hierarchy</h2></div><p>Спокойная иерархия для плотного desktop-интерфейса.</p></div><Card><CardContent className="type-specimen"><div><span className="type-label">Display / 32</span><h3>Спокойный рабочий день</h3></div><Separator orientation="vertical" /><div><span className="type-label">Body / 14</span><p>Понятные данные, короткие действия и достаточно воздуха вокруг важных решений.</p></div><div><span className="type-label">Caption / 12</span><small>Обновлено сегодня в 14:32</small></div></CardContent></Card></section>
		<section className="showcase-section"><div className="section-heading"><div><p className="eyebrow">03 · Компоненты</p><h2>Controls & states</h2></div><p>Состояния, которые составляют рабочие сценарии администраторской панели.</p></div><div className="showcase-grid"><Card><CardHeader><CardTitle>Buttons</CardTitle><CardDescription>Круглые action-поверхности с ясной иерархией.</CardDescription></CardHeader><CardContent className="component-stack"><div className="component-row"><Button onClick={() => toast.success('Действие выполнено')}><Plus size={15} />Основное действие</Button><Button variant="outline">Вторичное</Button><Button variant="ghost">Тихое</Button><Tooltip label="Скопировать"><Button variant="ghost" size="icon-sm" aria-label="Скопировать" onClick={() => toast.info('Скопировано')}><Copy size={15} /></Button></Tooltip></div><div className="component-row"><Button size="lg"><Sparkles size={16} />Большая кнопка</Button><Button variant="destructive">Удалить</Button><Button disabled>Недоступно</Button></div></CardContent></Card><Card><CardHeader><CardTitle>Form controls</CardTitle><CardDescription>Поля с фокусом, подсказками и понятными labels.</CardDescription></CardHeader><CardContent className="form-stack"><label>Поиск<Input placeholder="Найти сотрудника" defaultValue="Мария" /></label><label>Роль<Select defaultValue="staff"><option value="staff">Продавец-консультант</option><option value="manager">Менеджер</option></Select></label><label>Комментарий<Textarea placeholder="Короткое описание" rows={3} /></label><div className="check-row"><Checkbox defaultChecked id="demo-check" /><label htmlFor="demo-check">Показывать только активных</label><Switch defaultChecked aria-label="Активный режим" /></div></CardContent></Card></div></section>
		<section className="showcase-section"><div className="section-heading"><div><p className="eyebrow">04 · Data display</p><h2>Statuses, tabs & table</h2></div><p>Сканируемые списки, умеренный цвет и текстовые статусы.</p></div><Card><CardContent><Tabs tabs={[{ value: 'all', label: 'Все сотрудники', content: <StatusTable /> }, { value: 'active', label: 'Активные', content: <div className="tab-empty">Показаны активные сотрудники</div> }, { value: 'archived', label: 'Архив', content: <div className="tab-empty">Архив пока пуст</div> }]} /></CardContent></Card></section>
		<section className="showcase-section"><div className="section-heading"><div><p className="eyebrow">05 · Feedback</p><h2>Empty, loading & dialog</h2></div><p>Деликатные ответы интерфейса на отсутствие данных и ожидание.</p></div><div className="showcase-grid"><Card><CardHeader><CardTitle>Empty state</CardTitle></CardHeader><CardContent><div className="empty-state"><span className="empty-icon"><Search size={18} /></span><strong>Ничего не найдено</strong><p>Попробуйте изменить запрос или фильтры.</p><Button variant="outline" size="sm" onClick={() => toast.info('Фильтры сброшены')}>Сбросить фильтры</Button></div></CardContent></Card><Card><CardHeader><CardTitle>Loading state</CardTitle></CardHeader><CardContent className="skeleton-stack"><Skeleton className="skeleton-title" /><Skeleton /><Skeleton /><Skeleton className="skeleton-short" /></CardContent></Card></div></section>
		<Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Добавить сотрудника"><div className="form-stack"><p className="dialog-copy">Демонстрационная форма для проверки плотности и поведения диалога.</p><label>Имя<Input placeholder="Например, Анна" /></label><label>Магазин<Select defaultValue="aviapark"><option value="aviapark">ТЦ Авиапарк</option><option value="european">ТЦ Европейский</option></Select></label><div className="dialog-actions"><Button variant="outline" onClick={() => setDialogOpen(false)}>Отменить</Button><Button onClick={() => { setDialogOpen(false); toast.success('Демонстрационный сотрудник добавлен') }}>Сохранить</Button></div></div></Dialog>
	</div>
}

function StatusTable() {
	return <Table><TableHeader><TableRow><TableHead>Сотрудник</TableHead><TableHead>Роль</TableHead><TableHead>Статус</TableHead><TableHead aria-label="Действия" /></TableRow></TableHeader><TableBody><TableRow><TableCell><strong>Мария Соколова</strong></TableCell><TableCell>Консультант</TableCell><TableCell><Badge tone="green">Активен</Badge></TableCell><TableCell><Button variant="ghost" size="icon-sm" aria-label="Дополнительные действия"><MoreHorizontal size={16} /></Button></TableCell></TableRow><TableRow><TableCell><strong>Виктор Смирнов</strong></TableCell><TableCell>Консультант</TableCell><TableCell><Badge tone="orange">В отпуске</Badge></TableCell><TableCell><Button variant="ghost" size="icon-sm" aria-label="Дополнительные действия"><MoreHorizontal size={16} /></Button></TableCell></TableRow></TableBody></Table>
}
