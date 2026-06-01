# الخطة 0 — التحقق والأساس (Foundation & Discovery) — خطة تنفيذ

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** إرساء أساس النظام: تنفيذ مهام التحقّق الإلزامية مقابل قاعدة المحاسبة الحيّة، وسقالة المشروع، وتشغيل PostgreSQL في Docker بمخطّط قاعدة التطبيق كاملاً عبر هجرات Alembic، مع مستخدم SQL للقراءة فقط وإدارة الأسرار.

**Architecture:** monorepo تحت `cashflow-web/` (خلفية Python بحزمة واحدة تضم `domain`/`etl`/`api`/`db`، وواجهة منفصلة لاحقاً). قاعدة المحاسبة `AlBaytAlSaeid` للقراءة فقط؛ قاعدة التطبيق PostgreSQL منفصلة (جداول تحليلية + جداول تطبيق). الأسرار في `.env` غير متعقَّب.

**Tech Stack:** Python 3.12، SQLAlchemy 2.x + Alembic، PostgreSQL 16 (Docker)، pymssql (قراءة من SQL Server)، pytest، Docker Compose.

**المرجع:** المواصفة المُعالَجة `docs/superpowers/specs/2026-06-01-cashflow-web-system-design.md` (خاصة §3 نموذج البيانات، §4 ETL، §8 الأمان، §9 النشر، §15 المهام الإلزامية).

**هذه الخطة 0 من 5** (التحقق والأساس). الخطط 1–4 تتبع.

---

## بنية الملفات (Plan 0)

```
cashflow-web/
├── .gitignore
├── .env.example                      # قالب الأسرار (يُنسخ إلى .env المحلي غير المتعقَّب)
├── docs/
│   └── discovery/
│       ├── 00-schema-probe.md        # مخرجات فحص المخطّط الفعلي
│       ├── 01-installments-aging.md  # هل توجد حقول استحقاق؟
│       ├── 02-partner-accounts.md    # تمييز حسابات 2518
│       └── 03-classifier-tie-out.md  # مطابقة OperationsType مقابل أرصدة الصناديق
├── backend/
│   ├── pyproject.toml                # تبعيات + إعداد pytest
│   ├── alembic.ini                   # إعداد Alembic (مستوى backend)
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py                 # تحميل الإعدادات من البيئة (.env)
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── base.py               # SQLAlchemy DeclarativeBase + المحرّك
│   │   │   └── models.py             # كل جداول قاعدة التطبيق + التحليلية
│   │   └── migrations/               # Alembic (env.py + versions/)
│   │       ├── env.py
│   │       └── versions/
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py               # تجهيز قاعدة اختبار + جلسة
│       ├── test_config.py
│       └── test_schema.py            # تأكيد إنشاء الجداول + قيود الفرادة
└── docker/
    └── compose.cashflow.yml          # خدمة postgres (تُدمج لاحقاً في compose الرئيسي)
```

> **حدود الوحدات:** `db/models.py` يُعرّف المخطّط فقط (لا منطق أعمال). `config.py` يقرأ البيئة فقط. مهام التحقّق (discovery) تُخرج وثائق Markdown يعتمد عليها بناء ETL في الخطة 1.

---

## Chunk A: مهام التحقّق الإلزامية (Discovery / Gating)

> **طبيعة هذا الـ chunk استكشافية لا TDD**: تشغيل استعلامات قراءة فقط على القاعدة الحيّة وتوثيق الحقائق. يجب أن تكتمل قبل بناء ETL (الخطة 1) لأن نتائجها تحسم تفاصيل التنفيذ.
>
> **متطلّب مسبق:** Docker يعمل والحاوية `mssql-server` نشطة. للتحقق: `docker ps | grep mssql-server`. إن لم تكن نشطة: `docker start mssql-server` أو `docker compose -f /Users/ak/Documents/sqlserver-docker/docker-compose.yml up -d`.

### Task A1: التأكد من الاتصال بقاعدة المحاسبة

**Files:**
- Create: `cashflow-web/docs/discovery/00-schema-probe.md`

- [ ] **Step 1: تأكيد عمل الحاوية والاتصال**

Run:
```bash
docker ps | grep mssql-server
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d AlBaytAlSaeid \
  -Q "SELECT COUNT(*) AS BondCount FROM Bonds;"
```
Expected: رقم قريب من 208,339 (المذكور في `CLAUDE.md`). إن فشل الاتصال، أوقف وأصلح قبل المتابعة.

- [ ] **Step 2: توثيق أعمدة الجداول الأساسية**

Run (لكل جدول: `Bonds`, `accounts`, `tAccounts`, `Premiums`, `PremiumPays`):
```bash
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d AlBaytAlSaeid \
  -Q "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Bonds' ORDER BY ORDINAL_POSITION;"
```

- [ ] **Step 3: توثيق النتائج**

اكتب في `00-schema-probe.md`: أعمدة كل جدول وأنواعها، وأي اختلاف عن `CLAUDE.md`. علّم بوضوح أي عمود مذكور في المواصفة وغير موجود فعلاً.

- [ ] **Step 4: Commit**

```bash
git add cashflow-web/docs/discovery/00-schema-probe.md
git commit -m "docs(discovery): probe AlBaytAlSaeid live schema"
```

### Task A2: التحقق من حقول استحقاق الأقساط (aging)

**Files:**
- Create: `cashflow-web/docs/discovery/01-installments-aging.md`

- [ ] **Step 1: فحص أعمدة Premiums/PremiumPays بحثاً عن تاريخ استحقاق**

Run:
```bash
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d AlBaytAlSaeid \
  -Q "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ('Premiums','PremiumPays') AND (COLUMN_NAME LIKE '%Date%' OR COLUMN_NAME LIKE '%Due%' OR COLUMN_NAME LIKE '%استحقاق%');"
```

- [ ] **Step 2: توثيق القرار**

اكتب في `01-installments-aging.md`: هل يوجد جدول جدولة أقساط لكل قسط بتاريخ استحقاق؟ إن **نعم**: نوع الحقل وكيفية حساب الشرائح (current/0-30/31-60/61-90/91-120/120+). إن **لا**: نعتمد رقم "متبقٍ" واحد فقط (نسقط شرائح الأعمار من النسخة الأولى) — حدّث المواصفة §3.1/§4.5 وفق ذلك.

- [ ] **Step 3: Commit**

```bash
git add cashflow-web/docs/discovery/01-installments-aging.md
git commit -m "docs(discovery): confirm installments due-date schema for aging"
```

### Task A3: تمييز حسابات الشركاء (نوع 2518)

**Files:**
- Create: `cashflow-web/docs/discovery/02-partner-accounts.md`

- [ ] **Step 1: سرد حسابات السحوبات (2518) وأحجامها**

Run:
```bash
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d AlBaytAlSaeid \
  -Q "SELECT a.AccountId, a.Name, ta.Balance FROM accounts a LEFT JOIN tAccounts ta ON ta.AccountId=a.AccountId WHERE a.AccountTypeId=2518 AND a.Deleted=0 ORDER BY ta.Balance;"
```

- [ ] **Step 2: توثيق القرار**

اكتب في `02-partner-accounts.md`: هل يمكن تمييز الشركاء الثلاثة (أحمد كوان، فؤاد كريم، علي كوان) بحسابات منفصلة؟ سجّل `AccountId` لكل شريك إن أمكن. إن تعذّر: نعرض سحوبات الشركاء **كإجمالي** (نوع 2518) دون تفصيل أسماء، ونثبّت ذلك في المواصفة §4.5.

- [ ] **Step 3: Commit**

```bash
git add cashflow-web/docs/discovery/02-partner-accounts.md
git commit -m "docs(discovery): identify partner (2518) accounts"
```

### Task A4: مطابقة التصنيف الأولية (tie-out spike)

**Files:**
- Create: `cashflow-web/docs/discovery/03-classifier-tie-out.md`

- [ ] **Step 1: مقارنة الصافي المُصنَّف بحركة الصناديق لشهر عيّنة**

Run (شهر عيّنة 2026-04): تجميع `Amount1` حسب `OperationsType` للحركات الداخلة/الخارجة من الصناديق:
```bash
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U cashflow_ro -P "$MSSQL_READONLY_PASSWORD" -C -d AlBaytAlSaeid -Q "
SELECT b.OperationsType,
  SUM(CASE WHEN at.AccountTypeId IN (1811,1812) THEN b.Amount1 ELSE 0 END)/1000000.0 AS IntoCash_M,
  SUM(CASE WHEN af.AccountTypeId IN (1811,1812) THEN b.Amount1 ELSE 0 END)/1000000.0 AS OutOfCash_M
FROM Bonds b
LEFT JOIN accounts af ON af.AccountId=b.AccountFromId
LEFT JOIN accounts at ON at.AccountId=b.AccountToId
WHERE b.Deleted=0 AND ISNULL(b.IsEdit,0)=0
  AND b.Date >= '2026-04-01' AND b.Date < '2026-05-01'
GROUP BY b.OperationsType ORDER BY b.OperationsType;"
```
صافي حركة الصناديق للشهر = Σ(IntoCash) − Σ(OutOfCash). قارنه بالصافي المُصنَّف (مقبوضات Type 0 − مصروفات Types 1/5/7) للشهر نفسه، وسجّل الفرق.

- [ ] **Step 2: توثيق حجم الفرق المتوقع**

اكتب في `03-classifier-tie-out.md`: حجم فرق المطابقة المتوقع وسببه (بيانات صناديق ناقصة كما في `CLAUDE.md`)، وعتبة `reconciliation_residual_m` المعقولة للتنبيه. هذا يغذّي §4.3.

- [ ] **Step 3: Commit**

```bash
git add cashflow-web/docs/discovery/03-classifier-tie-out.md
git commit -m "docs(discovery): baseline classifier tie-out vs cash-box deltas"
```

---

## Chunk B: سقالة المشروع + Docker + الأسرار + مستخدم قراءة-فقط

### Task B1: تهيئة Git والسقالة الأساسية

**Files:**
- Create: `cashflow-web/.gitignore`, `cashflow-web/.env.example`, `cashflow-web/backend/pyproject.toml`

- [ ] **Step 1: تهيئة مستودع Git (إن لم يوجد)**

Run:
```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow"
git rev-parse --is-inside-work-tree 2>/dev/null || git init
```

- [ ] **Step 2: كتابة `.gitignore`**

```gitignore
# cashflow-web/.gitignore (أو على مستوى الجذر)
.env
*.pyc
__pycache__/
.venv/
node_modules/
dist/
.superpowers/
*.bin
```

- [ ] **Step 3: كتابة `.env.example`**

```dotenv
# قاعدة المحاسبة (قراءة فقط)
MSSQL_HOST=mssql
MSSQL_PORT=1433
MSSQL_DB=AlBaytAlSaeid
MSSQL_READONLY_USER=cashflow_ro
MSSQL_READONLY_PASSWORD=__SET_ME__
# قاعدة التطبيق
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=cashflow
POSTGRES_USER=cashflow
POSTGRES_PASSWORD=__SET_ME__
# التطبيق
APP_SECRET_KEY=__SET_ME__
APP_TZ=Asia/Baghdad
ETL_DAILY_AT=02:00
```

- [ ] **Step 4: كتابة `pyproject.toml`**

```toml
[project]
name = "cashflow-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "sqlalchemy>=2.0", "alembic>=1.13", "psycopg[binary]>=3.2",
  "pymssql>=2.3", "pandas>=2.2", "pydantic-settings>=2.3",
]
[project.optional-dependencies]
dev = ["pytest>=8", "pytest-cov"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 5: Commit**

```bash
git add cashflow-web/.gitignore cashflow-web/.env.example cashflow-web/backend/pyproject.toml
git commit -m "chore: scaffold cashflow-web project + secrets template"
```

### Task B2: خدمة PostgreSQL في Docker

**Files:**
- Create: `cashflow-web/docker/compose.cashflow.yml`

- [ ] **Step 1: تعريف خدمة postgres على نفس شبكة المشروع**

```yaml
# docker/compose.cashflow.yml — تُشغَّل بـ -p sqlserver-docker للانضمام لنفس الشبكة
services:
  postgres:
    image: postgres:16
    container_name: cashflow-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - cashflow_pgdata:/var/lib/postgresql/data
volumes:
  cashflow_pgdata:
```

- [ ] **Step 2: تشغيل والتأكد**

Run:
```bash
cd "/Users/ak/Documents/sqlserver-docker/Monthly cash flow/cashflow-web"
docker compose --env-file .env -f docker/compose.cashflow.yml up -d
docker exec cashflow-postgres pg_isready -U "$POSTGRES_USER"
```
Expected: `accepting connections`.

- [ ] **Step 3: Commit**

```bash
git add cashflow-web/docker/compose.cashflow.yml
git commit -m "feat(infra): add PostgreSQL service for app DB"
```

### Task B3: مستخدم SQL Server للقراءة فقط

**Files:**
- Create: `cashflow-web/docs/discovery/04-readonly-login.md`

- [ ] **Step 1: إنشاء تسجيل دخول قراءة-فقط (لا يُستخدم `sa`)**

Run (يُستبدل كلمة المرور بقيمة قوية تُحفظ في `.env`):
```bash
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "
CREATE LOGIN cashflow_ro WITH PASSWORD='$MSSQL_READONLY_PASSWORD';
USE AlBaytAlSaeid;
CREATE USER cashflow_ro FOR LOGIN cashflow_ro;
ALTER ROLE db_datareader ADD MEMBER cashflow_ro;"
```

- [ ] **Step 2: التحقق أن المستخدم يقرأ ولا يكتب**

Run:
```bash
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U cashflow_ro -P "$MSSQL_READONLY_PASSWORD" -C -d AlBaytAlSaeid -Q "SELECT TOP 1 Id FROM Bonds;"
# يجب أن ينجح. واختبار منع الكتابة:
docker exec -i mssql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U cashflow_ro -P "$MSSQL_READONLY_PASSWORD" -C -d AlBaytAlSaeid -Q "UPDATE Bonds SET Amount1=Amount1 WHERE 1=0;"
```
Expected: القراءة تنجح، الكتابة تُرفض (permission denied).

- [ ] **Step 3: توثيق + تحديث `.env` المحلي**

اكتب الخطوات في `04-readonly-login.md` (دون كلمة المرور الحقيقية)، وضع كلمة المرور في `.env` المحلي.

- [ ] **Step 4: Commit**

```bash
git add cashflow-web/docs/discovery/04-readonly-login.md
git commit -m "docs(infra): create read-only SQL login for ETL"
```

---

## Chunk C: مخطّط قاعدة التطبيق (SQLAlchemy + Alembic) مع اختبارات

### Task C1: إعداد التهيئة وقاعدة SQLAlchemy

**Files:**
- Create: `cashflow-web/backend/app/config.py`, `cashflow-web/backend/app/db/base.py`
- Test: `cashflow-web/backend/tests/test_config.py`

- [ ] **Step 1: كتابة اختبار فاشل للتهيئة**

```python
# tests/test_config.py
from app.config import settings

def test_postgres_url_built_from_env(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_USER", "u")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p")
    monkeypatch.setenv("POSTGRES_DB", "d")
    from importlib import reload
    import app.config as c; reload(c)
    assert c.settings.postgres_url == "postgresql+psycopg://u:p@localhost:5432/d"
    assert c.settings.app_tz == "Asia/Baghdad"
```

- [ ] **Step 2: تشغيل الاختبار للتأكد من فشله**

Run: `cd cashflow-web/backend && python -m pytest tests/test_config.py -v`
Expected: FAIL (`ModuleNotFoundError: app.config`).

- [ ] **Step 3: تنفيذ `config.py`**

```python
# app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    postgres_host: str = "postgres"; postgres_port: int = 5432
    postgres_db: str = "cashflow"; postgres_user: str = "cashflow"; postgres_password: str = ""
    app_tz: str = "Asia/Baghdad"
    @property
    def postgres_url(self) -> str:
        return f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

settings = Settings()
```

- [ ] **Step 4: تشغيل الاختبار للتأكد من نجاحه**

Run: `python -m pytest tests/test_config.py -v` — Expected: PASS.

- [ ] **Step 5: تنفيذ `db/base.py`**

```python
# app/db/base.py
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.config import settings

class Base(DeclarativeBase): pass
engine = create_engine(settings.postgres_url, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)
```

- [ ] **Step 6: Commit**

```bash
git add cashflow-web/backend/app/config.py cashflow-web/backend/app/db/base.py cashflow-web/backend/tests/test_config.py
git commit -m "feat(db): settings + SQLAlchemy base"
```

### Task C2: نماذج قاعدة التطبيق (الجداول التطبيقية + التحليلية)

**Files:**
- Create: `cashflow-web/backend/app/db/models.py`
- Test: `cashflow-web/backend/tests/test_schema.py`, `cashflow-web/backend/tests/conftest.py`

> **المرجع الملزم:** تُنفَّذ **كل** الجداول والأعمدة والقيود تماماً كما في المواصفة §3 (التحليلية §3.1 والتطبيقية §3.2)، بما فيها المفاتيح الفريدة المركّبة (`balances_snapshot`, `installments_aging`)، وقيد فرادة `assumptions` (صف عام واحد + واحد لكل سيناريو)، وقيد `payment_plans (year_month, scenario_id)`. الكود أدناه يضع النمط ويُكمَل لبقية الجداول. **ملاحظة**: قيد `assumptions` الجزئي (صف عام واحد + واحد لكل سيناريو) يُتحقَّق منه على Postgres في `test_migrations.py`، لأن قاعدة SQLite في `conftest` لا تطبّق الفهارس الجزئية.

- [ ] **Step 1: كتابة اختبار فاشل لإنشاء المخطّط والقيود**

```python
# tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
import app.db.models  # noqa: يسجّل النماذج

@pytest.fixture
def session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'t.db'}", future=True)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, future=True)()
```

```python
# tests/test_schema.py
import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from app.db import models

EXPECTED_TABLES = {
    "etl_runs","monthly_cashflow","per_supplier_monthly","balances_snapshot",
    "installments_summary","installments_aging","seasonal_index","forecast_base",
    "users","suppliers","supplier_caps","scenarios","assumptions",
    "scenario_adjustments","payment_plans","payment_plan_lines","notes","alerts",
    "app_settings","audit_log",
}

def test_all_tables_created(session):
    names = set(inspect(session.bind).get_table_names())
    assert EXPECTED_TABLES.issubset(names)

def test_payment_plan_unique_month_scenario(session):
    sc = models.Scenario(name="base", kind="base", is_baseline=True); session.add(sc); session.flush()
    session.add(models.PaymentPlan(year_month="2026-05", scenario_id=sc.id, pool_for_suppliers_m=0, reserve_m=15, status="draft")); session.commit()
    session.add(models.PaymentPlan(year_month="2026-05", scenario_id=sc.id, pool_for_suppliers_m=0, reserve_m=15, status="draft"))
    with pytest.raises(IntegrityError):
        session.commit()
```

- [ ] **Step 2: تشغيل الاختبار للتأكد من فشله**

Run: `python -m pytest tests/test_schema.py -v`
Expected: FAIL (`models` غير مكتمل / الجداول غير موجودة).

- [ ] **Step 3: تنفيذ `db/models.py` لكل الجداول (نمط ممثِّل)**

```python
# app/db/models.py
from datetime import datetime, date
from sqlalchemy import (String, Integer, Numeric, Boolean, Date, DateTime,
                        Text, ForeignKey, UniqueConstraint, Index, JSON)
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

class MonthlyCashflow(Base):
    __tablename__ = "monthly_cashflow"
    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)
    cash_in_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_suppliers_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_drawings_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_refunds_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_purchases_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_salaries_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_other_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_siyrafa_m: Mapped[float] = mapped_column(Numeric, default=0)
    internal_transfers_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_total_operational_m: Mapped[float] = mapped_column(Numeric, default=0)
    out_total_comprehensive_m: Mapped[float] = mapped_column(Numeric, default=0)
    net_operating_m: Mapped[float] = mapped_column(Numeric, default=0)
    net_total_m: Mapped[float] = mapped_column(Numeric, default=0)
    cash_running_m: Mapped[float] = mapped_column(Numeric, default=0)
    bond_count: Mapped[int] = mapped_column(Integer, default=0)
    fiscal_year: Mapped[str] = mapped_column(String(9))

class BalancesSnapshot(Base):
    __tablename__ = "balances_snapshot"
    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    currency_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_name: Mapped[str] = mapped_column(Text)
    account_kind: Mapped[str] = mapped_column(String(16))
    balance_m: Mapped[float] = mapped_column(Numeric, default=0)
    balance_iqd_m: Mapped[float] = mapped_column(Numeric, default=0)
    last_active: Mapped[date | None] = mapped_column(Date, nullable=True)

class Scenario(Base):
    __tablename__ = "scenarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class PaymentPlan(Base):
    __tablename__ = "payment_plans"
    __table_args__ = (UniqueConstraint("year_month", "scenario_id", name="uq_plan_month_scenario"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year_month: Mapped[str] = mapped_column(String(7))
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id"))
    pool_for_suppliers_m: Mapped[float] = mapped_column(Numeric, default=0)
    reserve_m: Mapped[float] = mapped_column(Numeric, default=0)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# ... يُكمَل: EtlRun, PerSupplierMonthly, InstallmentsSummary, InstallmentsAging
#     (PK مركّب snapshot_date+bucket_key), SeasonalIndex, ForecastBase,
#     User, Supplier, SupplierCap, Assumption (+ partial unique index عبر Index(..., unique=True,
#     postgresql_where=...)), ScenarioAdjustment, PaymentPlanLine, Note, Alert, AppSettings, AuditLog.
#     جميعها بالأعمدة والقيود الواردة في المواصفة §3 حرفياً.
```

- [ ] **Step 4: تشغيل الاختبار للتأكد من نجاحه**

Run: `python -m pytest tests/test_schema.py -v`
Expected: PASS (كل الجداول موجودة + قيد الفرادة يعمل).

- [ ] **Step 5: Commit**

```bash
git add cashflow-web/backend/app/db/models.py cashflow-web/backend/tests/
git commit -m "feat(db): app + analytical table models with constraints"
```

### Task C3: تهيئة Alembic وأول هجرة

**Files:**
- Create: `cashflow-web/backend/alembic.ini`, `cashflow-web/backend/app/migrations/env.py`, `.../versions/0001_initial.py`
- Test: `cashflow-web/backend/tests/test_migrations.py`

- [ ] **Step 1: تهيئة Alembic**

Run: `cd cashflow-web/backend && alembic init app/migrations` ثم اضبط `alembic.ini`/`env.py` لاستخدام `settings.postgres_url` و`Base.metadata` (target_metadata).

- [ ] **Step 2: كتابة اختبار فاشل لتطابق الهجرة مع النماذج**

```python
# tests/test_migrations.py — تعمل على قاعدة Postgres اختبار (عبر POSTGRES_DB=cashflow_test)
from alembic.config import Config
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine
from app.config import settings
from app.db.base import Base
import app.db.models  # noqa: يسجّل النماذج

def _cfg(): return Config("alembic.ini")

def test_upgrade_downgrade_cycle_idempotent():
    command.upgrade(_cfg(), "head")
    command.downgrade(_cfg(), "base")
    command.upgrade(_cfg(), "head")  # دورة كاملة دون أخطاء

def test_no_model_migration_drift():
    # autogenerate لا يكتشف أي فرق بين النماذج والهجرة المطبّقة (تطابق)
    eng = create_engine(settings.postgres_url, future=True)
    with eng.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == [], f"انجراف بين النماذج والهجرة: {diff}"

def test_assumptions_partial_unique_enforced():
    # على Postgres فقط: صف عام وحيد (scenario_id IS NULL) — الإدخال الثاني يفشل
    from sqlalchemy import text
    eng = create_engine(settings.postgres_url, future=True)
    with eng.begin() as c:
        c.execute(text("DELETE FROM assumptions WHERE scenario_id IS NULL"))
        c.execute(text("INSERT INTO assumptions (scenario_id, usd_rate) VALUES (NULL, 1350)"))
    import pytest
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(text("INSERT INTO assumptions (scenario_id, usd_rate) VALUES (NULL, 1400)"))
```

- [ ] **Step 3: توليد الهجرة الأولى**

Run: `alembic revision --autogenerate -m "initial schema"` ثم راجع `0001_initial.py` ليشمل كل الجداول والقيود.

- [ ] **Step 4: تطبيق الهجرة على قاعدة Postgres والتأكد**

Run:
```bash
alembic upgrade head
docker exec cashflow-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"
```
Expected: ظهور الـ20 جدولاً. واختبار `alembic downgrade base && alembic upgrade head` ينجح (idempotent).

- [ ] **Step 5: Commit**

```bash
git add cashflow-web/backend/alembic.ini cashflow-web/backend/app/migrations/
git commit -m "feat(db): alembic initial migration for full schema"
```

---

## نهاية الخطة 0

**المخرَج:** قاعدة PostgreSQL تعمل بمخطّط قاعدة التطبيق كاملاً (20 جدولاً) عبر هجرات، مستخدم SQL قراءة-فقط، أسرار في `.env`، ووثائق تحقّق تحسم الأقساط والشركاء والمخطّط. **يُحدَّث الـ spec** إن كشفت مهام التحقّق فروقاً (الأقساط/الشركاء).

**التالي:** الخطة 1 — ETL + domain.
