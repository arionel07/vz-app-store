import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { getMySchedule } from '../src/api/client'
import { useAuth } from '../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../src/components/ui'
import { useAppTheme } from '../src/theme'
import type { StaffScheduleResponse } from '@vizaje/contracts'

function today(): string { return new Date().toISOString().slice(0, 10) }
function addDays(value: string, amount: number): string { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10) }
function dayLabel(value: string): string { return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(new Date(`${value}T00:00:00Z`)).replace('.', '') }
function dateLabel(value: string): string { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00Z`)) }

export default function ScheduleScreen() {
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [weekStart, setWeekStart] = useState(() => addDays(today(), -new Date().getUTCDay() + 1))
	const [selectedDate, setSelectedDate] = useState(today())
	const [data, setData] = useState<StaffScheduleResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const week = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
	const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await requestAuthenticated((token) => getMySchedule(token, weekStart, addDays(weekStart, 6)))) } catch { setError('Не удалось загрузить расписание. Проверьте соединение и повторите попытку.') } finally { setLoading(false) } }, [requestAuthenticated, weekStart])
	useEffect(() => { void load() }, [load])
	const day = data?.days.find((item) => item.date === selectedDate)

	return <Screen><ScreenHeader title="Расписание" back backFallback="/(tabs)" /><View style={styles.week}>{week.map((date) => <Pressable key={date} accessibilityRole="button" accessibilityLabel={`Выбрать ${dateLabel(date)}`} onPress={() => setSelectedDate(date)} style={[styles.dayButton, { backgroundColor: selectedDate === date ? colors.accent : colors.surfaceRaised }]}><Text style={[styles.dayName, { color: selectedDate === date ? colors.onAccent : colors.muted }]}>{dayLabel(date)}</Text><Text style={[styles.dayNumber, { color: selectedDate === date ? colors.onAccent : colors.text }]}>{date.slice(-2)}</Text></Pressable>)}</View>{loading ? <InlineMessage title="Загрузка расписания" body="Получаем опубликованные смены." /> : error ? <InlineMessage title="Расписание недоступно" body={error} actionLabel="Повторить" onAction={() => void load()} /> : !data || !day || day.status === 'no_schedule' ? <EmptyState icon={CalendarDays} title="Расписания нет" body="На выбранную дату нет опубликованного расписания." /> : day.status === 'day_off' ? <Card><Text style={[styles.title, { color: colors.text }]}>Выходной</Text><Text style={[styles.body, { color: colors.muted }]}>На выбранную дату назначен выходной.</Text>{day.daysOff.map((item) => item.note ? <Text key={item.id} style={[styles.note, { color: colors.muted }]}>{item.note}</Text> : null)}</Card> : <View style={styles.content}><Text style={[styles.dateTitle, { color: colors.text }]}>{dateLabel(selectedDate)}</Text>{day.shifts.map((shift) => <Card key={shift.id} style={styles.shift}><View style={[styles.shiftIcon, { backgroundColor: colors.accentSoft }]}><Clock3 color={colors.accent} size={20} /></View><View style={styles.shiftCopy}><Text style={[styles.title, { color: colors.text }]}>{shift.startTime} — {shift.endTime}</Text><View style={styles.store}><MapPin color={colors.muted} size={14} /><Text style={[styles.body, { color: colors.muted }]}>{shift.storeName}</Text></View>{shift.note && <Text style={[styles.note, { color: colors.muted }]}>{shift.note}</Text>}</View></Card>)}</View>}</Screen>
}

const styles = StyleSheet.create({ week: { flexDirection: 'row', gap: 6 }, dayButton: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 10, gap: 4 }, dayName: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' }, dayNumber: { fontSize: 17, fontWeight: '700' }, content: { gap: 12 }, dateTitle: { fontSize: 18, fontWeight: '600' }, shift: { flexDirection: 'row', alignItems: 'center', gap: 13 }, shiftIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 }, shiftCopy: { flex: 1, gap: 5 }, title: { fontSize: 17, fontWeight: '600' }, body: { fontSize: 14, lineHeight: 20 }, store: { flexDirection: 'row', alignItems: 'center', gap: 5 }, note: { fontSize: 13, lineHeight: 19 } })
