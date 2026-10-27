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

export const demoRoster = [
	{ name: 'Анна Кузнецова', initials: 'АК', role: 'Старший продавец', store: 'ТРЦ Авиапарк', tests: '100%', testProgress: 100, photos: 24, status: 'Активен' as const, tone: 'rose' as const, activity: 'Сегодня, 15:42' },
	{ name: 'Максим Ковалев', initials: 'МК', role: 'Продавец-консультант', store: 'ТРЦ Европейский', tests: '80%', testProgress: 80, photos: 12, status: 'Активен' as const, tone: 'slate' as const, activity: 'Сегодня, 14:18' },
	{ name: 'Елена Лебедева', initials: 'ЕЛ', role: 'Администратор', store: 'ТРЦ Метрополис', tests: '100%', testProgress: 100, photos: 18, status: 'Активен' as const, tone: 'violet' as const, activity: 'Сегодня, 13:05' },
	{ name: 'Дмитрий Соколов', initials: 'ДС', role: 'Продавец-консультант', store: 'ТРЦ Галерея', tests: '60%', testProgress: 60, photos: 7, status: 'Активен' as const, tone: 'amber' as const, activity: 'Сегодня, 12:47' },
	{ name: 'Ольга Смирнова', initials: 'ОС', role: 'Продавец-консультант', store: 'ТРЦ Колумбус', tests: '100%', testProgress: 100, photos: 21, status: 'Активен' as const, tone: 'rose' as const, activity: 'Сегодня, 11:32' },
	{ name: 'Иван Петров', initials: 'ИП', role: 'Продавец-консультант', store: 'ТРЦ Мега Химки', tests: '40%', testProgress: 40, photos: 3, status: 'Активен' as const, tone: 'slate' as const, activity: 'Сегодня, 10:21' },
	{ name: 'Мария Новикова', initials: 'МН', role: 'Старший продавец', store: 'ТРЦ Охотный Ряд', tests: '80%', testProgress: 80, photos: 15, status: 'Активен' as const, tone: 'violet' as const, activity: 'Сегодня, 09:55' },
	{ name: 'Алексей Сидоров', initials: 'АС', role: 'Продавец-консультант', store: 'ТРЦ Саларис', tests: '100%', testProgress: 100, photos: 19, status: 'Активен' as const, tone: 'slate' as const, activity: 'Сегодня, 09:12' },
	{ name: 'Наталья Волкова', initials: 'НВ', role: 'Администратор', store: 'ТРЦ Афимолл', tests: '90%', testProgress: 90, photos: 11, status: 'Активен' as const, tone: 'amber' as const, activity: 'Сегодня, 08:49' },
	{ name: 'Кирилл Громов', initials: 'КГ', role: 'Продавец-консультант', store: 'ТРЦ Калейдоскоп', tests: '80%', testProgress: 80, photos: 9, status: 'Активен' as const, tone: 'slate' as const, activity: 'Вчера, 19:24' },
	{ name: 'Светлана Морозова', initials: 'СМ', role: 'Продавец-консультант', store: 'ТРЦ Vegas Кунцево', tests: '100%', testProgress: 100, photos: 16, status: 'Активен' as const, tone: 'rose' as const, activity: 'Вчера, 18:11' },
	{ name: 'Денис Крылов', initials: 'ДК', role: 'Продавец-консультант', store: 'ТРЦ Ривьера', tests: '60%', testProgress: 60, photos: 5, status: 'Неактивен' as const, tone: 'slate' as const, activity: 'Вчера, 16:03' },
	{ name: 'Татьяна Зайцева', initials: 'ТЗ', role: 'Старший продавец', store: 'ТРЦ Космопорт', tests: '100%', testProgress: 100, photos: 22, status: 'Активен' as const, tone: 'amber' as const, activity: 'Вчера, 15:22' },
	{ name: 'Владимир Лапин', initials: 'ВЛ', role: 'Продавец-консультант', store: 'ТРЦ Гринвич', tests: '80%', testProgress: 80, photos: 8, status: 'Активен' as const, tone: 'slate' as const, activity: 'Вчера, 14:07' },
	{ name: 'Анастасия Белова', initials: 'АБ', role: 'Продавец-консультант', store: 'ТРЦ Планета', tests: '100%', testProgress: 100, photos: 14, status: 'Активен' as const, tone: 'rose' as const, activity: 'Вчера, 12:36' },
]
