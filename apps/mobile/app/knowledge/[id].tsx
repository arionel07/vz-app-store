import { useLocalSearchParams, useRouter } from 'expo-router'
import { Check, Download, FileText } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { acknowledgeKnowledgeArticle, ApiError, downloadKnowledgeAttachment, getKnowledgeArticle } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, Card, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { KnowledgeMarkdown } from '../../src/components/knowledge-markdown'
import { useAppTheme } from '../../src/theme'
import type { KnowledgeStaffArticleResponse } from '@vizaje/contracts'

export default function KnowledgeArticleScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [article, setArticle] = useState<KnowledgeStaffArticleResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [attachmentUris, setAttachmentUris] = useState<Record<string, string>>({})

	useEffect(() => { if (!id) return; void requestAuthenticated((token) => getKnowledgeArticle(token, id)).then(setArticle).catch((reason) => setNotice(reason instanceof ApiError && reason.status === 0 ? 'Нет соединения с сервером.' : 'Материал недоступен.')).finally(() => setLoading(false)) }, [id, requestAuthenticated])

	async function acknowledge() { if (!id || !article || busy) return; setBusy(true); try { await requestAuthenticated((token) => acknowledgeKnowledgeArticle(token, id)); setArticle({ ...article, acknowledgedAt: new Date().toISOString() }) } catch { setNotice('Не удалось сохранить подтверждение. Повторите попытку.') } finally { setBusy(false) } }
	async function openAttachment(attachment: KnowledgeStaffArticleResponse['attachments'][number]) { if (!id || busy) return; setBusy(true); try { const uri = await requestAuthenticated((token) => downloadKnowledgeAttachment(token, id, attachment)); setAttachmentUris((current) => ({ ...current, [attachment.id]: uri })); if (attachment.mimeType === 'application/pdf') await Linking.openURL(uri) } catch { setNotice('Не удалось открыть вложение. Повторите попытку.') } finally { setBusy(false) } }

	return <Screen><ScreenHeader title="Материал" back />{loading ? <ActivityIndicator color={colors.text} /> : notice && !article ? <InlineMessage title="Материал недоступен" body={notice} /> : !article ? <InlineMessage title="Материал не найден" body="Он мог быть архивирован или больше не назначен вашей области." /> : <View style={styles.content}><View style={styles.heading}><Text style={[styles.category, { color: colors.accent }]}>{article.category.name}</Text><Text style={[styles.title, { color: colors.text }]}>{article.title}</Text>{article.summary && <Text style={[styles.summary, { color: colors.muted }]}>{article.summary}</Text>}<Text style={[styles.date, { color: colors.muted }]}>{new Date(article.publishedAt).toLocaleDateString('ru-RU')}</Text></View>{notice && <InlineMessage title="Статус операции" body={notice} />}{article.requiresAcknowledgement && !article.acknowledgedAt && <Card><Text style={[styles.ackTitle, { color: colors.text }]}>Материал нужно подтвердить</Text><Text style={[styles.ackBody, { color: colors.muted }]}>Прочитайте материал и подтвердите ознакомление после просмотра.</Text><ActionButton label={busy ? 'Сохраняем…' : 'Подтвердить ознакомление'} icon={Check} onPress={() => void acknowledge()} disabled={busy} /></Card>}{article.quizzes.length > 0 && <Card><Text style={[styles.sectionTitle, { color: colors.text }]}>Связанные тесты</Text>{article.quizzes.map((quiz) => <Pressable key={quiz.id} accessibilityRole="button" onPress={() => router.push(`/quiz/${quiz.id}`)}><Text style={[styles.quiz, { color: colors.accent }]}>{quiz.title}</Text></Pressable>)}</Card>}<Card><KnowledgeMarkdown value={article.body} /></Card>{article.attachments.length > 0 && <Card><Text style={[styles.sectionTitle, { color: colors.text }]}>Вложения</Text>{article.attachments.map((attachment) => { const uri = attachmentUris[attachment.id]; return <View key={attachment.id} style={styles.attachment}>{uri && attachment.mimeType.startsWith('image/') ? <Image source={{ uri }} style={styles.preview} /> : <FileText color={colors.muted} size={22} />}<View style={styles.attachmentCopy}><Text numberOfLines={1} style={[styles.fileName, { color: colors.text }]}>{attachment.originalFilename}</Text><Text style={[styles.fileMeta, { color: colors.muted }]}>{Math.ceil(attachment.fileSize / 1024)} КБ</Text></View>{uri && attachment.mimeType === 'application/pdf' ? <ActionButton label="Открыть" variant="quiet" onPress={() => void Linking.openURL(uri)} /> : <ActionButton label={uri ? 'Открыть' : 'Скачать'} icon={Download} variant="quiet" onPress={() => void openAttachment(attachment)} disabled={busy} />}</View>})}</Card>}</View>}</Screen>
}

const styles = StyleSheet.create({ content: { gap: 16 }, heading: { gap: 6 }, category: { fontSize: 13, fontWeight: '700' }, title: { fontSize: 27, lineHeight: 33, fontWeight: '600', letterSpacing: -0.6 }, summary: { fontSize: 15, lineHeight: 21 }, date: { fontSize: 12, marginTop: 2 }, sectionTitle: { fontSize: 17, fontWeight: '600', marginBottom: 12 }, ackTitle: { fontSize: 17, fontWeight: '600', marginBottom: 6 }, ackBody: { fontSize: 14, lineHeight: 20, marginBottom: 14 }, quiz: { fontSize: 15, fontWeight: '600', marginTop: 5 }, attachment: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }, attachmentCopy: { flex: 1, gap: 2 }, fileName: { fontSize: 14, fontWeight: '600' }, fileMeta: { fontSize: 12 }, preview: { width: 52, height: 52, borderRadius: 10 } })
