#!/usr/bin/env bash
#
# backup.sh — نسخ احتياطي لجداول التطبيق فقط في قاعدة PostgreSQL "cashflow".
#
# يأخذ نسخة (schema + data) للجداول التي يُدخلها المستخدم ولا يمكن إعادة بنائها
# (السقوف، السيناريوهات، الخطط، الملاحظات، التنبيهات، التدقيق). الجداول التحليلية
# (monthly_cashflow ...) **لا تُنسخ** لأن ETL الليلي يعيد بناءها.
#
# يُشغّل pg_dump *داخل* الحاوية عبر `docker exec`، فلا حاجة لعميل PostgreSQL على المضيف.
#
# الاستخدام:
#   ./backup.sh                 # ينسخ قاعدة cashflow الحيّة
#   DB_NAME=cashflow_bkptest ./backup.sh   # ينسخ قاعدة أخرى (للاختبار)
#
# متغيّرات البيئة (كلها اختيارية، لها قيم افتراضية):
#   CONTAINER       اسم حاوية Postgres            (افتراضي: cashflow-postgres)
#   DB_NAME         اسم القاعدة المراد نسخها       (افتراضي: POSTGRES_DB من .env أو cashflow)
#   DB_USER         مستخدم القاعدة                (افتراضي: POSTGRES_USER من .env أو cashflow)
#   BACKUP_DIR      مجلّد حفظ النسخ               (افتراضي: <script>/dumps)
#   RETENTION_DAYS  حذف النسخ الأقدم من N يوماً    (افتراضي: 14)
#
set -euo pipefail

# --- مسارات ---------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../../.env}"

# --- تحميل الإعدادات من .env (إن وُجد) ------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  # نقرأ POSTGRES_DB / POSTGRES_USER فقط دون تنفيذ الملف كاملاً.
  ENV_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  ENV_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
fi

CONTAINER="${CONTAINER:-cashflow-postgres}"
DB_NAME="${DB_NAME:-${ENV_DB:-cashflow}}"
DB_USER="${DB_USER:-${ENV_USER:-cashflow}}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/dumps}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# --- جداول التطبيق (تُنسخ) — تُحدَّث يدوياً مع الهجرات الجديدة --------------
# لا تُضِف الجداول التحليلية هنا: monthly_cashflow per_supplier_monthly
# balances_snapshot installments_summary installments_aging forecast_base
# seasonal_index etl_runs  (يعيد بناءها ETL — استبعادها يُبقي النسخة صغيرة).
APP_TABLES=(
  users
  suppliers
  supplier_caps
  scenarios
  assumptions
  scenario_adjustments
  payment_plans
  payment_plan_lines
  notes
  alerts
  app_settings
  audit_log
)

# --- تحقّقات أوّلية --------------------------------------------------------
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "خطأ: الحاوية '$CONTAINER' غير قيد التشغيل." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# --- بناء وسائط -t لكل جدول -----------------------------------------------
TABLE_ARGS=()
for t in "${APP_TABLES[@]}"; do
  TABLE_ARGS+=( -t "public.$t" )
done

# --- تنفيذ النسخ ----------------------------------------------------------
TS="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/cashflow-apptables-${DB_NAME}-${TS}.dump"

echo "النسخ الاحتياطي: قاعدة='$DB_NAME' حاوية='$CONTAINER' → $OUT_FILE"
echo "الجداول (${#APP_TABLES[@]}): ${APP_TABLES[*]}"

# -Fc = صيغة custom (مضغوطة، تسمح بـ pg_restore انتقائي).
# --no-owner / --no-privileges = نسخة قابلة للاستعادة في أي مستخدم.
# نمرّر الإخراج عبر stdout من الحاوية إلى الملف على المضيف.
docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -Fc \
  --no-owner \
  --no-privileges \
  "${TABLE_ARGS[@]}" \
  > "$OUT_FILE"

# --- تحقّق من أن الملف غير فارغ -------------------------------------------
if [[ ! -s "$OUT_FILE" ]]; then
  echo "خطأ: ملف النسخة فارغ — فشل pg_dump." >&2
  rm -f "$OUT_FILE"
  exit 1
fi

SIZE="$(du -h "$OUT_FILE" | cut -f1)"

# --- الاحتفاظ: حذف النسخ الأقدم من RETENTION_DAYS -------------------------
DELETED=0
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  while IFS= read -r -d '' old; do
    rm -f "$old"
    DELETED=$((DELETED + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cashflow-apptables-*.dump' -mtime "+$RETENTION_DAYS" -print0)
fi

echo ""
echo "✅ نجح النسخ الاحتياطي."
echo "   الملف:  $OUT_FILE"
echo "   الحجم:  $SIZE"
if [[ "$DELETED" -gt 0 ]]; then
  echo "   الاحتفاظ: حُذِفت $DELETED نسخة أقدم من $RETENTION_DAYS يوماً."
fi
