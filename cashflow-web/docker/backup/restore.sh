#!/usr/bin/env bash
#
# restore.sh — استعادة جداول التطبيق من نسخة احتياطية أنشأها backup.sh.
#
# ⚠️ تحذير: الاستعادة **تستبدل** جداول التطبيق (تُسقطها ثم تعيد بناءها من اللقطة).
#    لا تمسّ الجداول التحليلية (يعيد بناءها ETL لاحقاً). تتطلّب تأكيداً صريحاً.
#
# الاستخدام:
#   ./restore.sh <ملف-النسخة> [قاعدة-الهدف] [--yes]
#
#   ./restore.sh dumps/cashflow-apptables-cashflow-20260609-203000.dump
#       → يستعيد إلى قاعدة cashflow (الافتراضية) بعد تأكيد تفاعلي.
#
#   ./restore.sh <ملف> cashflow_bkptest --yes
#       → يستعيد إلى cashflow_bkptest دون سؤال (للاختبار/الأتمتة).
#
# التأكيد: مرّر --yes  أو  اضبط  CONFIRM=yes  أو  اكتب "restore" عند السؤال.
#
# متغيّرات البيئة:
#   CONTAINER   اسم حاوية Postgres (افتراضي: cashflow-postgres)
#   DB_USER     مستخدم القاعدة     (افتراضي: POSTGRES_USER من .env أو cashflow)
#   CONFIRM     =yes لتخطّي السؤال التفاعلي
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../../.env}"

if [[ -f "$ENV_FILE" ]]; then
  ENV_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
fi

CONTAINER="${CONTAINER:-cashflow-postgres}"
DB_USER="${DB_USER:-${ENV_USER:-cashflow}}"

# --- وسائط ----------------------------------------------------------------
DUMP_FILE="${1:-}"
TARGET_DB="${2:-cashflow}"
FLAG="${3:-}"

# لو مُرّر --yes كوسيط ثانٍ (دون قاعدة هدف)، عامله كعلَم.
if [[ "$TARGET_DB" == "--yes" ]]; then
  FLAG="--yes"
  TARGET_DB="cashflow"
fi

if [[ -z "$DUMP_FILE" ]]; then
  echo "الاستخدام: $0 <ملف-النسخة> [قاعدة-الهدف] [--yes]" >&2
  exit 2
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "خطأ: ملف النسخة غير موجود: $DUMP_FILE" >&2
  exit 2
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "خطأ: الحاوية '$CONTAINER' غير قيد التشغيل." >&2
  exit 1
fi

APP_TABLES="users suppliers supplier_caps scenarios assumptions scenario_adjustments payment_plans payment_plan_lines notes alerts app_settings audit_log"

# --- التأكيد --------------------------------------------------------------
echo "═══════════════════════════════════════════════════════════════"
echo " استعادة جداول التطبيق — عملية تدميرية"
echo "═══════════════════════════════════════════════════════════════"
echo "  الملف المصدر : $DUMP_FILE"
echo "  قاعدة الهدف  : $TARGET_DB   (حاوية: $CONTAINER)"
echo "  ستُستبدَل الجداول التالية (DROP + إعادة بناء من اللقطة):"
echo "    $APP_TABLES"
echo "  الجداول التحليلية لن تُمسّ — يعيد بناءها ETL لاحقاً."
echo "═══════════════════════════════════════════════════════════════"

CONFIRMED="no"
if [[ "$FLAG" == "--yes" || "${CONFIRM:-}" == "yes" ]]; then
  CONFIRMED="yes"
else
  printf 'اكتب "restore" للمتابعة (أي شيء آخر يُلغي): '
  read -r answer || true
  if [[ "$answer" == "restore" ]]; then
    CONFIRMED="yes"
  fi
fi

if [[ "$CONFIRMED" != "yes" ]]; then
  echo "أُلغيت الاستعادة. لم يتغيّر شيء." >&2
  exit 3
fi

# --- التنفيذ --------------------------------------------------------------
# نمرّر ملف النسخة من المضيف إلى pg_restore داخل الحاوية عبر stdin.
# --clean --if-exists = يُسقط الجداول الموجودة (إن وُجدت) قبل إعادة إنشائها.
# --no-owner          = يستعيد بمالك التنفيذ الحالي بصرف النظر عن مالك النسخة.
# -1 (single-tx)      = الاستعادة كلها في معاملة واحدة (إمّا كلها أو لا شيء).
echo ""
echo "جارٍ الاستعادة..."
docker exec -i "$CONTAINER" pg_restore \
  -U "$DB_USER" \
  -d "$TARGET_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  < "$DUMP_FILE"

echo ""
echo "✅ اكتملت الاستعادة. فحص عدد الصفوف بعد الاستعادة:"

# --- فحص عدد الصفوف (sanity check) ---------------------------------------
COUNT_SQL=""
for t in $APP_TABLES; do
  if [[ -z "$COUNT_SQL" ]]; then
    COUNT_SQL="SELECT '$t' AS table_name, count(*) AS rows FROM $t"
  else
    COUNT_SQL="$COUNT_SQL UNION ALL SELECT '$t', count(*) FROM $t"
  fi
done
COUNT_SQL="$COUNT_SQL ORDER BY table_name;"

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -c "$COUNT_SQL"
