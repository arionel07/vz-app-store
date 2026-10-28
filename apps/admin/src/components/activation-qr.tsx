'use client'

import { useMemo } from 'react'
import qrcode from 'qrcode-generator'
import { formatDate } from '@/lib/management-client'

export function ActivationQr({ payload, expiresAt }: { payload: string; expiresAt: string }) {
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

	return (
		<div className="qr-activation-content">
			<div className="qr-canvas-wrap"><svg role="img" aria-label="QR-код активации" viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges">{cells}</svg></div>
			<p className="qr-expiration">Действует до {formatDate(expiresAt)}</p>
			<p className="qr-caption">Покажите этот код сотруднику для активации приложения. После закрытия окна код будет удалён из состояния страницы.</p>
		</div>
	)
}
