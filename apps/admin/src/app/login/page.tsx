import { LoginForm } from '@/components/login-form'

type LoginPageProps = {
	searchParams: Promise<{ error?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
	const params = await searchParams
	const error = Array.isArray(params.error) ? params.error[0] : params.error
	return <LoginForm initialError={error} />
}
