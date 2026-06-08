# Domain Model

این سند مدل دامنه بک‌اند را برای MVP رزرو مشخص می‌کند. هدف این است که پیاده‌سازی Prisma و منطق route handlerها بدون تصمیم‌گیری اضافه قابل شروع باشد.

## اصول مدل

- کلیدهای اصلی به صورت opaque string و ترجیحاً `cuid()` تولید شوند.
- همه timestampها در دیتابیس به UTC ذخیره شوند و در لایه نمایش به `Asia/Tehran` تبدیل شوند.
- همه تاریخ‌ها در خروجی کاربر به **تقویم شمسی (جلالی)** نمایش داده می‌شوند (`src/lib/time.ts`).
- همه مبالغ به صورت `Int` و با واحد `Toman` ذخیره شوند.
- هیچ مبلغی با `float` ذخیره نشود.
- duration سرویس فقط مضرب `30` دقیقه باشد.
- هر موجودیت می‌تواند به هر دو پلتفرم (تلگرام و بله) به‌صورت همزمان لینک باشد.

## موجودیت‌ها

## Hairdresser

نماینده کسب‌وکار اصلی در MVP است.

### فیلدهای اصلی

- `id`
- `telegramUserId` — nullable، یکتا
- `telegramChatId` — nullable، یکتا
- `baleUserId` — nullable، یکتا
- `baleChatId` — nullable، یکتا
- `fullName`
- `phoneNumber` — یکتا (کلید اتصال بین پلتفرم‌ها)
- `bookingSlug`
- `timezone`
- `isOnboardingCompleted`
- `autoApproveBookings` — پیش‌فرض `false`
- `autoApproveDeposit` — nullable؛ اگر مقدار داشته باشد، رزروهای خودکار نیاز به پرداخت این مبلغ دارند
- `notificationChannel` — پیش‌فرض بر اساس پلتفرم ثبت‌نام: `BALE_ONLY` اگر از بله، `TELEGRAM_ONLY` اگر از تلگرام
- `createdAt`
- `updatedAt`

### قواعد

- `phoneNumber` یکتا است و کلید سینک حساب بین پلتفرم‌هاست.
- `bookingSlug` یکتا است.
- هر اکانت فقط یک `Hairdresser` دارد.
- اگر آرایشگر روی هر دو پلتفرم فعال باشد، هر چهار فیلد `telegramUserId`, `telegramChatId`, `baleUserId`, `baleChatId` پر می‌شوند.

## Customer

نماینده مشتری نهایی است که از طریق لینک رزرو وارد می‌شود.

### فیلدهای اصلی

- `id`
- `telegramUserId` — nullable، یکتا
- `telegramChatId` — nullable، یکتا
- `baleUserId` — nullable، یکتا
- `baleChatId` — nullable، یکتا
- `fullName`
- `username`
- `phoneNumber` — nullable، یکتا
- `notificationChannel` — پیش‌فرض `TELEGRAM_ONLY`
- `createdAt`
- `updatedAt`

### قواعد

- `phoneNumber` در صورت وجود یکتا است و می‌تواند کلید سینک بین پلتفرم‌ها باشد.
- مشتریان بدون شماره، رکوردهای مستقل روی هر پلتفرم دارند.
- `notificationChannel` می‌تواند توسط مشتری (در صورت پیاده‌سازی تنظیمات) یا سیستم تغییر کند.

## ServiceCategory

دسته‌بندی خدمات برای یک آرایشگر خاص.

### فیلدهای اصلی

- `id`
- `hairdresserId`
- `title`
- `sortOrder`
- `isActive`
- `createdAt`
- `updatedAt`

## Service

خدمت قابل رزرو.

### فیلدهای اصلی

- `id`
- `hairdresserId`
- `categoryId`
- `title`
- `durationMinutes`
- `priceMinToman`
- `priceMaxToman`
- `isActive`
- `createdAt`
- `updatedAt`

### قواعد

- `durationMinutes` باید مضرب 30 باشد.
- `priceMinToman <= priceMaxToman`

## WorkingHours

برنامه کاری پایه آرایشگر. در جریان onboarding تنظیم می‌شود.

### فیلدهای اصلی

- `id`
- `hairdresserId`
- `dayOfWeek`
- `startMinuteOfDay`
- `endMinuteOfDay`
- `isActive`
- `createdAt`
- `updatedAt`

### قواعد

- `dayOfWeek` از مقادیر JS Date استفاده می‌کند: `0=یکشنبه، 1=دوشنبه، 2=سه‌شنبه، 3=چهارشنبه، 4=پنجشنبه، 5=جمعه، 6=شنبه`
- **نمایش** به کاربر از شنبه شروع می‌شود (`src/lib/days.ts`)؛ **ذخیره‌سازی** با همان مقادیر JS
- `startMinuteOfDay < endMinuteOfDay`
- بازه‌ها نباید برای یک روز overlap داشته باشند

### ترتیب نمایش هفته ایرانی

| ترتیب نمایش | نام | مقدار `dayOfWeek` در DB |
|---|---|---|
| 1 | شنبه | 6 |
| 2 | یکشنبه | 0 |
| 3 | دوشنبه | 1 |
| 4 | سه‌شنبه | 2 |
| 5 | چهارشنبه | 3 |
| 6 | پنجشنبه | 4 |
| 7 | جمعه | 5 |

## BlockedTime

بازه زمانی که نباید رزرو شود.

### فیلدهای اصلی

- `id`
- `hairdresserId`
- `startsAt`
- `endsAt`
- `reason`
- `createdAt`
- `updatedAt`

### قواعد

- `startsAt < endsAt`
- هر بازه مسدود باید در timezone آرایشگر تفسیر شود

## Booking

هسته اصلی دامنه رزرو.

### فیلدهای اصلی

- `id`
- `hairdresserId`
- `customerId`
- `serviceId`
- `status`
- `requestedStartAt`
- `requestedEndAt`
- `customerDescription`
- `quotedMinPriceToman`
- `quotedMaxPriceToman`
- `depositAmountToman`
- `cancelPenaltyPercent`
- `rejectionReason`
- `isAutoApproved` — آیا رزرو توسط سیستم (نه آرایشگر) تأیید شده
- `approvedAt`
- `confirmedAt`
- `cancelledAt`
- `completedAt`
- `createdAt`
- `updatedAt`

### قواعد

- `requestedEndAt` از `requestedStartAt + service.duration` مشتق می‌شود
- `cancelPenaltyPercent` در MVP پیش‌فرض `50` است
- `depositAmountToman` فقط در رزرو تاییدشده (دستی) مقدار می‌گیرد
- اگر `isAutoApproved = true` و `autoApproveDeposit = null/0`، رزرو مستقیم `CONFIRMED` است
- اگر `isAutoApproved = true` و `autoApproveDeposit > 0`، رزرو به `APPROVED_AWAITING_DEPOSIT` می‌رود و مشتری باید بیعانه ثابت بپردازد
- رزروهای `PENDING_REVIEW` و `APPROVED_AWAITING_DEPOSIT` اسلات را قفل **نمی‌کنند**
- رزروهای `PAYMENT_PENDING` و `CONFIRMED` اسلات را قفل **می‌کنند**

## BookingAttachment

فایل‌های مرتبط با رزرو.

### فیلدهای اصلی

- `id`
- `bookingId`
- `type`
- `telegramFileId`
- `telegramFileUniqueId`
- `caption`
- `sortOrder`
- `createdAt`

### قواعد

- در MVP فقط `IMAGE` و `VIDEO` پشتیبانی می‌شوند
- فایل واقعی در storage داخلی کپی نمی‌شود

## PaymentIntent

نماینده تلاش پرداخت برای یک رزرو.

### فیلدهای اصلی

- `id`
- `bookingId`
- `status`
- `provider`
- `amountToman`
- `providerAuthority`
- `redirectUrl`
- `callbackUrl`
- `expiresAt`
- `initiatedAt`
- `verifiedAt`
- `createdAt`
- `updatedAt`

### قواعد

- فقط برای bookingهای `APPROVED_AWAITING_DEPOSIT` ساخته می‌شود
- بعد از initiate، booking وارد `PAYMENT_PENDING` می‌شود
- هنگام ورود به `PAYMENT_PENDING`، رزروهای رقیب (`PENDING_REVIEW`/`APPROVED_AWAITING_DEPOSIT`) روی همان اسلات به‌صورت اتمیک رد می‌شوند
- اگر intent منقضی شود، booking به `APPROVED_AWAITING_DEPOSIT` برمی‌گردد

## PaymentTransaction

ثبت کامل درخواست‌ها و پاسخ‌های provider.

### فیلدهای اصلی

- `id`
- `paymentIntentId`
- `transactionType`
- `status`
- `providerReferenceId`
- `providerRawPayload`
- `amountToman`
- `createdAt`

### قواعد

- هر verify موفق باید `providerReferenceId` یکتا داشته باشد
- این جدول پایه idempotency payment callback است

## NotificationLog

ثبت پیام‌های خروجی برای مشتری و آرایشگر.

### فیلدهای اصلی

- `id`
- `bookingId`
- `recipientType`
- `recipientChatId`
- `channel`
- `templateKey`
- `idempotencyKey`
- `status`
- `scheduledFor`
- `sentAt`
- `errorMessage`
- `createdAt`
- `updatedAt`

### قواعد

- `channel` می‌تواند `TELEGRAM` یا `BALE` باشد
- `idempotencyKey` برای جلوگیری از ارسال تکراری استفاده می‌شود

## Wallet

کیف پول هر کاربر (آرایشگر یا مشتری) برای نگهداری موجودی و ثبت تراکنش‌ها.

### فیلدهای اصلی

- `id`
- `ownerType` — `HAIRDRESSER` یا `CUSTOMER`
- `hairdresserId` — nullable، یکتا
- `customerId` — nullable، یکتا
- `balanceToman` — موجودی جاری (Int، پیش‌فرض 0)
- `createdAt`
- `updatedAt`

### قواعد

- هر آرایشگر و مشتری حداکثر یک کیف پول دارد (upsert)
- `balanceToman` نباید منفی شود (بررسی قبل از برداشت)
- کیف پول هنگام اولین نیاز به‌صورت خودکار ساخته می‌شود (`getOrCreateWallet`)

## WalletTransaction

ثبت تک‌تک تراکنش‌های کیف پول.

### فیلدهای اصلی

- `id`
- `walletId`
- `type` — نوع تراکنش (`WalletTransactionType`)
- `amountToman` — مثبت برای واریز، منفی برای کسر
- `bookingId` — nullable، مرتبط با رزرو
- `description`
- `createdAt`

### قواعد

- هر تراکنش با `balanceToman` روی `Wallet` به‌صورت اتمیک به‌روز می‌شود
- تراکنش‌ها immutable هستند

## WithdrawalRequest

درخواست برداشت از کیف پول.

### فیلدهای اصلی

- `id`
- `walletId`
- `amountToman`
- `status` — `PENDING`, `APPROVED`, `REJECTED`
- `iban` — شماره شبا
- `accountHolder` — نام صاحب حساب
- `adminNote` — nullable، یادداشت ادمین
- `requestedAt`
- `resolvedAt` — nullable
- `createdAt`
- `updatedAt`

### قواعد

- درخواست برداشت فقط اگر `balanceToman >= amountToman` باشد پذیرفته می‌شود
- `amountToman > 0`
- هر درخواست باید شبا معتبر (`IR` + 24 رقم) داشته باشد
- بعد از تایید ادمین، موجودی کیف پول با `WITHDRAWAL_DEBIT` کسر می‌شود
- رد کردن درخواست تأثیری روی موجودی ندارد
- ادمین می‌تواند یادداشت اضافه کند

## ConversationSession

state گفت‌وگو در تلگرام یا بله برای هر actor.

### فیلدهای اصلی

- `id`
- `actorType`
- `platform` — مقدار `TELEGRAM` یا `BALE`، پیش‌فرض `TELEGRAM`
- `hairdresserId`
- `customerId`
- `telegramChatId` — chatId پلتفرم مرتبط (بدون توجه به نام فیلد)
- `state`
- `payload`
- `expiresAt`
- `lastInteractionAt`
- `createdAt`
- `updatedAt`

### قواعد

- در هر chat فقط یک session active وجود دارد
- `payload` برای نگهداری draft flow استفاده می‌شود
- session بعد از `30` دقیقه inactivity منقضی می‌شود
- `platform` مشخص می‌کند این session از تلگرام آمده یا بله

## relationها

- `Hairdresser` یک به چند با `ServiceCategory`
- `Hairdresser` یک به چند با `Service`
- `Hairdresser` یک به چند با `WorkingHours`
- `Hairdresser` یک به چند با `BlockedTime`
- `Hairdresser` یک به چند با `Booking`
- `Hairdresser` یک به یک با `Wallet`
- `Customer` یک به چند با `Booking`
- `Customer` یک به یک با `Wallet`
- `ServiceCategory` یک به چند با `Service`
- `Service` یک به چند با `Booking`
- `Booking` یک به چند با `BookingAttachment`
- `Booking` یک به چند با `PaymentIntent`
- `Booking` یک به چند با `WalletTransaction`
- `PaymentIntent` یک به چند با `PaymentTransaction`
- `Booking` یک به چند با `NotificationLog`
- `Wallet` یک به چند با `WalletTransaction`
- `Wallet` یک به چند با `WithdrawalRequest`

## enumها

## WalletOwnerType

- `HAIRDRESSER`
- `CUSTOMER`

## WalletTransactionType

- `DEPOSIT_CREDIT` — آرایشگر: دریافت بیعانه از پرداخت مشتری
- `REFUND_DEBIT` — آرایشگر: برگشت بیعانه به مشتری (کنسل بدون جریمه)
- `PENALTY_CREDIT` — آرایشگر: نگه‌داشتن ۵۰٪ جریمه کنسلی (ثبت اطلاعاتی، موجودی تغییر نمی‌کند)
- `REFUND_CREDIT` — مشتری: دریافت برگشت پول از کنسلی
- `WITHDRAWAL_DEBIT` — هر دو: برداشت تایید‌شده توسط ادمین

## WithdrawalStatus

- `PENDING` — در انتظار بررسی ادمین
- `APPROVED` — تایید و واریز شده
- `REJECTED` — رد شده

## BookingStatus

- `PENDING_REVIEW`
- `REJECTED`
- `APPROVED_AWAITING_DEPOSIT`
- `PAYMENT_PENDING`
- `CONFIRMED`
- `CANCELLATION_REQUESTED`
- `CANCELLED_WITH_PENALTY`
- `CANCELLED_WITHOUT_PENALTY`
- `COMPLETED`
- `NO_SHOW`

## BookingAttachmentType

- `IMAGE`
- `VIDEO`

## PaymentIntentStatus

- `INITIATED`
- `REDIRECTED`
- `VERIFY_PENDING`
- `VERIFIED`
- `FAILED`
- `EXPIRED`
- `REFUNDED_PARTIAL`
- `REFUNDED_FULL`

## PaymentTransactionType

- `INITIATE_REQUEST`
- `INITIATE_RESPONSE`
- `VERIFY_REQUEST`
- `VERIFY_RESPONSE`
- `REFUND_REQUEST`
- `REFUND_RESPONSE`

## PaymentTransactionStatus

- `SUCCESS`
- `FAILED`
- `IGNORED_DUPLICATE`

## NotificationStatus

- `PENDING`
- `SENT`
- `FAILED`
- `SKIPPED_DUPLICATE`

## NotificationChannel

- `TELEGRAM_ONLY` — پیش‌فرض
- `BALE_ONLY`
- `BOTH`

## RecipientType

- `HAIRDRESSER`
- `CUSTOMER`

## ConversationActorType

- `HAIRDRESSER`
- `CUSTOMER`

## state machine رزرو

### مسیر اصلی (دستی)

- `PENDING_REVIEW -> REJECTED`
- `PENDING_REVIEW -> CONFIRMED` وقتی آرایشگر بیعانه 0 وارد می‌کند (رزرو فوری نهایی)
- `PENDING_REVIEW -> APPROVED_AWAITING_DEPOSIT` وقتی بیعانه > 0
- `APPROVED_AWAITING_DEPOSIT -> PAYMENT_PENDING`
- `PAYMENT_PENDING -> CONFIRMED`
- `PAYMENT_PENDING -> APPROVED_AWAITING_DEPOSIT` در صورت expire شدن intent
- `CONFIRMED -> COMPLETED`
- `CONFIRMED -> NO_SHOW`

### مسیر تایید خودکار

- `PENDING_REVIEW -> CONFIRMED` مستقیم (اگر `autoApproveBookings = true`)

### مسیر رد خودکار (auto-reject)

- `PENDING_REVIEW -> REJECTED` هنگامی که مشتری دیگری همان اسلات را وارد `PAYMENT_PENDING` می‌کند
- `APPROVED_AWAITING_DEPOSIT -> REJECTED` همان شرط

### مسیر کنسلی

- `PENDING_REVIEW -> CANCELLED_WITHOUT_PENALTY`
- `APPROVED_AWAITING_DEPOSIT -> CANCELLED_WITHOUT_PENALTY`
- `PAYMENT_PENDING -> CANCELLATION_REQUESTED`
- `CONFIRMED -> CANCELLATION_REQUESTED`
- `CANCELLATION_REQUESTED -> CANCELLED_WITH_PENALTY`
- `CANCELLATION_REQUESTED -> CANCELLED_WITHOUT_PENALTY`

## قوانین availability

- slot interval برابر `30` دقیقه است
- فقط 14 روز آینده نمایش داده می‌شود
- یک slot فقط وقتی قابل نمایش است که:
  - داخل `WorkingHours` باشد
  - با `BlockedTime` overlap نداشته باشد
  - با bookingهای **blocking** overlap نداشته باشد
- **SLOT_BLOCKING_STATUSES** (فقط این‌ها اسلات را قفل می‌کنند):
  - `PAYMENT_PENDING`
  - `CONFIRMED`
- **ACTIVE_BOOKING_STATUSES** (هنوز زنده‌اند ولی اسلات را قفل نمی‌کنند):
  - `PENDING_REVIEW`
  - `APPROVED_AWAITING_DEPOSIT`
  - `PAYMENT_PENDING`
  - `CONFIRMED`
- اگر یک booking به `REJECTED` یا هر وضعیت cancellation برسد، اسلات آزاد می‌شود

## قوانین pricing و deposit

- آرایشگر هنگام تعریف سرویس، بازه قیمت پایه را ذخیره می‌کند
- آرایشگر هنگام تایید دستی رزرو، quote نهایی همان رزرو را ثبت می‌کند
- `quotedMinPriceToman <= quotedMaxPriceToman`
- `depositAmountToman >= 0` در تایید دستی؛ اگر 0 باشد رزرو مستقیم `CONFIRMED` می‌شود و PaymentIntent ساخته نمی‌شود
- `depositAmountToman <= quotedMaxPriceToman` (فقط وقتی > 0)
- payment intent فقط اگر `depositAmountToman > 0` باشد ساخته می‌شود
- **کارمزد درگاه پرداخت:**
  - قبل از ساخت payment intent، کارمزد از API زرین‌پال (`feeCalculation`) واکشی می‌شود
  - `gatewayFeeToman = ceil(feeRial / 10)` — کارمزد از API به تومان تبدیل می‌شود
  - اگر API در دسترس نبود، fallback به `PAYMENT_GATEWAY_FEE_PERCENT` درصد
  - مبلغ نهایی پرداختی: `totalAmountToman = depositAmountToman + gatewayFeeToman`
  - مبلغ ارسالی به ZarinPal request: `totalToman * 10` (ریال)
  - اگر fee > 0 باشد، هم مبلغ بیعانه و هم کارمزد به مشتری اعلام می‌شود
  - مبلغ واریزی به کیف پول آرایشگر همان `depositAmountToman` (بدون کارمزد) است
- اگر `isAutoApproved = true`، بیعانه‌ای وجود ندارد و `PaymentIntent` ساخته نمی‌شود

## قوانین locked balance (کیف پول آرایشگر)

- بیعانه‌ای که مشتری پرداخت کرده و رزرو هنوز `CONFIRMED` است و زمانش نرسیده، **قفل** محسوب می‌شود
- `lockedBalance = SUM(depositAmountToman) WHERE status=CONFIRMED AND requestedStartAt > now`
- `availableBalance = wallet.balanceToman - lockedBalance`
- آرایشگر فقط می‌تواند `availableBalance` را برداشت کند
- بعد از گذشتن زمان رزرو (یا کنسل شدن)، مبلغ آزاد می‌شود

## قوانین cancellation

- اگر رزرو هنوز پرداخت نشده باشد، کنسلی بدون جریمه است
- اگر مشتری بعد از پرداخت کنسل کند، 50 درصد بیعانه نگه داشته می‌شود
- مبلغ قابل عودت در MVP به صورت:
  `refundAmountToman = floor(depositAmountToman / 2)`
- اگر لغو از سمت آرایشگر باشد، وضعیت `CANCELLED_WITHOUT_PENALTY` ثبت می‌شود
- **کنسلی با جریمه (wallet transactions):**
  1. `PENALTY_CREDIT` به مقدار `penaltyToman` (۵۰٪) روی کیف پول آرایشگر ثبت می‌شود (فقط اطلاعاتی)
  2. `REFUND_DEBIT` به مقدار `-refundToman` از کیف پول آرایشگر کسر می‌شود
  3. `REFUND_CREDIT` به مقدار `refundToman` به کیف پول مشتری اضافه می‌شود
- **کنسلی بدون جریمه (wallet transactions):**
  1. `REFUND_DEBIT` کل بیعانه از کیف پول آرایشگر کسر می‌شود
  2. `REFUND_CREDIT` کل بیعانه به کیف پول مشتری اضافه می‌شود
- همه این عملیات‌ها داخل `prisma.$transaction` اتمیک انجام می‌شوند

## قوانین auto-reject

- هنگامی که booking به `PAYMENT_PENDING` منتقل می‌شود:
  - تمام bookingهای دیگر با همان `hairdresserId` که با این اسلات overlap دارند
  - و در وضعیت `PENDING_REVIEW` یا `APPROVED_AWAITING_DEPOSIT` هستند
  - به `REJECTED` با دلیل مشخص منتقل می‌شوند
  - مشتریان آن‌ها نوتیف دریافت می‌کنند
- این عملیات داخل یک transaction اتمیک انجام می‌شود

## قوانین notification channel

- هنگام ارسال هر نوتیف، `notificationChannel` گیرنده بررسی می‌شود
- `TELEGRAM_ONLY`: فقط به `telegramChatId` پیام می‌رود
- `BALE_ONLY`: فقط به `baleChatId` پیام می‌رود
- `BOTH`: به هر دو به‌صورت موازی پیام می‌رود
- اگر chatId پلتفرم ترجیحی خالی باشد، به پلتفرم دیگر fallback می‌کند
- **تغییر کانال:** قبل از ذخیره، سیستم بررسی می‌کند که `chatId` پلتفرم(های) انتخابی موجود باشد؛ اگر نباشد، لینک استارت ربات آن پلتفرم + راهنما به آرایشگر نمایش داده می‌شود

## نکات پیاده‌سازی Prisma

- روی `bookingSlug`, `telegramUserId`, `baleUserId`, `phoneNumber`, `providerReferenceId`, `idempotencyKey` ایندکس یا unique تعریف شود
- برای queryهای برنامه روزانه، روی `Booking(hairdresserId, requestedStartAt, status)` ایندکس ترکیبی لازم است
- برای availability، روی `BlockedTime(hairdresserId, startsAt, endsAt)` و `WorkingHours(hairdresserId, dayOfWeek)` ایندکس گذاشته شود
- برای auto-reject، روی `Booking(hairdresserId, requestedStartAt, requestedEndAt, status)` ایندکس لازم است
