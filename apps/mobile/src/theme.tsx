import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { useColorScheme } from 'react-native'

export type ThemeMode = 'system' | 'light' | 'dark'

export type ThemeColors = {
	background: string
	surface: string
	surfaceRaised: string
	text: string
	muted: string
	border: string
	accent: string
	accentSoft: string
	success: string
	warning: string
	danger: string
	onAccent: string
}

const lightColors: ThemeColors = {
	background: '#FFFFFF',
	surface: '#FFFFFF',
	surfaceRaised: '#F2F2F2',
	text: '#1D1D1F',
	muted: '#86868B',
	border: '#E5E5EA',
	accent: '#007AFF',
	accentSoft: '#EAF3FF',
	success: '#248A3D',
	warning: '#9A6700',
	danger: '#D70015',
	onAccent: '#FFFFFF',
}

const darkColors: ThemeColors = {
	background: '#000000',
	surface: '#1C1C1E',
	surfaceRaised: '#2C2C2E',
	text: '#F5F5F7',
	muted: '#98989D',
	border: '#38383A',
	accent: '#0A84FF',
	accentSoft: '#152D47',
	success: '#30D158',
	warning: '#FF9F0A',
	danger: '#FF453A',
	onAccent: '#FFFFFF',
}

type ThemeContextValue = { colors: ThemeColors; mode: ThemeMode; isDark: boolean; setMode: (mode: ThemeMode) => void }
const ThemeContext = createContext<ThemeContextValue | null>(null)

export function AppThemeProvider({ children }: PropsWithChildren) {
	const systemScheme = useColorScheme()
	const [mode, setMode] = useState<ThemeMode>('system')
	const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark')
	const value = useMemo(() => ({ colors: isDark ? darkColors : lightColors, mode, isDark, setMode }), [isDark, mode])
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useAppTheme(): ThemeContextValue {
	const value = useContext(ThemeContext)
	if (!value) throw new Error('useAppTheme must be used inside AppThemeProvider')
	return value
}
