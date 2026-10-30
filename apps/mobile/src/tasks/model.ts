import type { TaskResponse } from '@vizaje/contracts'

export function taskProgress(task: Pick<TaskResponse, 'checklist'>): { completed: number; total: number } {
	return { completed: task.checklist.filter((item) => item.completed).length, total: task.checklist.length }
}

export function canEditTask(status: TaskResponse['status']): boolean {
	return status === 'in_progress' || status === 'rejected'
}

export function canSubmitTask(status: TaskResponse['status']): boolean {
	return canEditTask(status)
}
