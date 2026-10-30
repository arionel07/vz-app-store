'use client'

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Archive, BookOpen, Check, Edit3, FileText, History, LoaderCircle, Paperclip, Plus, RefreshCw, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
	knowledgeAcknowledgmentListResponseSchema,
	knowledgeAdminArticleResponseSchema,
	knowledgeAdminListResponseSchema,
	knowledgeArticleCreateSchema,
	knowledgeAttachmentResponseSchema,
	knowledgeCategoryListResponseSchema,
	knowledgeCategoryCreateSchema,
	knowledgeCategoryResponseSchema,
	knowledgeCategoryUpdateSchema,
	knowledgeRevisionListResponseSchema,
	quizListResponseSchema,
	storeListResponseSchema,
	type KnowledgeAdminArticleResponse,
	type KnowledgeVisibilityTarget,
	type KnowledgeCategoryResponse,
	type StoreResponse,
} from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSessionUser } from '@/components/session-provider'
import { ManagementError, managementFetch, managementFetchNoContent } from '@/lib/management-client'
import { MarkdownPreview } from '@/components/markdown-preview'

const statusLabels = { draft: 'Черновик', published: 'Опубликовано', archived: 'Архив' } as const
type TargetMode = 'all' | 'stores' | 'role'
type FormState = { categoryId: string; title: string; summary: string; body: string; mode: TargetMode; storeIds: string[]; role: 'staff' | 'manager'; required: boolean; quizIds: string[] }

function emptyForm(categoryId = ''): FormState { return { categoryId, title: '', summary: '', body: '', mode: 'stores', storeIds: [], role: 'staff', required: false, quizIds: [] } }
function errorText(error: unknown): string { if (error instanceof ManagementError && error.status === 403) return 'Недостаточно прав или материал находится вне вашей области'; if (error instanceof ManagementError && error.status >= 500) return 'Сервис базы знаний временно недоступен'; return 'Не удалось выполнить операцию' }
function targetsForForm(form: FormState): KnowledgeVisibilityTarget[] { if (form.mode === 'all') return [{ kind: 'all' }]; if (form.mode === 'role') return [{ kind: 'role', role: form.role, ...(form.storeIds.length ? { storeId: form.storeIds[0] } : {}) }]; return form.storeIds.map((storeId) => ({ kind: 'store' as const, storeId })) }
function formFromArticle(article: KnowledgeAdminArticleResponse): FormState {
	const revision = article.draft ?? article.published
	const target = article.visibilityTargets[0]
	const storeIds = article.visibilityTargets.flatMap((item) => {
		if (item.kind === 'store') return [item.storeId]
		if (item.kind === 'role' && item.storeId) return [item.storeId]
		return []
	})
	return { categoryId: article.category.id, title: revision?.title ?? '', summary: revision?.summary ?? '', body: revision?.body ?? '', mode: target?.kind === 'all' ? 'all' : target?.kind === 'role' ? 'role' : 'stores', storeIds, role: target?.kind === 'role' ? target.role : 'staff', required: article.requiresAcknowledgement, quizIds: revision?.quizIds ?? [] }
}

export function KnowledgePage() {
	const user = useSessionUser()
	const [items, setItems] = useState<KnowledgeAdminArticleResponse[]>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [categories, setCategories] = useState<KnowledgeCategoryResponse[]>([])
	const [quizzes, setQuizzes] = useState<Array<{ id: string; title: string }>>([])
	const [selected, setSelected] = useState<KnowledgeAdminArticleResponse | null>(null)
	const [form, setForm] = useState<FormState>(emptyForm())
	const [editing, setEditing] = useState(false)
	const [search, setSearch] = useState('')
	const [status, setStatus] = useState<'all' | 'draft' | 'published' | 'archived'>('all')
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [revisions, setRevisions] = useState<Array<{ id: string; revisionNumber: number; status: string; createdAt: string }>>([])
	const [ackCount, setAckCount] = useState(0)
	const [categoryDialog, setCategoryDialog] = useState(false)
	const [categoryEditing, setCategoryEditing] = useState<KnowledgeCategoryResponse | null>(null)
	const [categoryName, setCategoryName] = useState('')
	const [categorySlug, setCategorySlug] = useState('')
	const [categorySaving, setCategorySaving] = useState(false)

	const loadArticles = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const query = new URLSearchParams({ page: '1', pageSize: '50' }); if (search.trim()) query.set('search', search.trim()); if (status !== 'all') query.set('status', status)
			const result = await managementFetch(`/api/admin/knowledge/articles?${query}`, knowledgeAdminListResponseSchema)
			setItems(result.data); setSelected((current) => current ? result.data.find((item) => item.id === current.id) ?? null : result.data[0] ?? null)
		} catch (requestError) { if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login'); else setError(errorText(requestError)) } finally { setLoading(false) }
	}, [search, status])

	useEffect(() => { void Promise.all([
		managementFetch('/api/admin/knowledge/categories', knowledgeCategoryListResponseSchema),
		managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema),
		managementFetch('/api/admin/quizzes?page=1&pageSize=100&status=published', quizListResponseSchema),
	]).then(([categoryList, storeList, quizList]) => { setCategories(categoryList.data); setStores(storeList.data); setQuizzes(quizList.data.map((quiz) => ({ id: quiz.id, title: quiz.title }))) }).catch((requestError) => setError(errorText(requestError))) }, [])
	useEffect(() => { void loadArticles() }, [loadArticles])
	useEffect(() => {
		if (!selected) { setRevisions([]); setAckCount(0); return }
		void Promise.all([
			managementFetch(`/api/admin/knowledge/articles/${selected.id}/revisions`, knowledgeRevisionListResponseSchema),
			managementFetch(`/api/admin/knowledge/articles/${selected.id}/acknowledgments`, knowledgeAcknowledgmentListResponseSchema),
		]).then(([history, acknowledgments]) => { setRevisions(history.data.map((item) => ({ id: item.id, revisionNumber: item.revisionNumber, status: item.status, createdAt: item.createdAt }))); setAckCount(acknowledgments.data.length) }).catch(() => undefined)
	}, [selected])

	function openCreate() { setSelected(null); setForm(emptyForm(categories[0]?.id ?? '')); setEditing(true) }
	function openCategoryCreate() { setCategoryEditing(null); setCategoryName(''); setCategorySlug(''); setCategoryDialog(true) }
	function openCategoryEdit(category: KnowledgeCategoryResponse) { setCategoryEditing(category); setCategoryName(category.name); setCategorySlug(category.slug); setCategoryDialog(true) }
	async function saveCategory(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setCategorySaving(true)
		try {
			const input = categoryEditing ? knowledgeCategoryUpdateSchema.parse({ name: categoryName, slug: categorySlug }) : knowledgeCategoryCreateSchema.parse({ name: categoryName, slug: categorySlug, sortOrder: categories.length * 10 })
			if (categoryEditing) await managementFetch(`/api/admin/knowledge/categories/${categoryEditing.id}`, knowledgeCategoryResponseSchema, { method: 'PATCH', body: JSON.stringify(input) })
			else await managementFetch('/api/admin/knowledge/categories', knowledgeCategoryResponseSchema, { method: 'POST', body: JSON.stringify(input) })
			const next = await managementFetch('/api/admin/knowledge/categories', knowledgeCategoryListResponseSchema); setCategories(next.data); setCategoryDialog(false); toast.success(categoryEditing ? 'Категория обновлена' : 'Категория создана')
		} catch (requestError) { toast.error(requestError instanceof Error && requestError.message.includes('slug') ? 'Проверьте slug категории' : errorText(requestError)) } finally { setCategorySaving(false) }
	}
	function openEdit(article: KnowledgeAdminArticleResponse) { setSelected(article); setForm(formFromArticle(article)); setEditing(true) }
	function toggleStore(storeId: string) { setForm((current) => ({ ...current, storeIds: current.storeIds.includes(storeId) ? current.storeIds.filter((id) => id !== storeId) : [...current.storeIds, storeId] })) }
	function toggleQuiz(quizId: string) { setForm((current) => ({ ...current, quizIds: current.quizIds.includes(quizId) ? current.quizIds.filter((id) => id !== quizId) : [...current.quizIds, quizId] })) }

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setSaving(true)
		try {
			const parsed = knowledgeArticleCreateSchema.safeParse({ categoryId: form.categoryId, title: form.title, summary: form.summary || null, body: form.body, visibilityTargets: targetsForForm(form), requiresAcknowledgement: form.required, quizIds: form.quizIds })
			if (!parsed.success) throw new Error('FORM')
			const next = selected ? await managementFetch(`/api/admin/knowledge/articles/${selected.id}`, knowledgeAdminArticleResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed.data) }) : await managementFetch('/api/admin/knowledge/articles', knowledgeAdminArticleResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) })
			setSelected(next); setEditing(false); await loadArticles(); toast.success(selected ? 'Черновик обновлён' : 'Материал создан')
		} catch (requestError) { toast.error(requestError instanceof Error && requestError.message === 'FORM' ? 'Заполните категорию, заголовок, текст и область видимости' : errorText(requestError)) } finally { setSaving(false) }
	}

	async function publish() { if (!selected || selected.status !== 'draft' || !window.confirm('Опубликовать материал? Сотрудники увидят новую версию сразу.')) return; setSaving(true); try { const next = await managementFetch(`/api/admin/knowledge/articles/${selected.id}/publish`, knowledgeAdminArticleResponseSchema, { method: 'POST' }); setSelected(next); await loadArticles(); toast.success('Материал опубликован') } catch (requestError) { toast.error(errorText(requestError)) } finally { setSaving(false) } }
	async function archive() { if (!selected || selected.status === 'archived' || !window.confirm('Переместить материал в архив?')) return; setSaving(true); try { const next = await managementFetch(`/api/admin/knowledge/articles/${selected.id}/archive`, knowledgeAdminArticleResponseSchema, { method: 'POST' }); setSelected(next); await loadArticles(); toast.success('Материал архивирован') } catch (requestError) { toast.error(errorText(requestError)) } finally { setSaving(false) } }

	async function upload(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0]; event.target.value = ''; if (!file || !selected || !selected.draft) return
		const body = new FormData(); body.append('file', file); setSaving(true)
		try { await managementFetch(`/api/admin/knowledge/articles/${selected.id}/attachments`, knowledgeAttachmentResponseSchema, { method: 'POST', body }); const next = await managementFetch(`/api/admin/knowledge/articles/${selected.id}`, knowledgeAdminArticleResponseSchema); setSelected(next); toast.success('Файл добавлен в черновик') } catch (requestError) { toast.error(errorText(requestError)) } finally { setSaving(false) }
	}
	async function removeAttachment(id: string) { if (!selected || !window.confirm('Удалить вложение?')) return; try { await managementFetchNoContent(`/api/admin/knowledge/articles/${selected.id}/attachments/${id}`, { method: 'DELETE' }); const next = await managementFetch(`/api/admin/knowledge/articles/${selected.id}`, knowledgeAdminArticleResponseSchema); setSelected(next) } catch (requestError) { toast.error(errorText(requestError)) } }

	return <div className="management-page">
		<header className="management-toolbar"><div><p className="eyebrow">Рабочая область</p><h1 className="page-title">База знаний</h1><p className="page-subtitle">Версионируемые внутренние материалы с областью доступа и подтверждением</p></div><div className="management-toolbar-actions"><Button variant="outline" size="sm" onClick={() => void loadArticles()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button>{user.role === 'admin' && <Button variant="outline" size="sm" onClick={openCategoryCreate}><Plus size={14} />Категории</Button>}<Button size="sm" onClick={openCreate}><Plus size={14} />Новый материал</Button></div></header>
		<div className="management-filters"><label className="relative"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><Input className="pl-9" aria-label="Поиск материалов" placeholder="Поиск по заголовку и тексту" value={search} onChange={(event) => setSearch(event.target.value)} /></label><Select aria-label="Статус" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="published">Опубликованные</option><option value="archived">Архив</option></Select><span className="text-xs text-muted-foreground">{user.role === 'admin' ? 'Полный доступ' : 'Только материалы вашей области'}</span></div>
		{error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => void loadArticles()}>Повторить</button></div>}
		<div className="management-grid mt-3"><section className="management-surface" aria-label="Материалы базы знаний">{loading ? <div className="management-state"><LoaderCircle className="mx-auto animate-spin" /><p>Загружаем материалы…</p></div> : items.length === 0 ? <div className="management-state"><BookOpen className="mx-auto text-muted-foreground" /><strong>Материалов нет</strong><p>Создайте первый материал базы знаний.</p></div> : <table className="management-table"><thead><tr><th>Материал</th><th>Статус</th><th>Подтверждения</th><th>Изменено</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id} aria-selected={selected?.id === item.id} onClick={() => setSelected(item)}><td><div className="employee-name-cell"><span className="store-symbol"><BookOpen size={15} /></span><div><strong>{item.draft?.title ?? item.published?.title}</strong><small>{item.category.name} · {item.draft?.summary ?? item.published?.summary ?? 'Без описания'}</small></div></div></td><td><Badge tone={item.status === 'published' ? 'green' : item.status === 'archived' ? 'danger' : 'blue'}>{statusLabels[item.status]}</Badge></td><td>{item.metrics.acknowledgedCount} / {item.metrics.eligibleCount}</td><td className="cell-muted">{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td><td className="actions-cell">{item.status !== 'published' && <button type="button" className="row-more" aria-label="Изменить материал" onClick={(event) => { event.stopPropagation(); openEdit(item) }}><Edit3 size={15} /></button>}</td></tr>)}</tbody></table>}</section>
			<aside className="management-surface management-inspector" aria-label="Карточка материала">{!selected ? <div className="management-state"><BookOpen className="mx-auto text-muted-foreground" /><p>Выберите материал.</p></div> : <><div className="panel-header"><div><p className="eyebrow">Карточка</p><h2 className="panel-title">{selected.draft?.title ?? selected.published?.title}</h2><p className="panel-description">{statusLabels[selected.status]} · {selected.category.name}</p></div>{selected.status !== 'published' && <Button variant="ghost" size="icon-sm" aria-label="Редактировать" onClick={() => openEdit(selected)}><Edit3 /></Button>}</div><div className="panel-content"><p className="whitespace-pre-wrap text-sm leading-6">{selected.draft?.summary ?? selected.published?.summary ?? 'Описание не добавлено'}</p><dl className="management-meta"><div><dt>Область</dt><dd>{selected.visibilityTargets.some((target) => target.kind === 'all') ? 'Все сотрудники' : `${selected.visibilityTargets.length} целей`}</dd></div><div><dt>Версия</dt><dd>{selected.draft?.revisionNumber ?? selected.published?.revisionNumber ?? '—'}</dd></div><div><dt>Подтвердили</dt><dd>{ackCount} из {selected.metrics.eligibleCount}</dd></div><div><dt>Вложений</dt><dd>{selected.draft?.attachments.length ?? selected.published?.attachments.length ?? 0}</dd></div></dl><div className="management-actions">{selected.status === 'draft' && <Button disabled={saving} onClick={() => void publish()}><Check size={14} />Опубликовать</Button>}{selected.status === 'published' && <Button variant="outline" disabled={saving} onClick={() => void archive()}><Archive size={14} />В архив</Button>}<Button variant="ghost" size="sm" onClick={() => openEdit(selected)}>Изменить</Button></div><div className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-semibold">История версий</h3><div className="mt-2 space-y-1 text-xs text-muted-foreground">{revisions.map((revision) => <p key={revision.id}><History size={12} className="mr-1 inline" />v{revision.revisionNumber} · {statusLabels[revision.status as keyof typeof statusLabels] ?? revision.status} · {new Date(revision.createdAt).toLocaleDateString('ru-RU')}</p>)}</div></div><div className="mt-4"><h3 className="text-sm font-semibold">Вложения черновика</h3>{selected.draft?.attachments.map((attachment) => <div className="mt-2 flex items-center justify-between text-xs" key={attachment.id}><span><Paperclip size={12} className="mr-1 inline" />{attachment.originalFilename}</span><button type="button" className="text-destructive" onClick={() => void removeAttachment(attachment.id)}>Удалить</button></div>)}{selected.status === 'draft' && <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><Upload size={13} />Добавить PDF или изображение<input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={upload} disabled={saving} /></label>}</div></div></>}</aside></div>
		{editing && <div className="dialog-layer" role="dialog" aria-modal="true"><form className="dialog-panel max-h-[90vh] overflow-auto" onSubmit={save}><div className="dialog-header"><strong>{selected ? 'Изменить материал' : 'Новый материал'}</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setEditing(false)}>×</button></div><div className="dialog-body form-stack"><label>Категория<Select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Выберите категорию</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label><label>Заголовок<Input autoFocus required maxLength={240} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Краткое описание<Input value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label><label>Текст в Markdown<Textarea required className="min-h-52 font-mono text-xs" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label><div className="rounded-lg border border-border p-3"><p className="mb-2 text-xs font-semibold">Предпросмотр</p><MarkdownPreview value={form.body || 'Введите текст материала'} /></div><fieldset><legend className="form-label">Область доступа</legend><Select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as TargetMode, storeIds: event.target.value === 'all' ? [] : form.storeIds })}><option value="stores">Выбранные магазины</option>{user.role === 'admin' && <option value="all">Все сотрудники</option>}<option value="role">Роль в магазине</option></Select>{form.mode === 'role' && <Select className="mt-2" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'staff' | 'manager' })}><option value="staff">Сотрудники</option>{user.role === 'admin' && <option value="manager">Менеджеры</option>}</Select>}{form.mode !== 'all' && <div className="mt-2 max-h-28 overflow-auto">{stores.map((store) => <label className="store-check" key={store.id}><input type={form.mode === 'role' ? 'radio' : 'checkbox'} name={form.mode === 'role' ? 'target-store' : undefined} checked={form.storeIds.includes(store.id)} onChange={() => form.mode === 'role' ? setForm({ ...form, storeIds: [store.id] }) : toggleStore(store.id)} />{store.name}</label>)}</div>}<p className="role-note">Доступ проверяется API. Для выбранных магазинов укажите хотя бы один магазин.</p></fieldset><label className="store-check"><input type="checkbox" checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} /> Требовать подтверждение прочтения</label><fieldset><legend className="form-label">Связанные опубликованные тесты</legend><div className="max-h-28 overflow-auto">{quizzes.map((quiz) => <label className="store-check" key={quiz.id}><input type="checkbox" checked={form.quizIds.includes(quiz.id)} onChange={() => toggleQuiz(quiz.id)} />{quiz.title}</label>)}</div><p className="role-note">Тесты только дополняют материал и не меняются из базы знаний.</p></fieldset><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setEditing(false)}>Отмена</Button><Button type="submit" disabled={saving || !form.categoryId}>{saving && <LoaderCircle className="animate-spin" size={14} />}Сохранить черновик</Button></div></div></form></div>}
		{categoryDialog && <div className="dialog-layer" role="dialog" aria-modal="true"><form className="dialog-panel" onSubmit={saveCategory}><div className="dialog-header"><strong>{categoryEditing ? 'Изменить категорию' : 'Категории'}</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setCategoryDialog(false)}>×</button></div><div className="dialog-body form-stack"><div className="max-h-48 overflow-auto">{categories.map((category) => <div className="flex items-center justify-between border-b border-border py-2 text-sm" key={category.id}><span>{category.name}</span><Button type="button" variant="ghost" size="xs" onClick={() => openCategoryEdit(category)}>Изменить</Button></div>)}</div><label>Название<Input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></label><label>Slug<Input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)} /></label><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setCategoryDialog(false)}>Отмена</Button><Button type="submit" disabled={categorySaving}>{categorySaving && <LoaderCircle className="animate-spin" size={14} />}Сохранить</Button></div></div></form></div>}
	</div>
}
