# Vizaje Staff — Native QA 11.2

Этот документ предназначен для ручной проверки native development/preview build. В этой среде физическое устройство и iOS/Android simulator не запускались, поэтому поля `Результат` нужно заполнить на реальном QA-прогоне.

## Подготовка

1. Запустите API с тестовой базой и тестовыми учетными данными. Не используйте production credentials.
2. Скопируйте `apps/mobile/.env.example` в локальный `.env` и задайте `EXPO_PUBLIC_API_URL`:
   - iOS Simulator: `http://127.0.0.1:3000`;
   - Android Emulator: `http://10.0.2.2:3000`;
   - физическое устройство: доступный по сети HTTPS staging endpoint или HTTPS tunnel.
   Для временной проверки через LAN HTTP задайте `EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true`;
   это работает только в development runtime и только для private/LAN адреса,
   не для production build.
   Для проверки HTTPS activation link задайте также `EXPO_PUBLIC_ACTIVATION_LINK_BASE_URL` и используйте то же значение, что и в Admin.
3. Убедитесь, что API доступен с устройства, а firewall допускает только нужный тестовый порт.
4. Для локального native development build на macOS:

   ```bash
   cd apps/mobile
   npx expo run:ios
   npx expo run:android
   ```

   Команды требуют Xcode/iOS Simulator или Android Studio/SDK. Первый запуск создаёт native-проекты локально; их не нужно коммитить, если они не являются частью release workflow.

5. Опциональные EAS-команды ниже только подготавливают/запускают внешнюю сборку. Не выполняйте их без отдельного разрешения на upload исходников в EAS:

   ```bash
   cd apps/mobile
   npm install --global eas-cli
   eas build --profile development --platform ios
   eas build --profile development --platform android
   eas build --profile preview --platform ios
   eas build --profile preview --platform android
   ```

   `eas.json` не содержит API URL, credentials или signing configuration. Перед preview/development build задайте `EXPO_PUBLIC_API_URL` через согласованный защищенный механизм окружения.

## Карточка прогона

| Поле | Значение |
|---|---|
| Дата / тестировщик | |
| Устройство и OS | |
| Build profile / version | |
| API origin | |
| Backend commit | |
| Результат прогона | PASS / FAIL |

## Checklist

Заполняйте `PASS`, `FAIL` или `BLOCKED` и добавляйте ссылку на issue/описание в последней колонке.

| # | Проверка | Ожидаемое поведение | Результат / заметки |
|---:|---|---|---|
| 1 | Первый запуск без сессии | Открывается экран активации; рабочие разделы и данные не показываются | |
| 2 | Light/Dark/System appearance | Тема следует системной настройке; текст и контролы остаются читаемыми | |
| 3 | Отказ в camera permission | QR-сканер не запускается, показана понятная ошибка и ссылка на настройки | |
| 4 | Разрешение camera permission | Камера запускается только после нажатия; QR-сканер видит QR-код | |
| 5 | Deep link `vizaje://activate` | Ссылка открывает приложение, показывает подтверждение и обрабатывается как activation payload | |
| 6 | Одноразовая активация | Валидный QR активирует сотрудника; повторное использование отклоняется | |
| 7 | Неверный/просроченный QR | Показана generic ошибка, secret не сохраняется и не логируется | |
| 7a | Staff email/password login | Валидный staff email/password создаёт mobile session; неверные данные, inactive account и manager/admin получают generic ошибку | |
| 8 | Persistence после restart | После закрытия и повторного запуска валидная mobile session восстанавливается через SecureStore | |
| 9 | Session rotation | При истекшем access token выполняется renewal; новый token сохраняется, старый не используется | |
| 10 | Revoked session | После revoke на API приложение прекращает доступ и возвращает к активации | |
| 11 | Quiz start/resume | Тест открывается, незавершенная попытка возобновляется без создания дубликата | |
| 12 | Quiz submit | Ответы отправляются один раз; результат и pass/fail отображаются после ответа API | |
| 13 | Network interruption | GET показывает recoverable error; write-запрос не повторяется автоматически и не создаёт дубль | |
| 14 | Gallery permission/cancel | Отказ объясняется; отмена picker не меняет очередь и не создаёт upload | |
| 15 | Camera photo | Фото добавляется в очередь после явного действия и сохраняет orientation | |
| 16 | HEIC/HEIF photo | Фото преобразуется в JPEG, сохраняет пропорции, не увеличивается и проходит размерный preflight | |
| 17 | Store scope | Один магазин выбирается автоматически; при нескольких нужен явный выбор; чужой ID недоступен | |
| 18 | Photo upload | Multipart upload содержит один file, bearer и idempotency key; прогресс/статус виден пользователю | |
| 19 | Partial success/retry | Успешные фото сохраняются, failed-фото можно повторить с тем же idempotency key | |
| 20 | Cancel upload | Отмена оставляет текущий элемент в failed; повтор запускается только вручную | |
| 21 | Private photo viewing | История загружается с bearer; image URL не содержит token; без сессии фото недоступно | |
| 22 | Logout | Локальная сессия очищается, API revoke вызывается, защищенные экраны больше не открываются | |
| 23 | HTTPS activation link | При настроенной domain association ссылка открывает приложение; token не показывается на экране | |
| 24 | Link confirmation/duplicate events | До подтверждения redemption не выполняется; повторное событие не создаёт второй запрос | |
| 25 | Browser fallback | Без приложения открывается минимальная страница установки; браузер не redeem-ит token | |
| 26 | QR/link same secret | QR и link используют один token: после redemption одним способом второй получает invalid/expired | |

## Native compatibility notes

- QR uses `expo-camera` and requires a native development build; Expo Go is not a substitute for this verification.
- `expo-secure-store` is configured with Android backup rules and no Face ID prompt is requested by this app.
- `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-image`, `expo-file-system` and `expo-secure-store` are pinned to Expo SDK 58-compatible versions in the workspace lockfile.
- Authenticated photo previews are downloaded to the app cache with an `Authorization` header; session tokens are not placed in image URLs or logs.
- `EXPO_PUBLIC_API_URL` is mandatory at runtime. HTTP requires the explicit `EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true` development setting and is limited to loopback/private/LAN hosts; release builds and non-local endpoints must use HTTPS.
- HTTPS activation links are parser-ready but are not claimed as working until Apple/Android domain association and native device verification are complete. `vizaje://activate` remains the development fallback.
