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
- **Next.js 16** — App Router, Route Handlers (`app/api/**/route.ts`)
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
| `GET` | `/api/admin/withdrawals` | لیست درخواست‌های برداشت |
| `POST` | `/api/admin/withdrawals` | تایید/رد درخواست برداشت |
| `GET` | `/api/admin/withdrawals/approve` | تایید سریع (redirect) |
| `GET` | `/api/admin/withdrawals/reject` | رد سریع (redirect) |
| `GET` | `/admin` | پنل وب ادمین |

---

## ساختار پروژه

```
prisma/
  schema.prisma          ← همه مدل‌ها + enum‌ها

src/
  lib/
    prisma.ts            ← Prisma client singleton
    time.ts              ← توابع timezone + تاریخ شمسی (Jalali)
    slug.ts              ← slug و idempotency key
    phone.ts             ← نرمال‌سازی شماره +98
    sync.ts              ← سینک حساب بین تلگرام و بله
    days.ts              ← نگاشت روزهای هفته ایرانی (شنبه=اول) به JS day

  bot/
    states.ts            ← HairdresserState / CustomerState enums
    session.ts           ← ConversationSession manager (30 min TTL)
    dispatcher.ts        ← router اصلی updates
    notify.ts            ← ارسال نوتیف چندکاناله

    telegram/
      client.ts          ← Bot API client + reply keyboard menus (persistent)
      types.ts           ← Telegram types

    handlers/
      hairdresser/
        onboarding.ts    ← /start، ثبت شماره، نام، اولین سرویس، تنظیم ساعت کاری
        services.ts      ← افزودن دسته‌بندی و سرویس
        booking-review.ts ← تایید/رد رزرو + quote + deposit (0 = بدون بیعانه) + مشاهده فایل‌ها/توضیحات
        schedule.ts      ← نوبت‌های امروز، نوبت‌های آینده، مشتریان، ساعت کاری، تنظیمات

      customer/
        booking.ts       ← جریان کامل رزرو (deep link → submit)
        payment.ts       ← پرداخت، لغو + اعمال wallet transactions
        bookings-list.ts ← نمایش رزروهای فعال مشتری

      shared/
        wallet.ts        ← نمایش کیف پول + فلوی برداشت (مشترک بین دو طرف)

  domain/
    availability.ts      ← محاسبه اسلات‌های خالی (14 روز)
    payment.ts           ← initiate + verify + auto-reject + کارمزد درگاه
    wallet.ts            ← کیف پول: واریز بیعانه، کنسلی، برداشت

  jobs/
    reminders.ts         ← job یادآوری (24h و 2h)

app/
  admin/page.tsx         ← پنل وب ادمین (مدیریت درخواست‌های برداشت)

  api/
    health/route.ts
    telegram/webhook/route.ts
    bale/webhook/route.ts
    payments/{initiate,callback,verify}/route.ts
    jobs/reminders/run/route.ts
    admin/
      withdrawals/route.ts          ← لیست + تایید/رد (POST)
      withdrawals/approve/route.ts  ← تایید سریع (GET + redirect)
      withdrawals/reject/route.ts   ← رد سریع (GET + redirect)
```

---

## مسیر آرایشگر

```
/start
  ↓ ارسال شماره تماس
  ↓ ارسال نام
  ↓ تعریف دسته‌بندی اول
  ↓ تعریف سرویس اول (مدت + قیمت)
  ↓ تنظیم ساعت کاری (شنبه تا جمعه — هر روز: بله/تعطیل + ساعت)
  ↓ دریافت لینک اختصاصی: t.me/bot?start=hd_<slug>

منوی اصلی (persistent پایین صفحه):
  📅 نوبت‌های امروز
  📆 نوبت‌های آینده   ← رزروهای تاییدشده/در انتظار از فردا به بعد، گروه‌بندی‌شده بر اساس تاریخ
  👥 مشتریان
  ➕ سرویس جدید
  ⚙️ تنظیمات
     ├─ ساعت کاری
     ├─ زمان مسدود
     ├─ تایید خودکار: روشن/خاموش
     ├─ بیعانه خودکار: مبلغ ثابت (فقط وقتی تایید خودکار روشنه)
     └─ کانال نوتیف: تلگرام / بله / هر دو
  💰 کیف پول
     ├─ موجودی کل / قفل‌شده / قابل برداشت
     └─ درخواست برداشت (شبا + نام صاحب حساب)
```

## مسیر مشتری

```
deep link → انتخاب دسته‌بندی → انتخاب سرویس
         → انتخاب تاریخ (شمسی با نام روز: «یکشنبه، ۱۰ خرداد ۱۴۰۵») → انتخاب ساعت
         → توضیح/فایل (اختیاری)
         → ثبت درخواست
         → منتظر تایید آرایشگر
         → پرداخت بیعانه (+ کارمزد درگاه در صورت تنظیم)
         → تأیید نهایی

منوی پایین (persistent):
  📋 رزروهای من  ← رزروهای فعال + دکمه‌های پرداخت/لغو
  💰 کیف پول    ← موجودی + درخواست برداشت
```

---

## State Machine رزرو

```
PENDING_REVIEW ──▶ REJECTED
               ──▶ CONFIRMED ◀─────────────────── تایید دستی با بیعانه 0
               ──▶ APPROVED_AWAITING_DEPOSIT ◀──── تایید دستی + auto-approve با deposit ثابت
                         │
                         ▼
                   PAYMENT_PENDING ──▶ CONFIRMED ──▶ COMPLETED
                         │           ▲     │         NO_SHOW
                         │           │     ▼
                         │   auto-approve  CANCELLATION_REQUESTED
                         │   (بدون deposit)      │
                         │                ┌───────┴───────┐
                         └──────▶         ▼               ▼
                         CANCELLED_WITH_PENALTY  CANCELLED_WITHOUT_PENALTY
```

**اسلات قفل می‌شه فقط از `PAYMENT_PENDING` به بعد** — چند مشتری می‌توانند قبل از پرداخت همان زمان را درخواست کنند.

---

## ویژگی‌های کلیدی

### تاریخ شمسی

همه تاریخ‌ها در خروجی بات به **تقویم جلالی (شمسی)** نمایش داده می‌شوند. زمان‌ها در UTC ذخیره و در `Asia/Tehran` تفسیر می‌شوند.

### کیف پول داخلی

هر آرایشگر و مشتری یک کیف پول دارد:
- بعد از پرداخت موفق، بیعانه به کیف پول **آرایشگر** واریز می‌شود
- کنسلی با جریمه: ۵۰٪ به مشتری برمی‌گردد، ۵۰٪ در کیف پول آرایشگر می‌ماند
- کنسلی بدون جریمه: کل بیعانه به کیف پول **مشتری** برمی‌گردد
- هر دو طرف می‌توانند درخواست برداشت ثبت کنند (تایید ادمین لازم است)
- **موجودی قفل‌شده آرایشگر:** بیعانه رزروهای `CONFIRMED` که هنوز وقتشان نرسیده قابل برداشت نیست؛ فقط موجودی آزاد (کل منهای قفل‌شده) قابل برداشت است

### پنل ادمین

صفحه `/admin?secret=<ADMIN_SECRET>` برای مدیریت درخواست‌های برداشت — تایید یا رد با یک کلیک.

### کارمزد درگاه پرداخت

قبل از ساخت payment intent، کارمزد از API زرین‌پال (`feeCalculation`) واکشی می‌شود. کارمزد به مبلغ پرداختی اضافه و به مشتری اعلام می‌شود. اگر API در دسترس نبود، fallback به `PAYMENT_GATEWAY_FEE_PERCENT`. مبلغ واریزی به کیف پول آرایشگر همان بیعانه بدون کارمزد است.

### سینک بین تلگرام و بله

اگر آرایشگری با همان شماره روی هر دو پلتفرم وارد شود، یک رکورد واحد در دیتابیس دارد. `syncHairdresserPlatform` هنگام ثبت‌نام، `userId` و `chatId` پلتفرم جدید را به رکورد موجود اضافه می‌کند.

### کانال نوتیف

```
TELEGRAM_ONLY → فقط به telegramChatId پیام می‌رود
BALE_ONLY     → فقط به baleChatId پیام می‌رود
BOTH          → هر دو به صورت موازی
```

### تایید خودکار

وقتی `autoApproveBookings = true` فعال باشد، دو حالت:
- **بدون بیعانه ثابت:** رزرو مستقیم `CONFIRMED` می‌شود، هیچ پرداختی نیاز نیست
- **با بیعانه ثابت (`autoApproveDeposit > 0`):** رزرو `APPROVED_AWAITING_DEPOSIT` می‌شود، مشتری باید مبلغ ثابت را بپردازد تا نوبت نهایی شود؛ `quotedMin/Max` برابر قیمت سرویس است

مبلغ بیعانه ثابت از منوی تنظیمات → «💵 بیعانه خودکار» قابل تنظیم است.

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
| `PAYMENT_GATEWAY_FEE_PERCENT` | fallback درصد کارمزد اگر API زرین‌پال در دسترس نباشد؛ پیش‌فرض `0` |
| `CRON_REMINDER_SECRET` | secret header برای job reminders |
| `BOOKING_SLOT_INTERVAL_MINUTES` | interval اسلات (پیش‌فرض 30) |
| `ADMIN_SECRET` | secret برای احراز هویت پنل ادمین |

---

## اجرای Reminder Job

این job باید توسط یک cron service (مثل cron-job.org، Vercel Cron یا GitHub Actions) هر ۳۰ دقیقه فراخوانی شود:

```bash
curl -X POST https://your-domain.com/api/jobs/reminders/run \
  -H "x-job-secret: <CRON_REMINDER_SECRET>"
```

---

## ریست دیتابیس (فقط dev)

برای پاک‌سازی کامل دیتابیس در محیط تست:

```bash
npm run db:reset
# یا
pnpm db:reset
```

این دستور از `prisma migrate reset --force` استفاده می‌کند — دیتابیس drop و recreate شده و همه migrationها اعمال می‌شوند.

---

## مستندات بیشتر

| فایل | محتوا |
|------|-------|
| `docs/01-product-journeys.md` | مسیر کامل آرایشگر و مشتری (شامل onboarding ساعت کاری، auto-approve، رزرو موازی) |
| `docs/02-backend-phases.md` | مرحله‌بندی فازهای توسعه |
| `docs/03-domain-model.md` | مدل داده، state machine، نگاشت روزهای هفته ایرانی، قوانین availability |
| `docs/04-bot-flows-and-states.md` | state‌ها، callback‌های بات، تنظیمات پیشرفته، payload‌های onboarding |
| `docs/05-api-and-integrations.md` | قرارداد API‌ها، Bale integration، multi-channel notifications |
