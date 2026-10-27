import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from 'cn'

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
	return <div className="table-scroll"><table className={cn('data-table', className)} {...props} /></div>
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
	return <thead className={cn(className)} {...props} />
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
	return <tbody className={cn(className)} {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
	return <tr className={cn(className)} {...props} />
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
	return <th className={cn(className)} {...props} />
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
	return <td className={cn(className)} {...props} />
}
