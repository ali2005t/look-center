# 🔨 دليل البناء والتجميع (Build Guide)

## المتطلبات قبل البناء

### البرامج الأساسية
- Node.js v14+ (تحميل من [nodejs.org](https://nodejs.org))
- npm v6+ (يأتي مع Node.js)
- Git (اختياري)

### التحقق من التثبيت
```bash
node --version
npm --version
```

---

## 🚀 إعداد البناء

### الخطوة 1: تثبيت المكتبات
```bash
# افتح مجلد المشروع
cd "g:\look cahsier new update\NeoEduApp"

# ثبّت المكتبات
npm install
```

### الخطوة 2: التحقق من البيانات
- ✅ تأكد من وجود ملف `ico/ico.ico`
- ✅ تأكد من وجود ملف `main.js`
- ✅ تأكد من وجود جميع الملفات الأساسية

---

## 🔧 خيارات البناء

### 1. بناء كامل (جميع الإصدارات)
```bash
npm run build
```
✅ ينشئ:
- LOOK-CASHIER-Setup-x64.exe (64-bit)
- LOOK-CASHIER-Setup-ia32.exe (32-bit)
- LOOK-CASHIER-Setup-arm64.exe (ARM)

### 2. بناء 64-bit فقط
```bash
npm run build:x64
```

### 3. بناء 32-bit فقط
```bash
npm run build:ia32
```

### 4. بناء ARM64
```bash
npm run build:arm64
```

### 5. نسخة محمولة (Portable)
```bash
npm run build:portable
```
✅ ينشئ ملف EXE محمول بدون تثبيت

---

## 🪟 بناء حسب إصدار Windows

### Windows 7 و 8 (32-bit و 64-bit)
```bash
npm run build:win7
```

### Windows 10 (64-bit و 32-bit)
```bash
npm run build:win10
```

### Windows 11 (64-bit و ARM64)
```bash
npm run build:win11
```

### بناء الكل
```bash
npm run build:all
```

---

## 📂 الملفات الناتجة

### موقع الملفات
```
g:\look cahsier new update\NeoEduApp\install\
```

### أنواع الملفات الناتجة

#### 1. ملفات المثبت (Installers)
```
LOOK-CASHIER-Setup-2.0.0-x64.exe      (64-bit)
LOOK-CASHIER-Setup-2.0.0-ia32.exe     (32-bit)
LOOK-CASHIER-Setup-2.0.0-arm64.exe    (ARM)
```

#### 2. النسخ المحمولة (Portable)
```
LOOK-CASHIER-2.0.0-x64.exe            (Portable 64-bit)
```

#### 3. ملفات داعمة
```
*.blockmap                              (ملف التحديث)
```

---

## 🔌 تثبيت المكتبات المطلوبة

إذا واجهت مشاكل، ثبّت المكتبات يدوياً:

```bash
# تثبيت Electron
npm install electron --save-dev

# تثبيت Electron Builder
npm install electron-builder --save-dev

# تثبيت Electron Packager
npm install electron-packager --save-dev
```

---

## ⚙️ تخصيص البناء

### تغيير الإصدار
عدّل في `package.json`:
```json
"version": "2.1.0",
```

### تغيير أيقونة التطبيق
ضع ملف أيقونة جديد في:
```
ico/ico.ico
```

### تغيير اسم المنتج
عدّل في `package.json`:
```json
"productName": "اسم جديد"
```

---

## 🧪 اختبار البناء

### اختبار التشغيل
```bash
npm start
```

### اختبار المثبت
1. قم بتشغيل ملف EXE الناتج
2. اتبع خطوات التثبيت
3. تحقق من التشغيل

---

## 🐛 استكشاف الأخطاء

### المشكلة: لم يتم العثور على node
```bash
# الحل: تحقق من تثبيت Node.js
node --version
```

### المشكلة: خطأ في البناء
```bash
# الحل: امسح المجلد وأعد المحاولة
rmdir /s install
npm run build
```

### المشكلة: الملفات ناقصة
```bash
# الحل: أعد تثبيت المكتبات
rmdir /s node_modules
npm install
npm run build
```

---

## 📋 قائمة التحقق قبل البناء

- ✅ تثبيت Node.js
- ✅ تثبيت المكتبات (`npm install`)
- ✅ التحقق من وجود الملفات الأساسية
- ✅ التحقق من الأيقونة
- ✅ تحديث رقم الإصدار إذا لزم
- ✅ اختبار التشغيل (`npm start`)

---

## 🎯 التوزيع والنشر

بعد الانتهاء من البناء:

### 1. اختبار الملفات
- جرّب تثبيت كل ملف EXE
- تحقق من التشغيل

### 2. التوقيع الرقمي (اختياري)
- وقّع الملفات لزيادة الأمان

### 3. النشر
- ارفع الملفات على الموقع
- وفّر روابط التحميل
- أطلق الإعلان

---

## 📊 معلومات التوافقية

| الإصدار | دعم |
|---------|-----|
| Windows 7 | ✅ 32-bit, 64-bit |
| Windows 8 | ✅ 32-bit, 64-bit |
| Windows 10 | ✅ 32-bit, 64-bit |
| Windows 11 | ✅ 64-bit, ARM64 |
| XP و أقدم | ❌ غير مدعوم |

---

## 💡 نصائح مهمة

- 💾 احفظ الملفات الناتجة في مكان آمن
- 🔐 احم الملفات برمز مرور إذا لزم
- 📝 وثّق كل إصدار جديد
- 🔄 احتفظ بنسخة احتياطية من الكود

---

**آخر تحديث:** 5 ديسمبر 2025
**مطور النظام:** Eng. LoL ✨
