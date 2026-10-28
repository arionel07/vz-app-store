import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	async headers() {
		return [{
			source: '/activate',
			headers: [
				{ key: 'Cache-Control', value: 'no-store, max-age=0' },
				{ key: 'Referrer-Policy', value: 'no-referrer' },
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'X-Frame-Options', value: 'DENY' },
			],
		}]
	},
}

export default nextConfig
