'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Leaf, LoaderCircle } from 'lucide-react'
import { adminLoginRequestSchema } from '@vizaje/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function initialMessage(value: string | undefined): string | null {
	if (value === 'forbidden') return 'У этой учётной записи нет доступа к панели управления.'
	if (value === 'unavailable') return 'Сервис авторизации временно недоступен. Попробуйте позже.'
	return null
}

export function LoginForm({ initialError }: { initialError?: string }) {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [error, setError] = useState<string | null>(() => initialMessage(initialError))
	const [isSubmitting, setIsSubmitting] = useState(false)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)

		const parsed = adminLoginRequestSchema.safeParse({ email: email.trim(), password })
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.path[0] === 'email' ? 'Введите корректный email.' : 'Введите пароль.')
			return
		}

		setIsSubmitting(true)
		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(parsed.data),
			})

			if (response.ok) {
				router.replace('/')
				router.refresh()
				return
			}

			if (response.status === 401) setError('Неверный email или пароль.')
			else if (response.status === 503) setError('Сервис авторизации временно недоступен. Попробуйте позже.')
			else setError('Не удалось выполнить вход. Попробуйте ещё раз.')
		} catch {
			setError('Сервис авторизации временно недоступен. Попробуйте позже.')
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
			<section className="surface-panel w-full max-w-[420px]">
				<div className="panel-content pt-[21px]">
					<div className="mb-6 flex items-center gap-2 text-base font-semibold tracking-tight"><Leaf size={17} /> Vizaje Staff</div>
					<p className="eyebrow">Рабочая область</p>
					<h1 className="panel-title text-xl">Вход в панель управления</h1>
					<p className="panel-description">Используйте рабочие данные учётной записи.</p>
				</div>
				<form className="form-stack px-[21px] pb-[21px]" onSubmit={handleSubmit} noValidate>
					<label className="grid gap-1.5 text-xs font-medium text-muted-foreground" htmlFor="email">
						Email
						<Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(error)} />
					</label>
					<label className="grid gap-1.5 text-xs font-medium text-muted-foreground" htmlFor="password">
						Пароль
						<span className="relative block">
							<Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(error)} className="pr-11" />
							<button type="button" className="icon-button absolute right-1 top-1/2 -translate-y-1/2" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
								{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
							</button>
						</span>
					</label>
					{error && <p className="m-0 text-xs text-destructive" role="alert">{error}</p>}
					<Button type="submit" size="lg" disabled={isSubmitting} className="mt-1 w-full">
						{isSubmitting && <LoaderCircle size={16} className="animate-spin" />}
						{isSubmitting ? 'Выполняется вход…' : 'Войти'}
					</Button>
				</form>
			</section>
		</main>
	)
}
