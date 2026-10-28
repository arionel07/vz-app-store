import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from '../src/auth/auth-context'
import { SessionStatusScreen } from '../src/components/ui'
import { authRedirect } from '../src/navigation/safe-navigation'
import { AppThemeProvider, useAppTheme } from '../src/theme'

function ThemedStatusBar() {
	const { isDark } = useAppTheme()
	return <StatusBar style={isDark ? 'light' : 'dark'} />
}

function AuthGate({ children }: { children: ReactNode }) {
	const segments = useSegments()
	const navigation = useRouter()
	const { status, retryRestore } = useAuth()
	const protectedRoute = segments[0] === '(tabs)' || segments[0] === 'profile'
	const activationRoute = segments[0] === 'activation' || segments[0] === 'activate'
	const redirect = authRedirect(status, segments[0])

	useEffect(() => {
		if (redirect) navigation.replace(redirect)
	}, [navigation, redirect])

	if (status === 'loading') return <SessionStatusScreen title="Проверяем доступ" body="Подготавливаем защищённую сессию." loading />
	if (status === 'offline') return <SessionStatusScreen title="Нет соединения" body="Сохранённая сессия не потеряна. Подключитесь к сети и повторите проверку." actionLabel="Повторить" onAction={() => void retryRestore()} />
	if (status === 'storage-error') return <SessionStatusScreen title="Не удалось открыть сессию" body="Защищённое хранилище устройства временно недоступно. Повторите попытку." actionLabel="Повторить" onAction={() => void retryRestore()} />
	if (!segments[0]) return <SessionStatusScreen title="Открываем приложение" body="Проверяем доступ к рабочим разделам." loading />
	if (status === 'unauthenticated' && protectedRoute) return <SessionStatusScreen title="Открываем активацию" body="Перенаправляем на экран подключения." loading />
	if (status === 'authenticated' && activationRoute) return <SessionStatusScreen title="Сессия активна" body="Открываем рабочий экран." loading />
	return <>{children}</>
}

export default function RootLayout() {
	return <SafeAreaProvider><AppThemeProvider><AuthProvider>
		<ThemedStatusBar />
		<AuthGate><Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
			<Stack.Screen name="(tabs)" />
			<Stack.Screen name="profile" />
			<Stack.Screen name="activation" />
			<Stack.Screen name="activate" />
			<Stack.Screen name="quiz/[id]" />
			<Stack.Screen name="quiz/[id]/attempt" />
			<Stack.Screen name="attempt/[attemptId]" />
		</Stack></AuthGate>
	</AuthProvider></AppThemeProvider></SafeAreaProvider>
}
