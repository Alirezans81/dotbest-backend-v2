# API And Integrations

این سند قرارداد APIها و integrationهای لازم برای MVP را مشخص می‌کند. همه handlerها باید با `Next.js 16 Route Handlers` در `app/api/**/route.ts` پیاده‌سازی شوند.

## قواعد معماری

- از `pages/api` استفاده نشود
- هر endpoint در فایل `route.ts` زیر `app/api` قرار بگیرد
- route handlerها از `Request` یا `NextRequest` و `Response` یا `NextResponse` استفاده کنند
- route handler نباید در همان segment با `page.tsx` conflict داشته باشد

## Route Map

- `GET /api/health`
- `POST /api/telegram/webhook`
- `POST /api/bale/webhook`
- `POST /api/payments/initiate`
- `GET /api/payments/callback`
- `POST /api/payments/verify`
- `POST /api/jobs/reminders/run`

## File Layout پیشنهادی

- `app/api/health/route.ts`
- `app/api/telegram/webhook/route.ts`
- `app/api/bale/webhook/route.ts`
- `app/api/payments/initiate/route.ts`
- `app/api/payments/callback/route.ts`
- `app/api/payments/verify/route.ts`
- `app/api/jobs/reminders/run/route.ts`

## GET /api/health

### هدف

healthcheck پایه برای مانیتورینگ و deployment validation

### response پیشنهادی

```json
{
  "ok": true,
  "service": "dotbest-backend",
  "timezone": "Asia/Tehran"
}
```

### قواعد

- این endpoint نباید وابسته به webhook تلگرام یا بله باشد
- در فازهای بعدی می‌تواند health دیتابیس را هم اضافه کند

## POST /api/telegram/webhook

### هدف

دریافت `Telegram Update` و dispatch به command handler, callback handler و message handler با `platform = TELEGRAM`.

### request source

- فقط Telegram
- باید با `x-telegram-bot-api-secret-token` header محافظت شود

### contract

- body: raw update payload from Telegram
- response: `200 OK` سریع برای جلوگیری از retry غیرضروری

### handler responsibilities

- validate webhook secret
- dedupe بر اساس `update_id`
- شناسایی actor
- load یا create `ConversationSession` با `platform = TELEGRAM`
- dispatch به flow مناسب با `BotContext { platform: "TELEGRAM" }`
- ثبت outbound notifications در `NotificationLog`

### خط‌مشی idempotency

- `update_id` باید فقط یک بار side effect تولید کند
- اگر همان update دوباره رسید:
  - response همچنان `200` باشد
  - side effect تکرار نشود

## POST /api/bale/webhook

### هدف

دریافت `Bale Update` (سازگار با Telegram Bot API) و dispatch با `platform = BALE`.

### request source

- فقط Bale
- باید با `x-bale-bot-api-secret-token` header محافظت شود

### contract

- body: همان فرمت Telegram Update (Bale API-compatible)
- response: `200 OK` سریع

### handler responsibilities

- validate webhook secret
- dedupe بر اساس `update_id`
- load یا create `ConversationSession` با `platform = BALE`
- dispatch به همان dispatcher با `BotContext { platform: "BALE" }`

### تفاوت با تلگرام

- base URL: `https://tapi.bale.ai`
- token: `BALE_BOT_TOKEN`
- پیام‌های خروجی به بله API ارسال می‌شوند نه تلگرام

## POST /api/payments/initiate

### هدف

ساخت payment intent و برگرداندن redirect URL

### request body

```json
{
  "bookingId": "booking_xxx"
}
```

### preconditions

- booking باید در `APPROVED_AWAITING_DEPOSIT` باشد
- `depositAmountToman` باید مقدار معتبر داشته باشد

### success response

```json
{
  "paymentIntentId": "pi_xxx",
  "redirectUrl": "https://gateway.example/...",
  "expiresAt": "2026-04-20T10:30:00.000Z"
}
```

### side effects

- ساخت `PaymentIntent`
- ثبت `PaymentTransaction` برای initiate request/response
- تغییر وضعیت booking به `PAYMENT_PENDING`
- **auto-reject:** تمام bookingهای `PENDING_REVIEW`/`APPROVED_AWAITING_DEPOSIT` روی همان اسلات به `REJECTED` منتقل می‌شوند
- نوتیف به مشتریان رد شده ارسال می‌شود

### idempotency

- اگر payment intent active برای booking وجود دارد، همان intent برگردد
- intent منقضی‌شده نباید reuse شود

## GET /api/payments/callback

### هدف

پذیرش callback درگاه و شروع verify server-side

### query params نمونه

- `Authority`
- `Status`
- `intentId` — شناسه `PaymentIntent` داخلی

### رفتار موردنیاز

- query params validate شوند
- payment intent مرتبط پیدا شود
- verify داخلی اجرا شود
- نتیجه در booking و payment tables ثبت شود
- یک پاسخ HTML خیلی ساده به کاربر نمایش داده شود

### خروجی کاربر نهایی

- در صورت موفقیت:
  - پیام موفق داخل بات (به پلتفرم ترجیحی مشتری)
  - صفحه کوتاه با متن موفقیت
- در صورت خطا:
  - پیام retry داخل بات
  - صفحه کوتاه با متن خطا

### نکته ارسال نوتیف

- callback از درگاه پرداخت می‌رسد، نه از یک پلتفرم مشخص
- نوتیف‌های پس از پرداخت از طریق `notifyCustomer` / `notifyHairdresser` ارسال می‌شوند که `notificationChannel` را رعایت می‌کنند

## POST /api/payments/verify

### هدف

endpoint داخلی یا admin-safe برای verify مجدد یک payment intent

### request body

```json
{
  "paymentIntentId": "pi_xxx"
}
```

### success behavior

- تماس با provider verify API
- ثبت `VERIFY_REQUEST` و `VERIFY_RESPONSE`
- اگر verify موفق بود:
  - `PaymentIntent.status = VERIFIED`
  - `Booking.status = CONFIRMED`
  - `Booking.confirmedAt` مقدار بگیرد
  - notificationهای تایید ساخته شوند

### duplicate behavior

- اگر payment قبلاً verify شده باشد:
  - response موفق برگردد
  - side effect جدید ایجاد نشود
  - transaction با `IGNORED_DUPLICATE` ثبت شود یا endpoint آن را no-op کند

## POST /api/jobs/reminders/run

### هدف

اجرای scheduled job برای ارسال reminder

### authentication

- header secret مانند `x-job-secret`

### رفتار

- رزروهای `CONFIRMED` که reminder موعدشان رسیده انتخاب شوند
- ارسال پیام برای آرایشگر و مشتری از طریق `notifyHairdresser` / `notifyCustomer`
- هر نوتیف بر اساس `notificationChannel` گیرنده به پلتفرم درست ارسال می‌شود
- ثبت نتیجه در `NotificationLog`

### قواعد

- job باید retry-safe باشد
- هر reminder با `idempotencyKey` یکتا تولید شود (`reminder:<bookingId>:<window>:<recipientType>`)

## Telegram Integration

### ورودی‌های پشتیبانی‌شده

- `/start`
- `contact`
- `text`
- `callback_query`
- `photo`
- `video`

### dispatch rules

- اگر update از آرایشگر باشد، flow آرایشگر اجرا شود
- اگر update از deep link مشتری آمده باشد، flow مشتری اجرا شود
- callback query باید بر اساس namespace parse شود

### پیام‌های خروجی اصلی

- پیام خوش‌آمدگویی آرایشگر
- پیام تعریف سرویس
- اعلان درخواست جدید برای آرایشگر
- اعلان تایید یا رد برای مشتری
- اعلان تایید خودکار برای آرایشگر و مشتری
- اعلان رد خودکار برای مشتری (اسلات توسط مشتری دیگری رزرو شد)
- اعلان پرداخت موفق
- reminder قبل از نوبت
- پیام کنسلی

## Bale Integration

### تفاوت‌های فنی با تلگرام

- base URL: `https://tapi.bale.ai`
- token: `BALE_BOT_TOKEN`
- webhook secret header: `x-bale-bot-api-secret-token`
- فرمت payload یکسان با Telegram Bot API است

### پیام‌های خروجی

- همان پیام‌های تلگرام، با این تفاوت که از `BALE_BOT_TOKEN` و `tapi.bale.ai` استفاده می‌شود
- `BotContext { platform: "BALE" }` تضمین می‌کند پیام‌ها به Bale API برود

## Multi-Channel Notification Flow

ارسال هر نوتیف از طریق `src/bot/notify.ts`:

1. گیرنده (آرایشگر یا مشتری) لود می‌شود
2. `notificationChannel` گیرنده بررسی می‌شود
3. بر اساس channel:
   - `TELEGRAM_ONLY`: `sendMessage({ platform: "TELEGRAM" }, telegramChatId, ...)`
   - `BALE_ONLY`: `sendMessage({ platform: "BALE" }, baleChatId, ...)`
   - `BOTH`: هر دو به‌صورت موازی
4. اگر chatId پلتفرم ترجیحی خالی باشد، به پلتفرم دیگر fallback می‌کند

## Iranian Payment Redirect Flow

1. آرایشگر رزرو را تایید می‌کند
2. booking به `APPROVED_AWAITING_DEPOSIT` می‌رود
3. مشتری دکمه پرداخت را می‌زند
4. `POST /api/payments/initiate` فراخوانی می‌شود
5. payment intent ساخته می‌شود و booking به `PAYMENT_PENDING` می‌رود
6. **auto-reject:** رزروهای رقیب روی همان اسلات رد می‌شوند
7. مشتری به درگاه redirect می‌شود
8. provider به `GET /api/payments/callback` برمی‌گردد
9. verify انجام می‌شود
10. در صورت موفقیت booking به `CONFIRMED` می‌رود
11. نوتیف‌ها بر اساس `notificationChannel` ارسال می‌شوند

## Auto-Approve Flow

1. مشتری رزرو را submit می‌کند
2. سیستم `hairdresser.autoApproveBookings` را بررسی می‌کند
3. اگر `true`:
   - `Booking.status = CONFIRMED`
   - `isAutoApproved = true`
   - نوتیف فوری به مشتری و آرایشگر
   - جریان پرداخت حذف می‌شود
4. اگر `false`: جریان عادی `PENDING_REVIEW` اجرا می‌شود

## Verification Rules

- callback به تنهایی کافی نیست و verify server-side الزامی است
- `providerReferenceId` باید یکتا باشد
- callbackهای تکراری نباید دوباره booking را confirm کنند
- verify ناموفق نباید booking را به `CONFIRMED` ببرد

## Reminder Trigger Rules

- reminder اول 24 ساعت قبل از نوبت
- reminder دوم 2 ساعت قبل از نوبت
- فقط bookingهای `CONFIRMED` reminder می‌گیرند
- bookingهای cancel شده یا complete شده نباید reminder بگیرند
- هر reminder بر اساس `notificationChannel` گیرنده ارسال می‌شود

## Env Vars And Secrets

- `DATABASE_URL`
- `APP_BASE_URL`
- `DEFAULT_TIMEZONE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_URL`
- `TELEGRAM_WEBHOOK_SECRET`
- `BALE_BOT_TOKEN`
- `BALE_BOT_USERNAME`
- `BALE_WEBHOOK_URL`
- `BALE_WEBHOOK_SECRET`
- `PAYMENT_PROVIDER_BASE_URL`
- `PAYMENT_PROVIDER_MERCHANT_ID`
- `PAYMENT_PROVIDER_SECRET`
- `PAYMENT_PROVIDER_CALLBACK_URL`
- `PAYMENT_REQUEST_TIMEOUT_MINUTES`
- `BOOKING_SLOT_INTERVAL_MINUTES`
- `CRON_REMINDER_SECRET`

## Acceptance Scenarios

- `GET /api/health` بدون وابستگی به تلگرام یا بله پاسخ بدهد
- webhook تلگرام و webhook بله هر کدام با secret جداگانه محافظت شوند
- webhook تکراری side effect دوباره نسازد
- initiate فقط برای booking تاییدشده کار کند
- initiate رزروهای رقیب را به‌صورت اتمیک رد کند
- callback موفق بدون verify server-side رزرو را نهایی نکند
- verify موفق فقط یک بار `CONFIRMED` بسازد
- reminder job پیام تکراری ارسال نکند
- reminder به پلتفرم(های) ترجیحی کاربر ارسال شود
- auto-approve جریان پرداخت را bypass کند

## موارد Deferred

- provider نهایی درگاه هنوز نام‌گذاری نشده و باید پشت یک payment adapter قرار بگیرد
- endpoint وب عمومی برای مشاهده رزروها خارج از دامنه این MVP است
- object storage برای فایل‌ها در فاز اول خارج از محدوده است
- تنظیمات `notificationChannel` برای مشتری (در MVP فقط آرایشگر می‌تواند تغییر دهد)
