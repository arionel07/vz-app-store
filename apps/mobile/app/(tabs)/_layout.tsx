import { Tabs } from 'expo-router'
import { ClipboardList, Home, Image } from 'lucide-react-native'
import { useAppTheme } from '../../src/theme'

export default function TabsLayout() {
	const { colors } = useAppTheme()
	return <Tabs screenOptions={{
		headerShown: false,
		tabBarActiveTintColor: colors.accent,
		tabBarInactiveTintColor: colors.muted,
		tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 72, paddingTop: 8 },
		tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
	}}>
		<Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={2} /> }} />
		<Tabs.Screen name="quizzes" options={{ title: 'Тесты', tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} strokeWidth={2} /> }} />
		<Tabs.Screen name="photos" options={{ title: 'Фото', tabBarIcon: ({ color, size }) => <Image color={color} size={size} strokeWidth={2} /> }} />
	</Tabs>
}
