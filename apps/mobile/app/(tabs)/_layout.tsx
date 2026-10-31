import { Tabs } from 'expo-router'
import { ClipboardList, Home, Image, UserRound } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppTheme } from '../../src/theme'

export default function TabsLayout() {
	const { colors } = useAppTheme()
	const insets = useSafeAreaInsets()
	return <Tabs screenOptions={{
		headerShown: false,
		tabBarActiveTintColor: colors.text,
		tabBarInactiveTintColor: colors.muted,
		tabBarActiveBackgroundColor: colors.surfaceRaised,
		tabBarHideOnKeyboard: true,
		tabBarStyle: { backgroundColor: colors.surface, borderTopWidth: 0, height: 72, marginHorizontal: 18, marginBottom: Math.max(8, insets.bottom), borderRadius: 40, paddingTop: 7, paddingBottom: 5, shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
		tabBarItemStyle: { marginVertical: 4, marginHorizontal: 3, borderRadius: 36 },
		tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
	}}>
		<Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={2} /> }} />
		<Tabs.Screen name="quizzes" options={{ title: 'Тесты', tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} strokeWidth={2} /> }} />
		<Tabs.Screen name="photos" options={{ title: 'Фото', tabBarIcon: ({ color, size }) => <Image color={color} size={size} strokeWidth={2} /> }} />
		<Tabs.Screen
			name="profile"
			options={{ title: 'Профиль', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} strokeWidth={2} /> }}
		/>
	</Tabs>
}
