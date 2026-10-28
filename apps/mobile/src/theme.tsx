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
	background: '#F6F6F3',
	surface: '#FFFFFF',
	surfaceRaised: '#F0F0EC',
	text: '#171717',
	muted: '#6D6D68',
	border: '#E4E4DF',
	accent: '#171717',
	accentSoft: '#EAEAE5',
	success: '#2F7D55',
	warning: '#A86D19',
	danger: '#B64B4B',
	onAccent: '#FFFFFF',
}

const darkColors: ThemeColors = {
	background: '#111110',
	surface: '#1A1A18',
	surfaceRaised: '#242421',
	text: '#F7F7F2',
	muted: '#A4A49C',
	border: '#343431',
	accent: '#F7F7F2',
	accentSoft: '#30302C',
	success: '#73C296',
	warning: '#D9A957',
	danger: '#E18484',
	onAccent: '#171717',
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
