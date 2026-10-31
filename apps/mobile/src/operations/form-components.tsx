import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '../theme'

export function ChoiceChips<T extends string>({ label, value, options, onChange, disabled = false }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; disabled?: boolean }) {
	const { colors } = useAppTheme()
	return <View style={styles.choiceGroup}><Text style={[styles.label, { color: colors.text }]}>{label}</Text><View style={styles.chips}>{options.map(([option, title]) => <Pressable key={option} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: option === value, disabled }} onPress={() => onChange(option)} style={[styles.chip, { borderColor: option === value ? colors.accent : colors.border, backgroundColor: option === value ? colors.accentSoft : colors.surface, opacity: disabled ? 0.6 : 1 }]}><Text style={[styles.chipText, { color: option === value ? colors.accent : colors.text }]}>{title}</Text></Pressable>)}</View></View>
}

const styles = StyleSheet.create({ choiceGroup: { gap: 9 }, label: { fontSize: 15, fontWeight: '600' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14 }, chipText: { fontSize: 14, fontWeight: '600' } })
