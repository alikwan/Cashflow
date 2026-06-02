from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger


def build_scheduler(run_at: str, tz: str, job) -> BackgroundScheduler:
    """Return a BackgroundScheduler with one daily cron job. Caller must call .start()."""
    hour, minute = (int(part) for part in run_at.split(":"))
    sched = BackgroundScheduler()
    sched.add_job(job, trigger=CronTrigger(hour=hour, minute=minute, timezone=tz))
    return sched
