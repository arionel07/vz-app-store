import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
	title: 'Активация Vizaje Staff',
	robots: { index: false, follow: false },
	referrer: 'no-referrer',
}

export default function ActivationFallbackPage() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
			<section className="surface-panel w-full max-w-[420px]">
				<div className="panel-content">
					<p className="eyebrow">VIZAJE STAFF</p>
					<h1 className="panel-title text-xl">Откройте ссылку в приложении</h1>
					<p className="panel-description">Установите Vizaje Staff на телефоне и откройте эту ссылку там. Активация через браузер не выполняется.</p>
				</div>
			</section>
		</main>
	)
}
