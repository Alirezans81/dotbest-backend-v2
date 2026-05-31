# Backend Phases

این سند مرحله‌بندی فنی بک‌اند را مشخص می‌کند. هر فاز باید مستقل، قابل تست و قابل تحویل باشد و خروجی هر فاز ورودی مستقیم فاز بعدی باشد.

## Phase 1: Foundation

### هدف

بستن قراردادهای پایه برای معماری، naming، timezone، money convention و مسیر داکیومنت‌ها.

### خروجی‌ها

- انتخاب `Next.js 16 Route Handlers` به‌عنوان سطح API
- تعریف `PostgreSQL + Prisma` به‌عنوان data layer
- قفل شدن timezone روی `Asia/Tehran`
- قفل شدن storage پول روی `integer Toman`
- تعریف status و event naming
- پشتیبانی از دو پلتفرم: تلگرام و بله (هر دو با همان Bot API)

### done criteria

- داک‌های محصول و بک‌اند کامل شده باشند
- endpoint map مشخص شده باشد
- status machine رزرو نهایی شده باشد

## Phase 2: Hairdresser Onboarding

### هدف

ثبت آرایشگر با کمترین اصطکاک و ساخت هویت اصلی کسب‌وکار در سیستم.

### دامنه

- `/start`
- دریافت شماره تماس
- ثبت نام آرایشگر
- ساخت `Hairdresser`
- ذخیره `telegramUserId` / `baleUserId` بسته به پلتفرم
- سینک حساب: اگر رکوردی با همان `phoneNumber` از پلتفرم دیگر موجود باشد، پلتفرم جدید به آن attach می‌شود

### خروجی‌های فنی

- route processing برای commandها و contact messageها
- stateهای onboarding آرایشگر
- validation شماره تماس
- `src/lib/sync.ts` — تابع `syncHairdresserPlatform`

### done criteria

- آرایشگر بتواند با شماره معتبر ثبت‌نام کند
- اگر کاربر قبلاً روی پلتفرم دیگر ثبت شده باشد، حساب‌ها merge شوند
- اگر کاربر قبلاً ثبت شده باشد، onboarding دوباره اجرا نشود

## Phase 3: Service Catalog And Booking Link

### هدف

تعریف خدمات و ساخت لینک اختصاصی رزرو برای هر آرایشگر.

### دامنه

- ساخت category
- ساخت service
- تعیین duration و price range
- تولید deep link اختصاصی

### خروجی‌های فنی

- مدل‌های `ServiceCategory` و `Service`
- slug یکتا برای رزرو
- callback flow برای افزودن سرویس جدید

### done criteria

- آرایشگر بتواند حداقل یک دسته‌بندی و یک سرویس بسازد
- لینک رزرو یکتا برای هر آرایشگر تولید شود

## Phase 4: Customer Booking Request Flow

### هدف

مشتری بتواند از لینک رزرو وارد شود و درخواست ثبت کند.

### دامنه

- ورود از deep link (تلگرام یا بله)
- انتخاب category و service
- نمایش slotهای خالی
- ثبت توضیح و attachment
- ساخت booking در وضعیت `PENDING_REVIEW`

### خروجی‌های فنی

- محاسبه availability با `SLOT_BLOCKING_STATUSES = [PAYMENT_PENDING, CONFIRMED]`
- رزروهای `PENDING_REVIEW` و `APPROVED_AWAITING_DEPOSIT` اسلات را مسدود **نمی‌کنند**
- چند مشتری می‌توانند همزمان یک اسلات را درخواست دهند
- ساخت `Booking` و `BookingAttachment`
- session flow مشتری با فیلد `platform`

### done criteria

- مشتری بتواند یک درخواست کامل ثبت کند
- چند مشتری بتوانند همزمان برای یک اسلات درخواست ثبت کنند
- اسلات **هنوز** قفل نشود

## Phase 5: Approval, Quote, And Deposit

### هدف

آرایشگر درخواست جدید را بررسی کند و با quote و deposit به مشتری برگرداند — یا با تایید خودکار بدون دخالت.

### دامنه

- دریافت درخواست جدید توسط آرایشگر
- تایید یا رد
- ثبت quote min/max
- ثبت deposit دستی
- **تایید خودکار:** اگر `autoApproveBookings = true`، رزرو مستقیم `CONFIRMED` می‌شود

### خروجی‌های فنی

- actionهای approval/rejection
- تغییر وضعیت رزرو
- پیام مشتری پس از تصمیم
- فیلد `autoApproveBookings` روی `Hairdresser`
- فیلد `isAutoApproved` روی `Booking`

### done criteria

- آرایشگر بتواند درخواست را تایید یا رد کند
- quote و deposit برای رزرو تاییدشده ذخیره شوند
- اگر تایید خودکار فعال باشد، رزرو بدون دخالت آرایشگر `CONFIRMED` شود

## Phase 6: Payment Verification And Booking Confirmation

### هدف

تبدیل رزرو تاییدشده به رزرو قطعی بعد از پرداخت بیعانه — و قفل اسلات با auto-reject رزروهای رقیب.

### دامنه

- ایجاد payment intent
- redirect به درگاه
- دریافت callback
- verify payment
- تغییر وضعیت به `CONFIRMED`
- **auto-reject:** هنگام `PAYMENT_PENDING`، تمام رزروهای `PENDING_REVIEW`/`APPROVED_AWAITING_DEPOSIT` روی همان اسلات رد می‌شوند

### خروجی‌های فنی

- endpointهای initiate, callback, verify
- مدل‌های `PaymentIntent` و `PaymentTransaction`
- idempotency برای callback و verify
- `getConflictingPendingBookings` در `src/domain/availability.ts`
- اجرای auto-reject داخل `prisma.$transaction`
- نوتیف به مشتریان رد شده

### done criteria

- پرداخت موفق فقط یک‌بار رزرو را نهایی کند
- خطای verify رزرو را به وضعیت اشتباه نبرد
- هنگام initiate، رزروهای رقیب به‌صورت اتمیک رد شوند

## Phase 7: Reminders And Cancellation Handling

### هدف

پوشش یادآوری‌ها و منطق کنسلی قبل از نوبت.

### دامنه

- reminder خودکار برای رزروهای `CONFIRMED`
- درخواست کنسلی
- اعمال جریمه `50%` بعد از پرداخت
- آزادسازی اسلات پس از کنسلی
- ارسال reminder بر اساس `notificationChannel` هر کاربر

### خروجی‌های فنی

- endpoint job برای reminder
- استفاده از `notifyHairdresser` و `notifyCustomer` از `src/bot/notify.ts`
- notification templateها
- state transition برای cancellation

### done criteria

- reminder فقط برای رزروهای معتبر ارسال شود
- reminder روی پلتفرم(های) ترجیحی کاربر ارسال شود
- کنسلی با جریمه و بدون جریمه درست تفکیک شود

## Phase 8: Daily Operations And Customer History

### هدف

دادن ابزار روزمره به آرایشگر برای کار با رزروها، مشتری‌ها و تنظیمات پیشرفته.

### دامنه

- نوبت‌های امروز
- لیست مشتری‌ها
- history مشتری
- افزودن سرویس جدید
- مدیریت ساعت کاری و زمان‌های مسدود
- **تایید خودکار:** toggle فعال/غیرفعال
- **کانال نوتیف:** انتخاب تلگرام، بله یا هر دو

### خروجی‌های فنی

- queryهای برنامه روزانه
- لیست مشتری‌های فعال
- entrypointهای تنظیمات
- callback `hd:settings:autoapprove:toggle`
- callbackهای `hd:settings:notif:menu` و `hd:settings:notif:set:<channel>`

### done criteria

- آرایشگر بتواند برنامه امروز را ببیند
- بتواند سابقه ساده هر مشتری را مشاهده کند
- بتواند تایید خودکار را روشن/خاموش کند
- بتواند کانال دریافت نوتیف را انتخاب کند

## Phase 9: Hardening, Observability, And Admin Safeguards

### هدف

قابل اتکا کردن سیستم برای استفاده واقعی روی هر دو پلتفرم.

### دامنه

- idempotency webhook تلگرام و بله (بر اساس `update_id`)
- idempotency callback درگاه (بر اساس `providerReferenceId`)
- retry-safe notification (بر اساس `idempotencyKey`)
- structured logging
- healthcheck
- safe defaults برای jobها و payment timeout

### خروجی‌های فنی

- endpoint `GET /api/health`
- log structure برای update, booking, payment, reminder
- guardrail برای اجرای تکراری jobها

### done criteria

- رویدادهای تکراری side effect دوباره تولید نکنند
- سیستم حداقل health و observability پایه داشته باشد

## ترتیب تحویل پیشنهادی

1. فاز 1 تا 3
2. فاز 4 و 5
3. فاز 6
4. فاز 7
5. فاز 8 و 9

## سناریوهای پذیرش بین‌فازی

- بعد از فاز 3، آرایشگر باید onboarding و تعریف سرویس را کامل کرده باشد
- بعد از فاز 5، مشتری باید بتواند درخواست ثبت کند و آرایشگر آن را تصمیم‌گیری کند
- بعد از فاز 6، رزرو باید به انتها تا `CONFIRMED` برسد — با auto-reject رقبا
- بعد از فاز 7، reminder و cancellation باید قابل اتکا باشند و روی پلتفرم درست برسند
- بعد از فاز 9، سیستم باید برای تست end-to-end روی هر دو پلتفرم آماده باشد
