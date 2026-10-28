import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppThemeProvider, useAppTheme } from '../src/theme'

function ThemedStatusBar() {
	const { isDark } = useAppTheme()
	return <StatusBar style={isDark ? 'light' : 'dark'} />
}

export default function RootLayout() {
	return <SafeAreaProvider><AppThemeProvider>
		<ThemedStatusBar />
		<Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
			<Stack.Screen name="(tabs)" />
			<Stack.Screen name="profile" />
			<Stack.Screen name="activation" />
		</Stack>
	</AppThemeProvider></SafeAreaProvider>
}
