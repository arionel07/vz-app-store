'use client'

import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
	BarChart3,
	Bell,
	ChevronRight,
	ClipboardList,
	Image,
	ListChecks,
	CalendarDays,
	Leaf,
	LayoutGrid,
	Monitor,
	Moon,
	MoreHorizontal,
	Plus,
	Search,
	Settings,
	Store,
	Sun,
	UsersRound,
	LoaderCircle,
	LogOut,
	Megaphone,
	BookOpen,
	ClipboardCheck,
} from 'lucide-react'
import { cn } from 'cn'
import { getBrowserCsrfToken } from '@/lib/auth-client'
import { shouldDismissAccountPopover } from '@/lib/account-menu-navigation'
import { useSessionUser } from '@/components/session-provider'

const navItems = [
	{ label: 'Обзор', icon: LayoutGrid, value: 'overview' },
	{ label: 'Аналитика', icon: BarChart3, value: 'analytics' },
	{ label: 'Сотрудники', icon: UsersRound, value: 'employees' },
	{ label: 'Магазины', icon: Store, value: 'stores' },
	{ label: 'Тесты', icon: ClipboardList, value: 'quizzes' },
	{ label: 'Результаты', icon: BarChart3, value: 'results' },
	{ label: 'Фотографии', icon: Image, value: 'photos' },
	{ label: 'Расписание', icon: CalendarDays, value: 'schedules' },
	{ label: 'Задания', icon: ListChecks, value: 'tasks' },
	{ label: 'Объявления', icon: Megaphone, value: 'announcements' },
	{ label: 'База знаний', icon: BookOpen, value: 'knowledge' },
	{ label: 'Операции', icon: ClipboardCheck, value: 'operations' },
]

export function ThemeSwitcher() {
	const { theme, setTheme } = useTheme()
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	return (
		<div className="theme-switcher" aria-label="Тема интерфейса">
			{[
				{ value: 'light', label: 'Светлая', icon: Sun },
				{ value: 'dark', label: 'Тёмная', icon: Moon },
				{ value: 'system', label: 'Системная', icon: Monitor },
			].map(({ value, label, icon: Icon }) => (
				<button key={value} type="button" aria-label={label} aria-pressed={mounted && theme === value} className={cn('theme-choice', mounted && theme === value && 'theme-choice-active')} onClick={() => setTheme(value)}>
					<Icon size={15} />
				</button>
			))}
		</div>
	)
}

const roleLabels = {
	admin: 'Администратор',
	manager: 'Менеджер',
	staff: 'Сотрудник',
} as const

function userInitials(firstName: string, lastName: string): string {
	return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
}

function AccountMenu() {
	const user = useSessionUser()
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [isLoggingOut, setIsLoggingOut] = useState(false)
	const wrapRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (!open) return
		function closeOnOutsidePointer(event: PointerEvent) {
			if (event.target instanceof Node && !wrapRef.current?.contains(event.target)) setOpen(false)
		}
		function closeOnKeyboardBoundary(event: KeyboardEvent) {
			const root = wrapRef.current
			const focusable = root ? Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')) : []
			const focusIndex = focusable.indexOf(document.activeElement as HTMLElement)
			if (!shouldDismissAccountPopover({ key: event.key, shiftKey: event.shiftKey, focusIndex, focusableCount: focusable.length })) return
			if (event.key === 'Escape') {
				event.preventDefault()
				triggerRef.current?.focus()
			}
			setOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer)
		document.addEventListener('keydown', closeOnKeyboardBoundary)
		return () => {
			document.removeEventListener('pointerdown', closeOnOutsidePointer)
			document.removeEventListener('keydown', closeOnKeyboardBoundary)
		}
	}, [open])

	async function handleLogout() {
		setIsLoggingOut(true)
		try {
			const csrfToken = getBrowserCsrfToken()
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				credentials: 'same-origin',
				headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
			})
			if (!response.ok && response.status !== 401) {
				toast.error('Не удалось завершить сеанс')
				return
			}
			router.replace('/login')
			router.refresh()
		} catch {
			toast.error('Сервис авторизации временно недоступен')
		} finally {
			setIsLoggingOut(false)
		}
	}

	return (
		<div ref={wrapRef} className="account-menu-wrap">
			<button ref={triggerRef} type="button" className="account-row" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="account-popover">
				<span className="account-avatar">{userInitials(user.firstName, user.lastName)}</span>
				<span className="account-copy"><strong>{user.firstName} {user.lastName}</strong><small>{user.email ?? roleLabels[user.role]}</small></span>
				<ChevronRight size={15} className={cn('account-chevron', open && 'account-chevron-open')} />
			</button>
			{open && <div id="account-popover" className="account-popover" role="region" aria-label="Меню пользователя"><div className="px-2 py-2 text-xs text-muted-foreground"><strong className="block text-foreground">{roleLabels[user.role]}</strong><span>{user.email ?? 'Email не указан'}</span></div><div className="account-theme" role="group" aria-label="Настройка темы"><span>Тема</span><ThemeSwitcher /></div><button type="button" className="account-logout" disabled={isLoggingOut} onClick={handleLogout}>{isLoggingOut ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}Выйти</button></div>}
		</div>
	)
}

export function AdminShell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const isOverview = pathname === '/' || pathname === '/design-system'
	const router = useRouter()
	const showSearchNotice = () => toast.info('Поиск скоро появится', { id: 'global-search-notice' })

	return (
		<div className="admin-shell">
			<aside className="sidebar">
				<div className="sidebar-brand"><Leaf size={17} strokeWidth={2.2} /><strong>Vizaje</strong><ChevronRight size={14} className="brand-chevron" /><button type="button" className="sidebar-search" aria-label="Поиск" onClick={showSearchNotice}><Search size={15} /></button><button type="button" className="sidebar-compose" aria-label="Создать" onClick={() => toast.info('Создание доступно в разделах «Сотрудники» и «Магазины»')}><Plus size={15} /></button></div>
				<nav className="sidebar-nav" aria-label="Основная навигация">
					<p className="sidebar-label">Рабочая область</p>
					{navItems.map(({ label, icon: Icon, value }) => {
						if (value === 'operations') {
							const active = pathname.startsWith('/operations')
							return <div key={value} className="nav-group"><button type="button" className={cn('nav-item', active && 'nav-item-active')} onClick={() => router.push('/operations/campaigns')}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-active-dot" />}</button>{active && <div className="nav-subitems">{[
								{ label: 'Кампании', path: '/operations/campaigns' }, { label: 'Выкладка', path: '/operations/merchandising' }, { label: 'Проблемы', path: '/operations/issues' }, { label: 'Заявки', path: '/operations/requests' },
							].map((item) => <button key={item.path} type="button" className={cn('nav-subitem', pathname === item.path && 'nav-subitem-active')} onClick={() => router.push(item.path)}>{item.label}</button>)}</div>}</div>
						}
						const path = value === 'overview' ? '/' : `/${value}`
						const active = value === 'overview' ? isOverview : pathname.startsWith(path)
						const implemented = value === 'overview' || value === 'analytics' || value === 'employees' || value === 'stores' || value === 'quizzes' || value === 'results' || value === 'photos' || value === 'schedules' || value === 'tasks' || value === 'announcements' || value === 'knowledge'
						return <button key={value} type="button" className={cn('nav-item', active && 'nav-item-active')} onClick={() => {
							if (implemented) router.push(path)
							else toast.info(`${label}: раздел будет доступен позже`)
						}}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-active-dot" />}</button>
					})}
				</nav>
				<div className="sidebar-bottom">
					<button type="button" className="nav-item" onClick={() => toast.info('Настройки будут доступны позже')}><Settings size={17} strokeWidth={1.8} /><span>Настройки</span></button>
					<div className="sidebar-rule" />
					<p className="sidebar-footnote">API подключён</p>
				</div>
			</aside>
			<main className="app-main">
				<div className="topbar"><button type="button" className="global-search" aria-label="Поиск сотрудников, магазинов и тестов" onClick={showSearchNotice}><Search size={15} /><span>Поиск сотрудников, магазинов, тестов...</span></button><div className="topbar-actions"><button type="button" className="icon-button notification-button" aria-label="Уведомления" onClick={() => toast.info('Новых уведомлений нет')}><Bell size={16} /><i className="notification-dot" /></button><AccountMenu /><button type="button" className="icon-button" aria-label="Дополнительные действия" onClick={() => toast.info('Сейчас доступен только демонстрационный режим')}><MoreHorizontal size={18} /></button></div></div>
				<div className="page-container">{children}</div>
			</main>
		</div>
	)
}
