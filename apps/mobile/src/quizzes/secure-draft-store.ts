import * as SecureStore from 'expo-secure-store'
import { createAttemptDraftStore } from './draft-store'

export const secureAttemptDraftStore = createAttemptDraftStore({
	getItem: (key) => SecureStore.getItemAsync(key),
	setItem: (key, value) => SecureStore.setItemAsync(key, value),
	deleteItem: (key) => SecureStore.deleteItemAsync(key),
})
