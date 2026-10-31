import { describe, expect, test } from 'bun:test'
import { clearPrivateMediaCache, deletePrivateMediaCacheFile, didStoreContextChange, isPrivateMediaCacheFile } from '../src/photos/private-media-cache'

describe('private media cache cleanup', () => {
	test('recognizes only app-owned private image cache files', () => {
		for (const filename of ['vizaje-photo-1.jpg', 'vizaje-operation-1.png', 'vizaje-task-evidence-2.webp', 'vizaje-knowledge-3.pdf']) {
			expect(isPrivateMediaCacheFile(filename)).toBe(true)
		}
		expect(isPrivateMediaCacheFile('expo-image-cache/item')).toBe(false)
		expect(isPrivateMediaCacheFile('unrelated-user-file.jpg')).toBe(false)
	})

	test('deletes private media on store changes but not on first selection', () => {
		expect(didStoreContextChange(undefined, 'store-a')).toBe(false)
		expect(didStoreContextChange('store-a', 'store-a')).toBe(false)
		expect(didStoreContextChange('store-a', 'store-b')).toBe(true)
		expect(didStoreContextChange('store-a', null)).toBe(true)
	})

	test('clears only app-owned private cache entries', async () => {
		const deleted: string[] = []
		await clearPrivateMediaCache({
			cacheDirectory: 'file:///cache/',
			readDirectoryAsync: async () => ['vizaje-photo-1.jpg', 'vizaje-operation-2.png', 'unrelated.jpg'],
			deleteAsync: async (uri) => { deleted.push(uri) },
		})
		expect(deleted.sort()).toEqual(['file:///cache/vizaje-operation-2.png', 'file:///cache/vizaje-photo-1.jpg'])
	})

	test('deletes a stale private image after a store switch without touching unrelated cache files', async () => {
		const deleted: string[] = []
		const fileSystem = {
			cacheDirectory: 'file:///cache/',
			readDirectoryAsync: async () => [],
			deleteAsync: async (uri: string) => { deleted.push(uri) },
		}
		await deletePrivateMediaCacheFile('file:///cache/vizaje-photo-old-store.jpg', fileSystem)
		await deletePrivateMediaCacheFile('file:///cache/expo-image-cache.jpg', fileSystem)
		expect(deleted).toEqual(['file:///cache/vizaje-photo-old-store.jpg'])
	})

	test('safely no-ops when the cache directory is unavailable', async () => {
		let read = false
		await clearPrivateMediaCache({
			cacheDirectory: null,
			readDirectoryAsync: async () => { read = true; return [] },
			deleteAsync: async () => undefined,
		})
		expect(read).toBe(false)
	})
})
