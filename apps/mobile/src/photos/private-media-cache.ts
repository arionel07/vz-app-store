import type * as LegacyFileSystem from 'expo-file-system/legacy'

const privateMediaPrefixes = [
	'vizaje-photo-',
	'vizaje-task-evidence-',
	'vizaje-knowledge-',
	'vizaje-operation-',
] as const

type CacheFileSystem = Pick<typeof LegacyFileSystem, 'cacheDirectory' | 'readDirectoryAsync' | 'deleteAsync'>

export function isPrivateMediaCacheFile(filename: string): boolean {
	return privateMediaPrefixes.some((prefix) => filename.startsWith(prefix))
}

export function didStoreContextChange(previousStoreId: string | null | undefined, nextStoreId: string | null): boolean {
	return previousStoreId !== undefined && previousStoreId !== nextStoreId
}

export async function deletePrivateMediaCacheFile(uri: string, fileSystem?: CacheFileSystem): Promise<void> {
	let fs: CacheFileSystem
	try {
		fs = fileSystem ?? await import('expo-file-system/legacy')
	} catch {
		return
	}
	const directory = fs.cacheDirectory
	if (!directory || !uri.startsWith(directory)) return
	const filename = uri.slice(directory.length)
	if (!isPrivateMediaCacheFile(filename)) return
	await fs.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

export async function clearPrivateMediaCache(fileSystem?: CacheFileSystem): Promise<void> {
	let fs: CacheFileSystem
	try {
		fs = fileSystem ?? await import('expo-file-system/legacy')
	} catch {
		return
	}
	const directory = fs.cacheDirectory
	if (!directory) return

	let entries: string[]
	try {
		entries = await fs.readDirectoryAsync(directory)
	} catch {
		return
	}

	await Promise.all(entries
		.filter(isPrivateMediaCacheFile)
		.map((filename) => fs.deleteAsync(`${directory}${filename}`, { idempotent: true }).catch(() => undefined)))
}
