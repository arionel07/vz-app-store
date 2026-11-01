import type { KnowledgeAttachmentResponse } from '@vizaje/contracts'

export function knowledgeAttachmentExtension(mimeType: KnowledgeAttachmentResponse['mimeType']): string {
	if (mimeType === 'application/pdf') return 'pdf'
	if (mimeType === 'image/png') return 'png'
	if (mimeType === 'image/webp') return 'webp'
	if (mimeType === 'video/mp4') return 'mp4'
	return 'jpg'
}

export async function knowledgeAttachmentViewerUri(
	uri: string,
	platform: 'android' | 'ios' | 'web',
	getAndroidContentUri: (fileUri: string) => Promise<string>,
): Promise<string> {
	return platform === 'android' ? getAndroidContentUri(uri) : uri
}
