import * as Crypto from 'expo-crypto'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { useLocalSearchParams } from 'expo-router'
import { Camera, CheckCircle2, Circle, ClipboardCheck, LoaderCircle, Send } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError, downloadTaskEvidence, getMyTask, startMyTask, submitMyTask, updateMyTaskChecklist, uploadTaskEvidence } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, Card, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { preparePhoto } from '../../src/photos/image-processing'
import { useAppTheme } from '../../src/theme'
import type { TaskResponse } from '@vizaje/contracts'
import { canEditTask, canSubmitTask } from '../../src/tasks/model'

function errorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.status === 0) return 'Нет соединения. Проверьте сеть и повторите попытку.'
		if (error.code === 'CHECKLIST_INCOMPLETE') return 'Сначала выполните обязательные пункты чеклиста.'
		if (error.code === 'EVIDENCE_REQUIRED') return 'Добавьте фото перед отправкой задания.'
		if (error.status === 409) return 'Задание уже изменилось. Обновляем актуальное состояние.'
		if (error.status === 401) return 'Сессия закончилась. Войдите снова.'
	}
	return 'Не удалось выполнить операцию. Попробуйте ещё раз.'
}

function dueLabel(value: string | null): string { return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Без срока' }

export default function TaskDetailScreen() {
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const params = useLocalSearchParams<{ id: string }>()
	const taskId = Array.isArray(params.id) ? params.id[0] : params.id
	const [task, setTask] = useState<TaskResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [busyItem, setBusyItem] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [evidenceUri, setEvidenceUri] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!taskId) return
		setLoading(true); setNotice(null)
		try { setTask(await requestAuthenticated((token) => getMyTask(token, taskId))) } catch (reason) { setNotice(errorMessage(reason)) } finally { setLoading(false) }
	}, [requestAuthenticated, taskId])
	useEffect(() => { void load() }, [load])

	const evidence = useMemo(() => task?.latestSubmission?.evidence[0] ?? task?.evidence[0] ?? null, [task])
	useEffect(() => {
		if (!evidence) { setEvidenceUri(null); return }
		let cancelled = false
		void requestAuthenticated((token) => downloadTaskEvidence(token, evidence)).then((uri) => { if (!cancelled) setEvidenceUri(uri) }).catch(() => undefined)
		return () => { cancelled = true }
	}, [evidence, requestAuthenticated])

	async function start() {
		if (!task || busy || !['assigned', 'rejected'].includes(task.status)) return
		setBusy(true); setNotice(null)
		try { setTask(await requestAuthenticated((token) => startMyTask(token, task.id), { retryUnauthorized: false })) } catch (reason) { setNotice(errorMessage(reason)) } finally { setBusy(false) }
	}

	async function toggle(item: TaskResponse['checklist'][number]) {
		if (!task || busyItem || !canEditTask(task.status)) return
		setBusyItem(item.id); setNotice(null)
		try { setTask(await requestAuthenticated((token) => updateMyTaskChecklist(token, task.id, item.id, { completed: !item.completed, note: item.note, expectedVersion: task.version }), { retryUnauthorized: false })) } catch (reason) { setNotice(errorMessage(reason)); if (reason instanceof ApiError && reason.status === 409) await load() } finally { setBusyItem(null) }
	}

	async function addEvidence() {
		if (!task || busy) return
		setNotice(null)
		const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(false)
		if (!permission.granted) { setNotice('Разрешите доступ к фотографиям в настройках устройства.'); return }
		const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
		if (result.canceled || !result.assets[0]) return
		setBusy(true)
		try {
			const prepared = await preparePhoto(result.assets[0], `task-${Crypto.randomUUID()}`)
			await requestAuthenticated((token) => uploadTaskEvidence(token, task.id, { uri: prepared.uri, name: prepared.filename, type: prepared.mimeType }, Crypto.randomUUID()), { retryUnauthorized: false })
			setTask(await requestAuthenticated((token) => getMyTask(token, task.id)))
		} catch (reason) { setNotice(errorMessage(reason)) } finally { setBusy(false) }
	}

	async function submit() {
		if (!task || busy || !canSubmitTask(task.status)) return
		setBusy(true); setNotice(null)
		try { setTask(await requestAuthenticated((token) => submitMyTask(token, task.id, { completionNote: null, expectedVersion: task.version }, Crypto.randomUUID()), { retryUnauthorized: false })); setNotice('Задание отправлено.') } catch (reason) { setNotice(errorMessage(reason)); if (reason instanceof ApiError && reason.status === 409) await load() } finally { setBusy(false) }
	}

	return <Screen><ScreenHeader title="Задание" back backFallback="/tasks" />
		{loading ? <InlineMessage title="Загрузка задания" body="Получаем чеклист и актуальный статус." /> : !task ? <InlineMessage title="Задание недоступно" body={notice ?? 'Задание не найдено.'} actionLabel="Повторить" onAction={() => void load()} /> : <View style={styles.content}><View style={styles.heading}><Text style={[styles.title, { color: colors.text }]}>{task.title}</Text><Text style={[styles.meta, { color: colors.muted }]}>{task.storeName} · {task.category}</Text><Text style={[styles.meta, { color: task.overdue ? colors.danger : colors.muted }]}>{task.overdue ? 'Просрочено · ' : 'Срок: '}{dueLabel(task.dueAt)}</Text></View>{notice && <InlineMessage title="Статус задания" body={notice} />}{task.description && <Card><Text style={[styles.body, { color: colors.text }]}>{task.description}</Text></Card>}{task.status === 'assigned' || task.status === 'rejected' ? <ActionButton label={task.status === 'rejected' ? 'Исправить задание' : 'Начать задание'} icon={ClipboardCheck} onPress={() => void start()} disabled={busy} /> : null}<Card><Text style={[styles.sectionTitle, { color: colors.text }]}>Чеклист</Text>{task.checklist.length === 0 ? <Text style={[styles.body, { color: colors.muted }]}>Пунктов нет.</Text> : <View style={styles.checklist}>{task.checklist.map((item) => <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: item.completed, disabled: !['in_progress', 'rejected'].includes(task.status) }} onPress={() => void toggle(item)} style={styles.checkRow}><View>{busyItem === item.id ? <ActivityIndicator color={colors.accent} /> : item.completed ? <CheckCircle2 color={colors.success} size={24} /> : <Circle color={colors.muted} size={24} />}</View><Text style={[styles.checkLabel, { color: colors.text }]}>{item.label}{item.isRequired ? ' · обязательно' : ''}</Text></Pressable>)}</View>}</Card>{evidenceUri && <Image source={evidenceUri} contentFit="cover" style={styles.evidenceImage} />}{task.status === 'in_progress' || task.status === 'rejected' ? <><ActionButton label={busy ? 'Обработка…' : 'Добавить фото'} icon={busy ? LoaderCircle : Camera} variant="secondary" onPress={() => void addEvidence()} disabled={busy} /><ActionButton label="Отправить на проверку" icon={Send} onPress={() => void submit()} disabled={busy} /></> : task.status === 'submitted' ? <InlineMessage title="На проверке" body="Менеджер увидит чеклист и приложенные фото." /> : task.status === 'checked' ? <InlineMessage title="Задание проверено" body="Изменения по этому заданию больше не требуются." /> : null}</View>}
	</Screen>
}

const styles = StyleSheet.create({ content: { gap: 16 }, heading: { gap: 6 }, title: { fontSize: 27, fontWeight: '600', letterSpacing: -0.6 }, meta: { fontSize: 14, lineHeight: 20 }, body: { fontSize: 16, lineHeight: 23 }, sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 14 }, checklist: { gap: 14 }, checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, checkLabel: { flex: 1, fontSize: 16, lineHeight: 22 }, evidenceImage: { width: '100%', height: 220, borderRadius: 18 } })
