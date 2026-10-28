'use client'

import { Copy, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { buildActivationLink } from '@vizaje/contracts'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/management-client'

export function ActivationQr({ payload, expiresAt }: { payload: string; expiresAt: string }) {
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
	const code = useMemo(() => {
		const generated = qrcode(0, 'M')
		generated.addData(payload)
		generated.make()
		return generated
	}, [payload])
	const modules = code.getModuleCount()
	const cells = Array.from({ length: modules * modules }, (_, index) => {
		const row = Math.floor(index / modules)
		const column = index % modules
		return code.isDark(row, column) ? <rect key={`${row}-${column}`} x={column} y={row} width="1" height="1" /> : null
	})
	const activationLink = buildActivationLink(payload, process.env.NEXT_PUBLIC_ACTIVATION_LINK_BASE_URL)

	async function copyLink() {
		if (!activationLink) {
			setCopyState('error')
			return
		}

		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(activationLink)
			} else {
				const textarea = document.createElement('textarea')
				textarea.value = activationLink
				textarea.setAttribute('readonly', '')
				textarea.style.position = 'fixed'
				textarea.style.opacity = '0'
				document.body.appendChild(textarea)
				textarea.select()
				const copied = document.execCommand('copy')
				textarea.remove()
				if (!copied) throw new Error('Clipboard unavailable')
			}
			setCopyState('copied')
		} catch {
			setCopyState('error')
		}
	}

	return (
		<div className="qr-activation-content">
			<div className="qr-canvas-wrap"><svg role="img" aria-label="QR-код активации" viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges">{cells}</svg></div>
			<p className="qr-expiration">Действует до {formatDate(expiresAt)}</p>
			<p className="qr-caption">Покажите QR-код сотруднику или скопируйте одноразовую ссылку. После закрытия окна код будет удалён из состояния страницы.</p>
			<Button type="button" variant="outline" size="sm" disabled={!activationLink} onClick={() => void copyLink()}><>{copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}{copyState === 'copied' ? 'Ссылка скопирована' : 'Скопировать ссылку'}</></Button>
			{copyState === 'error' && <p className="qr-caption" role="alert">Не удалось скопировать ссылку. Проверьте настройку адреса активации и разрешение браузера.</p>}
			{!activationLink && <p className="qr-caption" role="status">Ссылка активации не настроена в окружении Admin.</p>}
		</div>
	)
}
