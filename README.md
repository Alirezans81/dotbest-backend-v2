# dotbest-backend-v2

سیستم رزرو آنلاین آرایشگاه از طریق تلگرام و بله — بک‌اند کامل MVP

## معماری کلی

```
مشتری ──▶ تلگرام / بله ──▶ Webhook ──▶ Dispatcher ──▶ Session + Handler
آرایشگر ─────────────────────────────────────────────────────────▶ Handler
                                                                      │
                                                               PostgreSQL (Prisma)
```

**Stack:**
- **Next.js 15** — App Router, Route Handlers (`app/api/**/route.ts`)
- **PostgreSQL + Prisma** — data layer
- **Telegram Bot API** — کانال اصلی (و Bale با همان API)
- **ZarinPal** — درگاه پرداخت (پشت adapter قابل تعویض)
- **Timezone:** `Asia/Tehran`
- **Money:** `Int Toman` (بدون float)

---

## پیش‌نیازها

- Node.js 20+
- PostgreSQL 14+
- یک بات تلگرام (از [@BotFather](https://t.me/BotFather))
- یک بات بله (اختیاری)
- یک حساب ZarinPal با merchant_id

---

## راه‌اندازی

### ۱. نصب وابستگی‌ها

```bash
npm install
```

### ۲. تنظیم متغیرهای محیطی

```bash
cp .env.example .env
```

فایل `.env` را پر کنید (توضیحات در `.env.example`).

### ۳. ایجاد جداول دیتابیس

```bash
npm run db:push
# یا برای migration تولید و اجرا:
npm run db:migrate
```

### ۴. اجرای سرور توسعه

```bash
npm run dev
```

### ۵. ثبت Webhook تلگرام

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

برای بله:
```bash
curl -X POST "https://tapi.bale.ai/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/bale/webhook"
  }'
```

---

## Endpoints

| Method | Path | توضیح |
|--------|------|-------|
| `GET` | `/api/health` | Healthcheck |
| `POST` | `/api/telegram/webhook` | دریافت updates تلگرام |
| `POST` | `/api/bale/webhook` | دریافت updates بله |
| `POST` | `/api/payments/initiate` | شروع فرآیند پرداخت |
| `GET` | `/api/payments/callback` | callback درگاه پرداخت |
| `POST` | `/api/payments/verify` | verify دستی پرداخت |
| `POST` | `/api/jobs/reminders/run` | اجرای job یادآوری |

---

## ساختار پروژه

```
prisma/
  schema.prisma          ← همه مدل‌ها + enum‌ها

src/
  lib/
    prisma.ts            ← Prisma client singleton
    time.ts              ← توابع timezone (Asia/Tehran)
    slug.ts              ← slug و idempotency key
    phone.ts             ← نرمال‌سازی شماره +98
    sync.ts              ← سینک حساب بین تلگرام و بله

  bot/
    states.ts            ← HairdresserState / CustomerState enums
    session.ts           ← ConversationSession manager (30 min TTL)
    dispatcher.ts        ← router اصلی updates
    notify.ts            ← ارسال نوتیف چندکاناله

    telegram/
      client.ts          ← Bot API client (platform-aware)
      types.ts           ← Telegram types

    handlers/
      hairdresser/
        onboarding.ts    ← /start، ثبت شماره، نام، اولین سرویس
        services.ts      ← افزودن دسته‌بندی و سرویس
        booking-review.ts ← تایید/رد رزرو + quote + deposit
        schedule.ts      ← نوبت‌های امروز، مشتریان، ساعت کاری، تنظیمات

      customer/
        booking.ts       ← جریان کامل رزرو (deep link → submit)
        payment.ts       ← پرداخت، لغو

  domain/
    availability.ts      ← محاسبه اسلات‌های خالی (14 روز)
    payment.ts           ← initiate + verify + auto-reject

  jobs/
    reminders.ts         ← job یادآوری (24h و 2h)

app/api/
  health/route.ts
  telegram/webhook/route.ts
  bale/webhook/route.ts
  payments/{initiate,callback,verify}/route.ts
  jobs/reminders/run/route.ts
```

---

## مسیر آرایشگر

```
/start
  ↓ ارسال شماره تماس
  ↓ ارسال نام
  ↓ تعریف دسته‌بندی اول
  ↓ تعریف سرویس اول (مدت + قیمت)
  ↓ دریافت لینک اختصاصی: t.me/bot?start=hd_<slug>

منوی اصلی:
  📅 نوبت‌های امروز
  👥 مشتریان
  ➕ سرویس جدید
  ⚙️ تنظیمات
     ├─ ساعت کاری
     ├─ زمان مسدود
     ├─ تایید خودکار: روشن/خاموش
     └─ کانال نوتیف: تلگرام / بله / هر دو
```

## مسیر مشتری

```
deep link → انتخاب دسته‌بندی → انتخاب سرویس
         → انتخاب تاریخ → انتخاب ساعت
         → توضیح/فایل (اختیاری)
         → ثبت درخواست
         → منتظر تایید آرایشگر
         → پرداخت بیعانه
         → تأیید نهایی
```

---

## State Machine رزرو

```
PENDING_REVIEW ──▶ REJECTED
               ──▶ APPROVED_AWAITING_DEPOSIT
                         │
                         ▼
                   PAYMENT_PENDING ──▶ CONFIRMED ──▶ COMPLETED
                         │                  │         NO_SHOW
                         │                  ▼
                         └──────▶ CANCELLATION_REQUESTED
                                        │
                               ┌────────┴────────┐
                               ▼                 ▼
                   CANCELLED_WITH_PENALTY  CANCELLED_WITHOUT_PENALTY
```

**اسلات قفل می‌شه فقط از `PAYMENT_PENDING` به بعد** — چند مشتری می‌توانند قبل از پرداخت همان زمان را درخواست کنند.

---

## ویژگی‌های کلیدی

### سینک بین تلگرام و بله

اگر آرایشگری با همان شماره روی هر دو پلتفرم وارد شود، یک رکورد واحد در دیتابیس دارد. `syncHairdresserPlatform` هنگام ثبت‌نام، `userId` و `chatId` پلتفرم جدید را به رکورد موجود اضافه می‌کند.

### کانال نوتیف

```
TELEGRAM_ONLY → فقط به telegramChatId پیام می‌رود
BALE_ONLY     → فقط به baleChatId پیام می‌رود
BOTH          → هر دو به صورت موازی
```

### تایید خودکار

وقتی `autoApproveBookings = true` روی آرایشگر فعال باشد، رزرو مستقیم وارد `CONFIRMED` می‌شود و نیازی به تایید دستی و پرداخت بیعانه نیست.

### Idempotency

- webhook: بر اساس `update_id` — هر update فقط یک بار side effect تولید می‌کند
- payment callback: بر اساس `providerReferenceId` — verify تکراری به `IGNORED_DUPLICATE` ثبت می‌شود
- reminder job: بر اساس `idempotencyKey = reminder:<bookingId>:<window>:<recipient>` — هر یادآوری فقط یک بار ارسال می‌شود

---

## متغیرهای محیطی

| متغیر | توضیح |
|-------|-------|
| `DATABASE_URL` | connection string PostgreSQL |
| `APP_BASE_URL` | آدرس پایه سرور (برای callback پرداخت) |
| `DEFAULT_TIMEZONE` | پیش‌فرض `Asia/Tehran` |
| `TELEGRAM_BOT_TOKEN` | توکن بات تلگرام |
| `TELEGRAM_BOT_USERNAME` | نام کاربری بات تلگرام |
| `TELEGRAM_WEBHOOK_SECRET` | secret header برای امنیت webhook |
| `BALE_BOT_TOKEN` | توکن بات بله |
| `BALE_BOT_USERNAME` | نام کاربری بات بله |
| `BALE_WEBHOOK_SECRET` | secret header برای امنیت webhook بله |
| `PAYMENT_PROVIDER_BASE_URL` | آدرس ZarinPal |
| `PAYMENT_PROVIDER_MERCHANT_ID` | merchant ID زرین‌پال |
| `PAYMENT_PROVIDER_CALLBACK_URL` | آدرس callback پرداخت |
| `PAYMENT_REQUEST_TIMEOUT_MINUTES` | TTL payment intent (پیش‌فرض 30) |
| `CRON_REMINDER_SECRET` | secret header برای job reminders |
| `BOOKING_SLOT_INTERVAL_MINUTES` | interval اسلات (پیش‌فرض 30) |

---

## اجرای Reminder Job

این job باید توسط یک cron service (مثل cron-job.org، Vercel Cron یا GitHub Actions) هر ۳۰ دقیقه فراخوانی شود:

```bash
curl -X POST https://your-domain.com/api/jobs/reminders/run \
  -H "x-job-secret: <CRON_REMINDER_SECRET>"
```

---

## مستندات بیشتر

| فایل | محتوا |
|------|-------|
| `docs/01-product-journeys.md` | مسیر کامل آرایشگر و مشتری (شامل auto-approve، رزرو موازی) |
| `docs/02-backend-phases.md` | مرحله‌بندی فازهای توسعه |
| `docs/03-domain-model.md` | مدل داده، state machine، قوانین availability و notification channel |
| `docs/04-bot-flows-and-states.md` | state‌ها، callback‌های بات و تنظیمات پیشرفته |
| `docs/05-api-and-integrations.md` | قرارداد API‌ها، Bale integration، multi-channel notifications |
