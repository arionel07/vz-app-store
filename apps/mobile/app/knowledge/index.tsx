import { useRouter } from 'expo-router'
import { BookOpen, CheckCircle2, Search } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError, listKnowledgeArticles, listKnowledgeCategories } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { useAppTheme } from '../../src/theme'
import type { KnowledgeArticleSummary } from '@vizaje/contracts'

function errorText(error: unknown): string { return error instanceof ApiError && error.status === 0 ? 'Нет соединения с сервером.' : 'Не удалось загрузить базу знаний.' }

export default function KnowledgeListScreen() {
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [items, setItems] = useState<KnowledgeArticleSummary[]>([])
	const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
	const [categoryId, setCategoryId] = useState<string | undefined>()
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const [categoryList, articles] = await Promise.all([
				requestAuthenticated((token) => listKnowledgeCategories(token)),
				requestAuthenticated((token) => listKnowledgeArticles(token, { page: 1, pageSize: 50, search: search.trim() || undefined, categoryId })),
			])
			setCategories(categoryList.data); setItems(articles.data)
		} catch (reason) { setError(errorText(reason)) } finally { setLoading(false) }
	}, [categoryId, requestAuthenticated, search])

	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="База знаний" back /><View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}><Search size={18} color={colors.muted} /><TextInput accessibilityLabel="Поиск материалов" placeholder="Поиск материалов" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} onSubmitEditing={() => void load()} returnKeyType="search" style={[styles.searchInput, { color: colors.text }]} /></View><View style={styles.categories}><Pressable onPress={() => setCategoryId(undefined)} style={[styles.chip, { backgroundColor: !categoryId ? colors.text : colors.surfaceRaised }]}><Text style={{ color: !categoryId ? colors.background : colors.text }}>Все</Text></Pressable>{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.chip, { backgroundColor: categoryId === category.id ? colors.text : colors.surfaceRaised }]}><Text style={{ color: categoryId === category.id ? colors.background : colors.text }}>{category.name}</Text></Pressable>)}</View>{error ? <InlineMessage title="Не удалось загрузить материалы" body={error} actionLabel="Повторить" onAction={() => void load()} /> : loading && !items.length ? <ActivityIndicator color={colors.text} /> : !items.length ? <EmptyState icon={BookOpen} title="Материалов пока нет" body="Опубликованные материалы появятся здесь после назначения вашей роли или магазина." /> : <View style={styles.list}>{items.map((item) => <Pressable key={item.id} onPress={() => router.push(`/knowledge/${item.id}`)} style={({ pressed }) => [styles.item, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}><View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><BookOpen color={colors.accent} size={20} /></View><View style={styles.copy}><View style={styles.meta}><Text style={[styles.category, { color: colors.accent }]}>{item.category.name}</Text>{item.requiresAcknowledgement && (item.acknowledgedAt ? <CheckCircle2 color={colors.success} size={16} /> : <Text style={[styles.required, { color: colors.danger }]}>Нужно подтвердить</Text>)}</View><Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>{item.summary && <Text numberOfLines={2} style={[styles.summary, { color: colors.muted }]}>{item.summary}</Text>}</View></Pressable>)}</View>}</Screen>
}

const styles = StyleSheet.create({ search: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 15 }, searchInput: { flex: 1, minHeight: 48, fontSize: 16 }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 40, justifyContent: 'center', borderRadius: 999, paddingHorizontal: 14 }, list: { gap: 10 }, item: { flexDirection: 'row', gap: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 15 }, icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 }, copy: { flex: 1, gap: 5 }, meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, category: { fontSize: 12, fontWeight: '700' }, required: { fontSize: 11, fontWeight: '600' }, title: { fontSize: 17, fontWeight: '600' }, summary: { fontSize: 14, lineHeight: 20 } })
