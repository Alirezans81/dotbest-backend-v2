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

ثبت آرایشگر با کمترین اصطکاک، ساخت هویت اصلی کسب‌وکار در سیستم، و تنظیم ساعت کاری هفتگی.

### دامنه

- `/start`
- دریافت شماره تماس
- ثبت نام آرایشگر
- ساخت `Hairdresser`
- ذخیره `telegramUserId` / `baleUserId` بسته به پلتفرم
- سینک حساب: اگر رکوردی با همان `phoneNumber` از پلتفرم دیگر موجود باشد، پلتفرم جدید به آن attach می‌شود
- تنظیم ساعت کاری هفتگی در جریان onboarding (قبل از دریافت لینک)

### خروجی‌های فنی

- route processing برای commandها و contact messageها
- stateهای onboarding آرایشگر (شامل `HD_WAIT_ONBOARDING_HOURS_CONFIRM/START/END`)
- validation شماره تماس
- `src/lib/sync.ts` — تابع `syncHairdresserPlatform`
- `src/lib/days.ts` — نگاشت روزهای هفته ایرانی به JS day (شنبه=اول)

### done criteria

- آرایشگر بتواند با شماره معتبر ثبت‌نام کند
- اگر کاربر قبلاً روی پلتفرم دیگر ثبت شده باشد، حساب‌ها merge شوند
- اگر کاربر قبلاً ثبت شده باشد، onboarding دوباره اجرا نشود
- آرایشگر در جریان onboarding ساعت کاری هر روز هفته را تنظیم کند
- لیست روزها از **شنبه** شروع شود
- `isOnboardingCompleted` فقط بعد از تکمیل تنظیم ساعت کاری `true` شود

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
- مشاهده فایل‌ها و توضیحات مشتری از داخل فلوی تایید (دکمه `📎 مشاهده توضیحات و فایل‌ها`)
- تایید یا رد
- ثبت quote min/max
- ثبت deposit دستی — **0 مجاز است:** اگر 0 وارد شود، رزرو مستقیم `CONFIRMED` می‌شود
- **تایید خودکار:** اگر `autoApproveBookings = true`، رزرو مستقیم `CONFIRMED` می‌شود

### خروجی‌های فنی

- actionهای approval/rejection
- `handleBookingAttachmentsCallback` — ارسال فایل‌های پیوست و توضیحات به آرایشگر
- تغییر وضعیت رزرو (APPROVED_AWAITING_DEPOSIT برای deposit > 0؛ CONFIRMED برای deposit = 0)
- `rejectConflictingBookings` هنگام تایید با deposit = 0 (مشابه auto-approve)
- پیام مشتری پس از تصمیم
- فیلد `autoApproveBookings` روی `Hairdresser`
- فیلد `isAutoApproved` روی `Booking`

### done criteria

- آرایشگر بتواند درخواست را تایید یا رد کند
- آرایشگر بتواند فایل‌های پیوست مشتری را از داخل فلوی تایید مشاهده کند
- quote و deposit برای رزرو تاییدشده ذخیره شوند
- اگر deposit = 0 وارد شود، رزرو مستقیم `CONFIRMED` شود و مشتری اطلاع‌رسانی شود
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

- نوبت‌های امروز (با علامت 📎 برای رزروهای دارای فایل/توضیح)
- **نوبت‌های آینده** — رزروهای از فردا به بعد، گروه‌بندی‌شده بر اساس تاریخ
- لیست مشتری‌ها
- history مشتری
- افزودن سرویس جدید
- مدیریت ساعت کاری و زمان‌های مسدود
- **تایید خودکار:** toggle فعال/غیرفعال
- **کانال نوتیف:** انتخاب تلگرام، بله یا هر دو

### خروجی‌های فنی

- queryهای برنامه روزانه + آینده
- `handleUpcomingMenu` در `schedule.ts` — نوبت‌های از فردا به بعد، گروه‌بندی‌شده بر اساس تاریخ
- دکمه 📎 در هر دو صفحه نوبت‌های امروز و آینده برای رزروهایی که فایل/توضیح دارند
- لیست مشتری‌های فعال
- entrypointهای تنظیمات
- callback `hd:settings:autoapprove:toggle`
- callbackهای `hd:settings:notif:menu` و `hd:settings:notif:set:<channel>`

### done criteria

- آرایشگر بتواند برنامه امروز را ببیند
- آرایشگر بتواند نوبت‌های آینده را گروه‌بندی‌شده بر اساس تاریخ ببیند
- در هر دو صفحه، رزروهایی که فایل/توضیح دارند با علامت 📎 مشخص باشند و دکمه مشاهده داشته باشند
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

## Phase 10: Wallet, Payments Refinement, And Admin Panel

### هدف

مدیریت مالی داخلی برای هر دو طرف، کارمزد درگاه، پنل ادمین برای برداشت‌ها، و ابزارهای تست.

### دامنه

- کیف پول برای آرایشگر و مشتری
- واریز بیعانه به کیف پول آرایشگر بعد از پرداخت
- اعمال قوانین کنسلی روی کیف پول‌ها (با/بدون جریمه)
- فلوی درخواست برداشت برای هر دو طرف (مبلغ، شبا، نام)
- پنل ادمین برای مشاهده و تایید/رد برداشت‌ها
- **نمایش تاریخ‌ها به تقویم شمسی (جلالی)** در تمام خروجی‌های بات
- نمایش جزئیات کامل رزرو هنگام بررسی درخواست جدید توسط آرایشگر
- منوی reply keyboard persistent برای هر دو طرف
- کارمزد درگاه پرداخت (`PAYMENT_GATEWAY_FEE_PERCENT`) با اعلام صریح به مشتری
- اسکریپت `db:reset` در package.json برای پاک‌سازی دیتابیس در محیط dev
- مشتری می‌تواند رزروهای فعالش را از منو ببیند

### خروجی‌های فنی

- مدل‌های `Wallet`, `WalletTransaction`, `WithdrawalRequest`
- `src/domain/wallet.ts` — `getOrCreateWallet`, `creditHairdresserDeposit`, `processPenaltyCancellation`, `processNopenaltyCancellation`, `requestWithdrawal`, `approveWithdrawal`, `rejectWithdrawal`
- `src/bot/handlers/shared/wallet.ts` — `showHairdresserWallet`, `showCustomerWallet`, `startWithdrawalFlow`, `handleWithdrawalAmount/Iban/Name`
- `src/bot/handlers/customer/bookings-list.ts` — `showCustomerBookings`
- stateهای `HD_WAIT_WITHDRAWAL_*` و `CUST_WAIT_WITHDRAWAL_*`
- callbackهای `hd:wallet:*` و `cust:wallet:*`
- دکمه `💰 کیف پول` در منوی reply آرایشگر
- منوی reply مشتری با دکمه‌های `📋 رزروهای من` و `💰 کیف پول`
- `app/admin/page.tsx` — پنل وب ادمین
- `app/api/admin/withdrawals/route.ts` و `/approve` و `/reject`
- `app/api/admin/reset-db/route.ts`
- `fetchZarinpalFee` در `src/domain/payment.ts` — کارمزد از API زرین‌پال با fallback به env var
- `formatJalaliDateTime` و `formatJalaliDate` در `src/lib/time.ts`

### done criteria

- بعد از پرداخت موفق، بیعانه به کیف پول آرایشگر اعتبار بگیرد
- کنسلی با جریمه: ۵۰٪ به مشتری برگردد، ۵۰٪ در کیف پول آرایشگر بماند
- کنسلی بدون جریمه: کل بیعانه به مشتری برگردد
- آرایشگر و مشتری بتوانند درخواست برداشت ثبت کنند
- ادمین بتواند از صفحه وب درخواست‌ها را تایید یا رد کند
- همه تاریخ‌ها در خروجی بات به شمسی نمایش داده شوند
- آرایشگر هنگام بررسی درخواست جزئیات کامل رزرو را ببیند
- منوی reply keyboard همیشه پایین صفحه نمایش داشته باشد
- کارمزد درگاه در صورت وجود به مشتری اعلام شود
- `pnpm db:reset` (یا `npm run db:reset`) دیتابیس را پاک و schema را اعمال کند
- مشتری بتواند رزروهای فعالش را از منو ببیند

## ترتیب تحویل پیشنهادی

1. فاز 1 تا 3
2. فاز 4 و 5
3. فاز 6
4. فاز 7
5. فاز 8 و 9
6. فاز 10

## سناریوهای پذیرش بین‌فازی

- بعد از فاز 3، آرایشگر باید onboarding و تعریف سرویس را کامل کرده باشد
- بعد از فاز 5، مشتری باید بتواند درخواست ثبت کند و آرایشگر آن را تصمیم‌گیری کند
- بعد از فاز 6، رزرو باید به انتها تا `CONFIRMED` برسد — با auto-reject رقبا
- بعد از فاز 7، reminder و cancellation باید قابل اتکا باشند و روی پلتفرم درست برسند
- بعد از فاز 9، سیستم باید برای تست end-to-end روی هر دو پلتفرم آماده باشد
- بعد از فاز 10، کیف پول‌ها کار کنند، ادمین بتواند برداشت‌ها را مدیریت کند، و همه تاریخ‌ها شمسی نمایش داده شوند
