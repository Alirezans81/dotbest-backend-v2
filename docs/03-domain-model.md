# Domain Model

این سند مدل دامنه بک‌اند را برای MVP رزرو مشخص می‌کند. هدف این است که پیاده‌سازی Prisma و منطق route handlerها بدون تصمیم‌گیری اضافه قابل شروع باشد.

## اصول مدل

- کلیدهای اصلی به صورت opaque string و ترجیحاً `cuid()` تولید شوند.
- همه timestampها در دیتابیس به UTC ذخیره شوند و در لایه نمایش به `Asia/Tehran` تبدیل شوند.
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
- `notificationChannel` — پیش‌فرض `TELEGRAM_ONLY`
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

برنامه کاری پایه آرایشگر.

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

- `dayOfWeek` بین 0 تا 6
- `startMinuteOfDay < endMinuteOfDay`
- بازه‌ها نباید برای یک روز overlap داشته باشند

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
- اگر `isAutoApproved = true`، رزرو بدون بیعانه مستقیم `CONFIRMED` است
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
- `Customer` یک به چند با `Booking`
- `ServiceCategory` یک به چند با `Service`
- `Service` یک به چند با `Booking`
- `Booking` یک به چند با `BookingAttachment`
- `Booking` یک به چند با `PaymentIntent`
- `PaymentIntent` یک به چند با `PaymentTransaction`
- `Booking` یک به چند با `NotificationLog`

## enumها

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
- `PENDING_REVIEW -> APPROVED_AWAITING_DEPOSIT`
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
- `depositAmountToman > 0`
- `depositAmountToman <= quotedMaxPriceToman`
- payment intent همیشه بر اساس `depositAmountToman` ساخته می‌شود
- اگر `isAutoApproved = true`، بیعانه‌ای وجود ندارد و `PaymentIntent` ساخته نمی‌شود

## قوانین cancellation

- اگر رزرو هنوز پرداخت نشده باشد، کنسلی بدون جریمه است
- اگر مشتری بعد از پرداخت کنسل کند، 50 درصد بیعانه نگه داشته می‌شود
- مبلغ قابل عودت در MVP به صورت:
  `refundAmountToman = floor(depositAmountToman / 2)`
- اگر لغو از سمت آرایشگر باشد، وضعیت `CANCELLED_WITHOUT_PENALTY` ثبت می‌شود

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

## نکات پیاده‌سازی Prisma

- روی `bookingSlug`, `telegramUserId`, `baleUserId`, `phoneNumber`, `providerReferenceId`, `idempotencyKey` ایندکس یا unique تعریف شود
- برای queryهای برنامه روزانه، روی `Booking(hairdresserId, requestedStartAt, status)` ایندکس ترکیبی لازم است
- برای availability، روی `BlockedTime(hairdresserId, startsAt, endsAt)` و `WorkingHours(hairdresserId, dayOfWeek)` ایندکس گذاشته شود
- برای auto-reject، روی `Booking(hairdresserId, requestedStartAt, requestedEndAt, status)` ایندکس لازم است
