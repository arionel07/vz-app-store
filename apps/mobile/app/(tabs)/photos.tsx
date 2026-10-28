import { useRouter } from 'expo-router'
import { Camera, Image as ImageIcon, Inbox } from 'lucide-react-native'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { ActionButton, EmptyState, Screen, ScreenHeader, SectionTitle } from '../../src/components/ui'
import { useAppTheme } from '../../src/theme'

export default function PhotosScreen() {
	const { colors } = useAppTheme()
	const router = useRouter()
	const placeholder = (title: string) => Alert.alert(title, 'Камера и галерея будут подключены в следующем milestone.')
	return <Screen>
		<ScreenHeader title="Фото" subtitle="Сохраняйте рабочие моменты магазина." />
		<View style={styles.actionGrid}><View style={styles.actionItem}><ActionButton label="Открыть камеру" icon={Camera} onPress={() => placeholder('Камера')} /><Text style={[styles.actionHint, { color: colors.muted }]}>Доступ к камере появится позже.</Text></View><View style={styles.actionItem}><ActionButton label="Выбрать фото" icon={ImageIcon} variant="secondary" onPress={() => placeholder('Галерея')} /><Text style={[styles.actionHint, { color: colors.muted }]}>Выбор из галереи появится позже.</Text></View></View>
		<View style={styles.historyHeader}><SectionTitle>История загрузок</SectionTitle><Text style={[styles.demoLabel, { color: colors.muted }]}>ДЕМО</Text></View>
		<EmptyState icon={Inbox} title="История пока пуста" body="Здесь появятся ваши фотографии после подключения загрузки и профиля сотрудника." />
		<View style={[styles.bottomNote, { borderTopColor: colors.border }]}><Text style={[styles.bottomNoteText, { color: colors.muted }]}>Фото будут доступны только в рамках назначенного магазина.</Text><ActionButton label="Открыть профиль" variant="quiet" onPress={() => router.push('/profile')} /></View>
	</Screen>
}

const styles = StyleSheet.create({
	actionGrid: { gap: 12 },
	actionItem: { gap: 7 },
	actionHint: { paddingHorizontal: 3, fontSize: 12, lineHeight: 17 },
	historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	demoLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
	bottomNote: { gap: 6, borderTopWidth: 1, paddingTop: 16 },
	bottomNoteText: { fontSize: 13, lineHeight: 18 },
})
