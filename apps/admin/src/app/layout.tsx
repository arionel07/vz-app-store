import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({
	subsets: ['latin']
})

export const metadata: Metadata = {
	title: 'Vizaje Staff',
	description: 'Vizaje-Nica internal management'
}

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="ru">
			<body className={geist.className}>{children}</body>
		</html>
	)
}
