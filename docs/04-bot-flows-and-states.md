# Bot Flows And States

این سند stateهای گفت‌وگو و callback actionهای موردنیاز برای بات تلگرام (و بله) را مشخص می‌کند. هدف این است که interaction model به اندازه کافی دقیق باشد تا session manager و handlerها بدون ambiguity پیاده‌سازی شوند.

## اصول طراحی flow

- هر actor در هر chat فقط یک `ConversationSession` active دارد.
- هر flow باید قابل resume باشد.
- همه callback actionها باید idempotent باشند.
- اگر state منقضی شود، بات باید کاربر را به نزدیک‌ترین نقطه امن برگرداند.
- session فیلد `platform` دارد (`TELEGRAM` یا `BALE`) تا پیام‌های خروجی به پلتفرم درست برود.

## Hairdresser States

## Onboarding

- `HD_IDLE`
  - حالت پیش‌فرض بعد از اتمام هر flow
- `HD_WAIT_CONTACT`
  - انتظار برای شماره تماس
- `HD_WAIT_NAME`
  - انتظار برای نام کامل
- `HD_WAIT_FIRST_CATEGORY`
  - انتظار برای انتخاب یا ساخت دسته‌بندی اول
- `HD_WAIT_FIRST_SERVICE_NAME`
  - انتظار برای نام سرویس
- `HD_WAIT_FIRST_SERVICE_DURATION`
  - انتظار برای مدت زمان
- `HD_WAIT_FIRST_SERVICE_PRICE_MIN`
  - انتظار برای حداقل قیمت
- `HD_WAIT_FIRST_SERVICE_PRICE_MAX`
  - انتظار برای حداکثر قیمت
- `HD_ONBOARDING_DONE`
  - حالت انتقالی برای نمایش لینک اختصاصی و منوی اصلی

## Service Management

- `HD_WAIT_NEW_CATEGORY`
- `HD_WAIT_NEW_SERVICE_NAME`
- `HD_WAIT_NEW_SERVICE_DURATION`
- `HD_WAIT_NEW_SERVICE_PRICE_MIN`
- `HD_WAIT_NEW_SERVICE_PRICE_MAX`

## Booking Review

- `HD_WAIT_APPROVAL_QUOTE_MIN`
- `HD_WAIT_APPROVAL_QUOTE_MAX`
- `HD_WAIT_APPROVAL_DEPOSIT`
- `HD_WAIT_REJECTION_REASON`

## Schedule And Settings

- `HD_WAIT_WORKING_DAY`
- `HD_WAIT_WORKING_START`
- `HD_WAIT_WORKING_END`
- `HD_WAIT_BLOCK_START`
- `HD_WAIT_BLOCK_END`
- `HD_WAIT_BLOCK_REASON`

## Customer States

- `CUST_IDLE`
- `CUST_SELECT_CATEGORY`
- `CUST_SELECT_SERVICE`
- `CUST_SELECT_DATE`
- `CUST_SELECT_TIME`
- `CUST_WAIT_DESCRIPTION`
- `CUST_WAIT_ATTACHMENT`
- `CUST_REVIEW_REQUEST`
- `CUST_REQUEST_SUBMITTED`
- `CUST_WAIT_PAYMENT`
- `CUST_WAIT_CANCELLATION_CONFIRM`

## Transition Rules

### Hairdresser Onboarding

- `/start` برای آرایشگر جدید:
  - `HD_IDLE -> HD_WAIT_CONTACT`
- بعد از دریافت contact معتبر:
  - `HD_WAIT_CONTACT -> HD_WAIT_NAME`
  - اثر بک‌اند: سینک حساب با پلتفرم دیگر در صورت وجود همان شماره
- بعد از دریافت نام:
  - `HD_WAIT_NAME -> HD_WAIT_FIRST_CATEGORY`
- بعد از تکمیل اولین سرویس:
  - `HD_WAIT_FIRST_SERVICE_PRICE_MAX -> HD_ONBOARDING_DONE -> HD_IDLE`

### Customer Booking

- ورود از deep link:
  - `CUST_IDLE -> CUST_SELECT_CATEGORY`
  - اثر بک‌اند: ایجاد یا بازیابی Customer با `userId` همان پلتفرم
- انتخاب category:
  - `CUST_SELECT_CATEGORY -> CUST_SELECT_SERVICE`
- انتخاب service:
  - `CUST_SELECT_SERVICE -> CUST_SELECT_DATE`
- انتخاب date:
  - `CUST_SELECT_DATE -> CUST_SELECT_TIME`
- انتخاب slot:
  - `CUST_SELECT_TIME -> CUST_WAIT_DESCRIPTION`
  - **نکته:** اسلات هنوز قفل نمی‌شود؛ فقط در payload ذخیره می‌شود
- skip description:
  - `CUST_WAIT_DESCRIPTION -> CUST_REVIEW_REQUEST`
- ثبت description یا attachment:
  - `CUST_WAIT_DESCRIPTION -> CUST_WAIT_ATTACHMENT -> CUST_REVIEW_REQUEST`
- submit (auto-approve خاموش):
  - `CUST_REVIEW_REQUEST -> CUST_REQUEST_SUBMITTED -> CUST_IDLE`
- submit (auto-approve روشن):
  - `CUST_REVIEW_REQUEST -> CUST_IDLE` (مستقیم؛ رزرو `CONFIRMED`)

## Callback Action Naming

فرمت actionها باید کوتاه، deterministic و parseable باشد:

`<namespace>:<action>:<resourceId>:<payload>`

اگر بخش اضافه لازم نبود، حذف می‌شود.

## Callbackهای آرایشگر

### منو

- `hd:menu:today`
- `hd:menu:customers`
- `hd:menu:settings`

### سرویس

- `hd:service:add`
- `hd:service:category:<categoryId>`

### رزرو

- `hd:booking:approve:<bookingId>`
- `hd:booking:reject:<bookingId>`
- `hd:booking:view:<bookingId>`

### ساعت کاری

- `hd:hours:edit`
- `hd:hours:day:<dayIndex>`

### زمان مسدود

- `hd:block:add`

### تنظیمات پیشرفته

- `hd:settings:autoapprove:toggle` — روشن/خاموش کردن تایید خودکار
- `hd:settings:notif:menu` — نمایش منوی انتخاب کانال نوتیف
- `hd:settings:notif:set:TELEGRAM_ONLY` — فقط تلگرام
- `hd:settings:notif:set:BALE_ONLY` — فقط بله
- `hd:settings:notif:set:BOTH` — هر دو

## Callbackهای مشتری

- `cust:start:<bookingSlug>`
- `cust:category:<categoryId>`
- `cust:service:<serviceId>`
- `cust:date:<yyyy-mm-dd>`
- `cust:slot:<isoStartAt>`
- `cust:description:skip`
- `cust:attachment:skip`
- `cust:booking:submit`
- `cust:payment:pay:<bookingId>`
- `cust:cancel:request:<bookingId>`
- `cust:cancel:confirm:<bookingId>`
- `cust:cancel:abort:<bookingId>`

## Timeout And Resume Behavior

- `ConversationSession.expiresAt` برابر `30` دقیقه بعد از آخرین تعامل است
- اگر session منقضی شود:
  - draft معتبر در `payload` حفظ می‌شود
  - بات پیام می‌دهد که گفتگو منقضی شده و از آخرین مرحله امن ادامه می‌دهد
- اگر کاربر در `CUST_WAIT_PAYMENT` باشد، انقضای payment intent مستقل از session است
- payment intent پیش‌فرض `30` دقیقه اعتبار دارد
- بعد از انقضای payment intent:
  - booking از `PAYMENT_PENDING` به `APPROVED_AWAITING_DEPOSIT` برمی‌گردد
  - کاربر باید دوباره روی دکمه پرداخت بزند

## Validation Rules

- شماره تماس باید به `+98xxxxxxxxxx` نرمال شود
- نام نباید خالی باشد
- category و service باید active و متعلق به همان آرایشگر باشند
- `durationMinutes` باید مضرب 30 باشد
- `priceMinToman` و `priceMaxToman` باید integer مثبت باشند
- `priceMinToman <= priceMaxToman`
- `depositAmountToman > 0` (فقط در تایید دستی)
- `depositAmountToman <= quotedMaxPriceToman` (فقط در تایید دستی)
- slot باید در آینده باشد
- slot باید داخل افق 14 روز آینده باشد
- حداکثر تعداد attachment در MVP برابر `5` فایل است
- فقط `photo` و `video` به عنوان media attachment پذیرفته می‌شوند
- `NotificationChannel` باید یکی از مقادیر enum معتبر باشد

## Failure And Recovery Paths

## Slot Race Condition

- چند مشتری می‌توانند همزمان یک اسلات را submit کنند (مجاز)
- اسلات فقط هنگام `initiatePayment` قفل می‌شود
- اگر هنگام initiate، رزروهای رقیب وجود داشته باشند:
  - به صورت اتمیک رد می‌شوند
  - مشتریان رد شده نوتیف دریافت می‌کنند

## Invalid Callback

- اگر callback به resource نامعتبر یا غیرفعال اشاره کند:
  - action رد می‌شود
  - state جاری reset نمی‌شود مگر آنکه session ناسازگار شده باشد

## Payment Verification Failure

- اگر callback provider برسد ولی verify fail شود:
  - `PaymentTransaction` با `FAILED` ثبت می‌شود
  - booking در `PAYMENT_PENDING` یا `APPROVED_AWAITING_DEPOSIT` باقی می‌ماند
  - مشتری دکمه retry payment دریافت می‌کند

## Telegram / Bale Delivery Failure

- اگر ارسال پیام شکست بخورد:
  - `NotificationLog` در `FAILED` ثبت می‌شود
  - job retry می‌تواند دوباره آن را امتحان کند
- اگر `notificationChannel = BOTH` و یکی fail شود:
  - ارسال موفق دیگری ثبت می‌شود
  - شکست یکی از کانال‌ها کل عملیات را block نمی‌کند

## Session Corruption

- اگر state و payload با هم سازگار نباشند:
  - session بسته می‌شود
  - کاربر به `IDLE` برمی‌گردد
  - پیام راهنما برای شروع دوباره نمایش داده می‌شود

## Draft Payload Shape

برای پرهیز از state explosion، `payload` باید draftهای موقت را نگه دارد:

- برای آرایشگر:
  - `draftCategoryTitle`
  - `draftServiceTitle`
  - `draftDurationMinutes`
  - `draftPriceMinToman`
  - `draftQuoteMinToman`
  - `draftQuoteMaxToman`
  - `targetBookingId`
  - `targetCategoryId`
  - `draftWorkingDay`
  - `draftWorkingStart`
  - `draftBlockStart`
  - `draftBlockEnd`
- برای مشتری:
  - `targetHairdresserId`
  - `targetHairdresserSlug`
  - `selectedCategoryId`
  - `selectedServiceId`
  - `selectedDate`
  - `selectedStartAt`
  - `descriptionText`
  - `attachmentIds`

## Acceptance Scenarios

- آرایشگر onboarding را بدون خروج از بات کامل کند
- آرایشگری که قبلاً روی تلگرام ثبت‌نام کرده، روی بله `/start` بزند و همان حساب را ببیند
- مشتری از deep link تا submit booking را بدون تایپ اجباری جلو ببرد
- دو مشتری همزمان یک اسلات را درخواست دهند؛ هر دو `PENDING_REVIEW` بگیرند
- مشتری اول پرداخت کند؛ رزرو دومی به‌صورت خودکار رد شود
- آرایشگر تایید خودکار را روشن کند؛ رزرو بعدی مستقیم `CONFIRMED` شود
- آرایشگر کانال نوتیف را روی `BOTH` بگذارد؛ reminder روی هر دو پلتفرم برسد
- آرایشگر بعد از زدن تایید دستی، quote و deposit را کامل ثبت کند
- مشتری بعد از expiry payment بتواند دوباره لینک پرداخت بگیرد
- session منقضی‌شده از آخرین مرحله امن recover شود
