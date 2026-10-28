import { ClipboardList, Inbox } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { DemoState, EmptyState, Screen, ScreenHeader, SectionTitle } from '../../src/components/ui'
import { useAppTheme } from '../../src/theme'

export default function QuizzesScreen() {
	const { colors } = useAppTheme()
	return <Screen>
		<ScreenHeader title="Тесты" subtitle="Проверяйте знания о продуктах и сервисе." />
		<SectionTitle>Доступные тесты</SectionTitle>
		<View style={styles.stack}><DemoState loading title="Пример состояния загрузки" body="После подключения API здесь появится состояние загрузки списка." /><EmptyState icon={Inbox} title="Пока нет доступных тестов" body="Список тестов будет загружен после подключения мобильной авторизации и API." /></View>
		<View style={[styles.note, { backgroundColor: colors.surfaceRaised }]}><ClipboardList color={colors.muted} size={18} /><View style={styles.noteCopy}><View><SectionTitle>Как это будет работать</SectionTitle></View><View><DemoState title="Демонстрационный сценарий" body="Выберите тест, ответьте на вопросы и сразу увидите результат." /></View></View></View>
	</Screen>
}

const styles = StyleSheet.create({
	stack: { gap: 12 },
	note: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderRadius: 16, padding: 16 },
	noteCopy: { flex: 1, gap: 11 },
})
