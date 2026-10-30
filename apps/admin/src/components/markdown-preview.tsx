'use client'

import { Fragment, type ReactNode } from 'react'

function inline(value: string): ReactNode[] {
	const parts = value.split(/(\*\*[^*]+\*\*|\*[^*]+\*|https:\/\/[^\s)]+)/g)
	return parts.map((part, index) => {
		if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
		if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
		if (part.startsWith('https://')) return <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a>
		return <Fragment key={index}>{part}</Fragment>
	})
}

export function MarkdownPreview({ value }: { value: string }) {
	const lines = value.split(/\r?\n/)
	return <div className="knowledge-markdown-preview">{lines.map((line, index) => {
		if (!line.trim()) return <div key={index} className="h-3" />
		if (line.startsWith('# ')) return <h2 key={index}>{inline(line.slice(2))}</h2>
		if (line.startsWith('## ')) return <h3 key={index}>{inline(line.slice(3))}</h3>
		if (line.startsWith('- ')) return <p key={index} className="knowledge-list-item"><span>•</span>{inline(line.slice(2))}</p>
		return <p key={index}>{inline(line)}</p>
	})}</div>
}
