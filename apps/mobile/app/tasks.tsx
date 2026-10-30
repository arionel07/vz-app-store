import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { ClipboardCheck, RefreshCw } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError, listMyTasks } from '../src/api/client'
import { useAuth } from '../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../src/components/ui'
import { useAppTheme } from '../src/theme'
import type { TaskResponse } from '@vizaje/contracts'
import { taskProgress } from '../src/tasks/model'

const statusLabels: Record<TaskResponse['status'], string> = { assigned: 'Назначено', in_progress: 'В работе', submitted: 'На проверке', checked: 'Проверено', rejected: 'Нужно исправить' }

function errorMessage(error: unknown): string {
	if (error instanceof ApiError && error.status === 0) return 'Нет соединения. Проверьте сеть и повторите попытку.'
	if (error instanceof ApiError && error.status === 401) return 'Сессия закончилась. Войдите снова.'
	return 'Не удалось загрузить задания. Попробуйте ещё раз.'
}

function dueLabel(value: string | null): string { return value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Без срока' }

export default function TasksScreen() {
	const { colors } = useAppTheme()
	const router = useRouter()
	const { requestAuthenticated } = useAuth()
	const [tasks, setTasks] = useState<TaskResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try { setTasks((await requestAuthenticated((token) => listMyTasks(token))).data) } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
	}, [requestAuthenticated])
	useEffect(() => { void load() }, [load])

	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Задания" back backFallback="/(tabs)" action={<Pressable accessibilityLabel="Обновить задания" onPress={() => void load()} hitSlop={10}><RefreshCw color={colors.muted} size={19} /></Pressable>} />
		{error && <InlineMessage title="Задания недоступны" body={error} actionLabel="Повторить" onAction={() => void load()} />}
		{loading && tasks.length === 0 ? <InlineMessage title="Загрузка заданий" body="Получаем актуальные назначения." /> : !error && tasks.length === 0 ? <EmptyState icon={ClipboardCheck} title="Заданий пока нет" body="Новые назначения появятся здесь после публикации менеджером." /> : <View style={styles.list}>{tasks.map((task) => { const progress = taskProgress(task); return <Pressable key={task.id} accessibilityRole="button" onPress={() => router.push(`/task/${task.id}`)}><Card style={styles.card}><View style={styles.cardHeader}><Text style={[styles.title, { color: colors.text }]}>{task.title}</Text><Text style={[styles.status, { color: task.status === 'rejected' ? colors.danger : task.status === 'checked' ? colors.success : colors.accent }]}>{statusLabels[task.status]}</Text></View><Text style={[styles.meta, { color: colors.muted }]}>{task.storeName} · {task.category}</Text><Text style={[styles.meta, { color: task.overdue ? colors.danger : colors.muted }]}>{task.overdue ? 'Просрочено · ' : 'Срок: '}{dueLabel(task.dueAt)}</Text><Text style={[styles.progress, { color: colors.muted }]}>{progress.completed} из {progress.total} пунктов</Text></Card></Pressable> })}</View>}
	</Screen>
}

const styles = StyleSheet.create({ list: { gap: 12 }, card: { gap: 8 }, cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, title: { flex: 1, fontSize: 17, fontWeight: '600', lineHeight: 22 }, status: { fontSize: 13, fontWeight: '600' }, meta: { fontSize: 14, lineHeight: 20 }, progress: { fontSize: 13 } })
