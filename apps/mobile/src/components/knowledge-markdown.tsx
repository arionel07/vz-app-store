import { Fragment, useMemo } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '../theme'

function renderInline(value: string, color: string, linkColor: string) {
	const parts = value.split(/(\*\*[^*]+\*\*|\*[^*]+\*|https:\/\/[^\s)]+)/g)
	return parts.map((part, index) => {
		if (part.startsWith('**') && part.endsWith('**')) return <Text key={index} style={{ fontWeight: '700' }}>{part.slice(2, -2)}</Text>
		if (part.startsWith('*') && part.endsWith('*')) return <Text key={index} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Text>
		if (part.startsWith('https://')) return <Text key={index} accessibilityRole="link" onPress={() => void Linking.openURL(part)} style={{ color: linkColor }}>{part}</Text>
		return <Fragment key={index}>{part}</Fragment>
	})
}

export function KnowledgeMarkdown({ value }: { value: string }) {
	const { colors } = useAppTheme()
	const lines = useMemo(() => value.split(/\r?\n/), [value])
	return <View style={styles.root}>{lines.map((line, index) => {
		if (!line.trim()) return <View key={index} style={styles.blank} />
		if (line.startsWith('# ')) return <Text key={index} style={[styles.h1, { color: colors.text }]}>{renderInline(line.slice(2), colors.text, colors.accent)}</Text>
		if (line.startsWith('## ')) return <Text key={index} style={[styles.h2, { color: colors.text }]}>{renderInline(line.slice(3), colors.text, colors.accent)}</Text>
		if (line.startsWith('- ')) return <View key={index} style={styles.listItem}><Text style={[styles.bullet, { color: colors.accent }]}>•</Text><Text style={[styles.body, { color: colors.text }]}>{renderInline(line.slice(2), colors.text, colors.accent)}</Text></View>
		return <Text key={index} style={[styles.body, { color: colors.text }]}>{renderInline(line, colors.text, colors.accent)}</Text>
	})}</View>
}

const styles = StyleSheet.create({ root: { gap: 2 }, blank: { height: 8 }, h1: { fontSize: 24, lineHeight: 31, fontWeight: '700', marginBottom: 6 }, h2: { fontSize: 19, lineHeight: 26, fontWeight: '700', marginTop: 8, marginBottom: 4 }, listItem: { flexDirection: 'row', gap: 8, paddingLeft: 2 }, bullet: { fontSize: 18, lineHeight: 24 }, body: { flex: 1, fontSize: 16, lineHeight: 24 } })
