from app.etl.scheduler import build_scheduler

def test_daily_job_registered_in_baghdad_tz():
    sched = build_scheduler(run_at="02:00", tz="Asia/Baghdad", job=lambda: None)
    jobs = sched.get_jobs()
    assert len(jobs) == 1
    assert str(jobs[0].trigger.timezone) == "Asia/Baghdad"
