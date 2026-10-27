export const demoKpis = [
	{ label: 'Активные сотрудники', value: '128', change: '+12%', note: 'к прошлой неделе', tone: 'blue' as const, icon: 'users' as const },
	{ label: 'Магазины', value: '12', change: '0%', note: 'без изменений', tone: 'green' as const, icon: 'stores' as const },
	{ label: 'Завершили тесты', value: '86', change: '+18%', note: 'к прошлой неделе', tone: 'orange' as const, icon: 'tests' as const },
	{ label: 'Фотографии за 30 дней', value: '342', change: '+27%', note: 'к прошлому периоду', tone: 'blue' as const, icon: 'photos' as const },
]

export const demoActivity = [
	{ name: 'Мария Соколова', initials: 'МС', action: 'завершила тест «Знание продукции»', store: 'Магазин ТЦ Европейский', time: '14:32', tone: 'rose' as const, kind: 'test' as const },
	{ name: 'Иван Петров', initials: 'ИП', action: 'добавил 5 фотографий', store: 'Магазин ТЦ Авиапарк', time: '13:47', tone: 'slate' as const, kind: 'photo' as const },
	{ name: 'София Климова', initials: 'СК', action: 'начала тест «Стандарты обслуживания»', store: 'Магазин ТЦ Метрополис', time: '12:06', tone: 'violet' as const, kind: 'test' as const },
	{ name: 'Елена Новикова', initials: 'ЕН', action: 'прошла тест «Новые коллекции Q4»', store: 'Магазин ТРЦ Галерея', time: '11:28', tone: 'amber' as const, kind: 'test' as const },
	{ name: 'Виктор Смирнов', initials: 'ВС', action: 'загрузил 8 фотографий', store: 'Магазин ТЦ Мега Тёплый Стан', time: '10:14', tone: 'slate' as const, kind: 'photo' as const },
]

export const demoStores = [
	{ name: 'ТЦ Авиапарк', city: 'Москва', active: '18 / 20', progress: 90 },
	{ name: 'ТЦ Европейский', city: 'Москва', active: '16 / 18', progress: 89 },
	{ name: 'ТЦ Метрополис', city: 'Москва', active: '14 / 16', progress: 88 },
	{ name: 'ТРЦ Галерея', city: 'Санкт-Петербург', active: '12 / 15', progress: 80 },
	{ name: 'ТЦ Мега Тёплый Стан', city: 'Москва', active: '11 / 14', progress: 79 },
	{ name: 'ТЦ Охотный Ряд', city: 'Москва', active: '8 / 12', progress: 67 },
]

export const demoEmployees = [
	{ name: 'Мария Соколова', initials: 'МС', store: 'ТЦ Европейский', role: 'Продавец-консультант', tests: '4 / 5', activity: 'Сегодня, 14:32', status: 'Активен' as const, tone: 'rose' as const },
	{ name: 'Иван Петров', initials: 'ИП', store: 'ТЦ Авиапарк', role: 'Старший продавец', tests: '5 / 5', activity: 'Сегодня, 13:47', status: 'Активен' as const, tone: 'slate' as const },
	{ name: 'София Климова', initials: 'СК', store: 'ТЦ Метрополис', role: 'Продавец-консультант', tests: '3 / 5', activity: 'Сегодня, 12:06', status: 'Активен' as const, tone: 'violet' as const },
	{ name: 'Елена Новикова', initials: 'ЕН', store: 'ТРЦ Галерея', role: 'Администратор', tests: '5 / 5', activity: 'Сегодня, 11:28', status: 'Активен' as const, tone: 'amber' as const },
	{ name: 'Виктор Смирнов', initials: 'ВС', store: 'ТЦ Мега Тёплый Стан', role: 'Продавец-консультант', tests: '2 / 5', activity: 'Сегодня, 10:14', status: 'В отпуске' as const, tone: 'slate' as const },
]
