'use client'

import type { ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
			{children}
			<Toaster position="bottom-right" theme="system" closeButton />
		</ThemeProvider>
	)
}
