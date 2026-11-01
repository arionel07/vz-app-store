import { describe, expect, test } from 'bun:test'
import { knowledgeAttachmentExtension, knowledgeAttachmentViewerUri } from '../src/knowledge/attachments'

describe('knowledge attachment media', () => {
	test('uses the matching file extension for MP4 and existing materials', () => {
		expect(knowledgeAttachmentExtension('video/mp4')).toBe('mp4')
		expect(knowledgeAttachmentExtension('application/pdf')).toBe('pdf')
		expect(knowledgeAttachmentExtension('image/png')).toBe('png')
		expect(knowledgeAttachmentExtension('image/webp')).toBe('webp')
		expect(knowledgeAttachmentExtension('image/jpeg')).toBe('jpg')
	})

	test('uses content URIs for Android file viewers and keeps native file URIs on iOS', async () => {
		const resolveContentUri = async (uri: string) => `content://${uri.slice('file://'.length)}`
		expect(await knowledgeAttachmentViewerUri('file:///cache/lesson.mp4', 'android', resolveContentUri)).toBe('content:///cache/lesson.mp4')
		expect(await knowledgeAttachmentViewerUri('file:///cache/lesson.mp4', 'ios', resolveContentUri)).toBe('file:///cache/lesson.mp4')
	})
})
