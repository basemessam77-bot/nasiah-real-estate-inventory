# نظام ناصيه – NASIAH

تطبيق ويب داخلي بواجهة بيضاء عصرية ومستقلة لإدارة شيتات العقارات الخاصة بخمسة Team Leaders مع حسابين Admin.

## التشغيل على Windows
1. ثبّت Node.js إصدار LTS.
2. فك ضغط الملف.
3. افتح مجلد المشروع في VS Code.
4. افتح Terminal داخل المجلد وشغّل:
   ```bash
   npm install
   npm start
   ```
5. افتح المتصفح على: http://localhost:3000

## الصلاحيات
- الأدمن يشاهد ويضيف ويعدل ويحذف في كل الشيتات.
- كل Team Leader يرى الشيتات الخمسة، ويضيف ويعدل ويحذف في شيت حسابه فقط.
- الخادم يتحقق من الصلاحيات، وليس الواجهة فقط.
- ملخص القطاعات محمي على مستوى API للأدمن فقط.
- يمكن للأدمن تنزيل نسخة احتياطية Excel من زر الإدارة؛ تحتوي على ورقة ملخص وورقة مستقلة لكل Team Leader.
- حسابات المستخدمين الجديدة مطالبة بتغيير كلمة المرور عند أول تسجيل دخول، ولا يمكن إغلاق نافذة الإلزام قبل التغيير.

## الحسابات الأولية
الحسابات السبعة التي تم الاتفاق عليها موجودة في `seed-accounts.json` بكلمات مرور مخزنة كـ salted scrypt hashes؛ كلمات المرور الأصلية غير مكتوبة كنص داخل الملفات.
- Admin: emadrashad, basemmessam
- Leaders: alaaelhady10 (وسط), alaakhatebty (شمال), khaled (شرق), yassminsokar (جنوب), hagerabdelaziz (غرب)

## قاعدة البيانات والنسخ الاحتياطي
- مجلد `data` يُنشأ تلقائياً، وقاعدة البيانات تنشأ في `data/inventory.sqlite` عند أول تشغيل.
- أوقف السيرفر قبل نسخ ملف قاعدة البيانات احتياطياً.
- لا تحذف مجلد `data` عند تحديث ملفات البرنامج حتى لا تفقد البيانات.

## النشر والاستضافة
- يدعم التطبيق SQLite محلياً وPostgreSQL عند ضبط `DATABASE_URL`.
- يمكن نشر خادم Node.js على Render وربطه بقاعدة Neon PostgreSQL. الخطة المجانية للخادم قد تتوقف عند عدم الاستخدام، لذلك قد يستغرق أول طلب بعد الخمول وقتاً أطول.
- أنشئ قاعدة PostgreSQL مجانية في Neon، وانسخ connection string. لا تضعه في الملفات أو GitHub.
- من PowerShell داخل مجلد المشروع، عيّن الاتصال وشغّل ترحيل البيانات مرة واحدة:
  ```powershell
  $secureUrl = Read-Host "Neon connection string" -AsSecureString
  try {
    $env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $secureUrl).Password
    npm run migrate:neon
    if ($LASTEXITCODE -ne 0) { throw "Migration failed" }
  } finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $secureUrl.Dispose()
  }
  ```
  يتوقف الترحيل إذا لم تكن قاعدة Neon فارغة. ينقل الحسابات والعقارات، ولا ينقل جلسات الدخول. يطلب من حسابات Admin تغيير كلمة المرور عند أول دخول.
- ارفع ملفات التطبيق إلى GitHub، ثم أنشئ Web Service على Render من المستودع. استخدم `npm install` للبناء و`npm start` للتشغيل، وأضف متغير `DATABASE_URL` في إعدادات Render كـ Secret Environment Variable.
- إذا كانت قاعدة البيانات فارغة عند أول تشغيل، اضبط `INITIAL_ADMIN_USERNAME` و`INITIAL_ADMIN_PASSWORD` في Render لإنشاء حساب Admin أولي؛ كلمة المرور الأولية يجب أن تكون 16 حرفاً على الأقل، ويُطلب تغييرها عند أول دخول.
- لا ترفع `data/` أو `.env` أو `seed-accounts.json` إلى GitHub. هذه المسارات مستثناة في `.gitignore`. تجنب إضافة معلومات العملاء إلى أي مستودع.
- استخدم HTTPS، وكلمات مرور قوية وفريدة، ونسخاً احتياطياً دورياً. رابط Render عام، لكن بيانات التطبيق تتطلب تسجيل الدخول.
