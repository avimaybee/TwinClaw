import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveNotifier } from '../../src/services/proactive-notifier.js';
import { JobScheduler } from '../../src/services/job-scheduler.js';
import type { ProactiveTarget, ProactiveSendFn } from '../../src/services/proactive-notifier.js';
import type { SchedulerEvent } from '../../src/types/scheduler.js';
import type { FileEvent } from '../../src/types/file-watcher.js';

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
}));

// ── ProactiveNotifier tests ───────────────────────────────────────────────────

describe('ProactiveNotifier', () => {
  let sendFn: ReturnType<typeof vi.fn>;
  let defaultTarget: ProactiveTarget;

  beforeEach(() => {
    sendFn = vi.fn<Parameters<ProactiveSendFn>, ReturnType<ProactiveSendFn>>().mockResolvedValue(undefined);
    defaultTarget = { platform: 'telegram', chatId: '100' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- scheduler events --------------------------------------------------------

  it('dispatches an alert on job:error events', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const event: SchedulerEvent = {
      type: 'job:error',
      jobId: 'daily-heartbeat',
      timestamp: new Date('2026-02-20T10:00:00Z'),
      error: 'timeout after 30 s',
    };

    await notifier.onSchedulerEvent(event);

    expect(sendFn).toHaveBeenCalledOnce();
    const [target, text] = sendFn.mock.calls[0]!;
    expect(target).toEqual(defaultTarget);
    expect(text).toContain('Background Job Failed');
    expect(text).toContain('daily-heartbeat');
    expect(text).toContain('timeout after 30 s');
  });

  it('does NOT dispatch a notification on job:done events', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const event: SchedulerEvent = {
      type: 'job:done',
      jobId: 'cleanup-job',
      timestamp: new Date(),
    };

    await notifier.onSchedulerEvent(event);

    expect(sendFn).not.toHaveBeenCalled();
  });

  it('does NOT dispatch a notification on job:start events', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const event: SchedulerEvent = {
      type: 'job:start',
      jobId: 'heartbeat',
      timestamp: new Date(),
    };

    await notifier.onSchedulerEvent(event);

    expect(sendFn).not.toHaveBeenCalled();
  });

  // -- file events -------------------------------------------------------------

  it('dispatches a notification when a new file is detected (add)', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const event: FileEvent = {
      type: 'add',
      path: '/workspace/report.md',
      timestamp: new Date().toISOString(),
    };

    await notifier.onFileEvent(event);

    expect(sendFn).toHaveBeenCalledOnce();
    const [, text] = sendFn.mock.calls[0]!;
    expect(text).toContain('New File Detected');
    expect(text).toContain('/workspace/report.md');
  });

  it('dispatches a notification when an existing file is modified (change)', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const event: FileEvent = {
      type: 'change',
      path: '/workspace/notes.txt',
      timestamp: new Date().toISOString(),
    };

    await notifier.onFileEvent(event);

    expect(sendFn).toHaveBeenCalledOnce();
    const [, text] = sendFn.mock.calls[0]!;
    expect(text).toContain('File Modified');
    expect(text).toContain('/workspace/notes.txt');
  });

  it('silently ignores file unlink events', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const event: FileEvent = {
      type: 'unlink',
      path: '/workspace/deleted.txt',
      timestamp: new Date().toISOString(),
    };

    await notifier.onFileEvent(event);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('silently ignores directory events', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    for (const type of ['addDir', 'unlinkDir'] as const) {
      const event: FileEvent = { type, path: '/workspace/subdir', timestamp: new Date().toISOString() };
      await notifier.onFileEvent(event);
    }

    expect(sendFn).not.toHaveBeenCalled();
  });

  // -- enabled/disabled state --------------------------------------------------

  it('does not dispatch any notification when disabled', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget, false);

    await notifier.onSchedulerEvent({ type: 'job:error', jobId: 'j1', timestamp: new Date(), error: 'boom' });
    await notifier.onFileEvent({ type: 'add', path: '/f', timestamp: new Date().toISOString() });
    await notifier.notify('direct message');

    expect(sendFn).not.toHaveBeenCalled();
  });

  it('resumes dispatching after re-enabling', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget, false);
    expect(notifier.enabled).toBe(false);

    notifier.setEnabled(true);
    expect(notifier.enabled).toBe(true);

    await notifier.notify('now enabled');
    expect(sendFn).toHaveBeenCalledOnce();
  });

  // -- direct notify API -------------------------------------------------------

  it('notify() sends to the default target when no override is given', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    await notifier.notify('system alert');

    expect(sendFn).toHaveBeenCalledOnce();
    const [target, text] = sendFn.mock.calls[0]!;
    expect(target).toEqual(defaultTarget);
    expect(text).toBe('system alert');
  });

  it('notify() sends to an overriding target when provided', async () => {
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);
    const customTarget: ProactiveTarget = { platform: 'telegram', chatId: '999' };

    await notifier.notify('custom target message', customTarget);

    const [target] = sendFn.mock.calls[0]!;
    expect(target).toEqual(customTarget);
  });

  it('swallows delivery errors and does not throw', async () => {
    sendFn.mockRejectedValueOnce(new Error('network failure'));
    const notifier = new ProactiveNotifier(sendFn, defaultTarget);

    await expect(notifier.notify('unreachable')).resolves.toBeUndefined();
  });
});

// ── JobScheduler tests ────────────────────────────────────────────────────────

describe('JobScheduler', () => {
  let scheduler: JobScheduler;

  beforeEach(() => {
    scheduler = new JobScheduler();
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  it('registers a job and surfaces it in listJobs()', () => {
    scheduler.register({
      id: 'test-job',
      cronExpression: '*/5 * * * *',
      description: 'Every 5 minutes',
      handler: vi.fn(),
      autoStart: false,
    });

    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe('test-job');
    expect(jobs[0]?.status).toBe('idle');
  });

  it('throws when registering a duplicate job ID', () => {
    scheduler.register({
      id: 'dup-job',
      cronExpression: '0 * * * *',
      description: 'Hourly',
      handler: vi.fn(),
      autoStart: false,
    });

    expect(() =>
      scheduler.register({
        id: 'dup-job',
        cronExpression: '0 * * * *',
        description: 'Duplicate',
        handler: vi.fn(),
        autoStart: false,
      }),
    ).toThrow("'dup-job' is already registered");
  });

  it('throws when registering a job with an invalid cron expression', () => {
    expect(() =>
      scheduler.register({
        id: 'bad-cron',
        cronExpression: 'not-a-cron',
        description: 'Bad cron',
        handler: vi.fn(),
        autoStart: false,
      }),
    ).toThrow('Invalid cron expression');
  });

  it('unregisters a job and returns true', () => {
    scheduler.register({
      id: 'removable',
      cronExpression: '0 0 * * *',
      description: 'Daily',
      handler: vi.fn(),
      autoStart: false,
    });

    expect(scheduler.unregister('removable')).toBe(true);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('returns false when unregistering an unknown job', () => {
    expect(scheduler.unregister('ghost')).toBe(false);
  });

  it('getJob returns the snapshot for a known job', () => {
    scheduler.register({
      id: 'snapshot-job',
      cronExpression: '0 12 * * *',
      description: 'Noon job',
      handler: vi.fn(),
      autoStart: false,
    });

    const snap = scheduler.getJob('snapshot-job');
    expect(snap).toBeDefined();
    expect(snap?.cronExpression).toBe('0 12 * * *');
    expect(snap?.lastRunAt).toBeNull();
    expect(snap?.lastError).toBeNull();
  });

  it('getJob returns undefined for an unknown job', () => {
    expect(scheduler.getJob('missing')).toBeUndefined();
  });

  it('start throws for unknown job IDs', () => {
    expect(() => scheduler.start('unknown-job')).toThrow("'unknown-job' is not registered");
  });

  it('stop throws for unknown job IDs', () => {
    expect(() => scheduler.stop('unknown-job')).toThrow("'unknown-job' is not registered");
  });

  it('emits job:start and job:done events when a job executes successfully', async () => {
    const started: string[] = [];
    const done: string[] = [];

    scheduler.on('job:start', (e) => started.push(e.jobId));
    scheduler.on('job:done', (e) => done.push(e.jobId));

    // Use a real executor that runs immediately via direct #executeJob invocation
    // by creating a one-shot job with autoStart: false and manually triggering it
    let resolveHandler!: () => void;
    const handlerDone = new Promise<void>((res) => { resolveHandler = res; });

    scheduler.register({
      id: 'emit-test',
      cronExpression: '* * * * * *', // every second
      description: 'Emit test',
      handler: async () => {
        resolveHandler();
      },
      autoStart: false,
    });

    // Directly exercise the executor path by calling start and waiting
    scheduler.start('emit-test');

    // Wait for the cron tick — since the expression fires every second we
    // just wait a bit longer than 1 second for the first tick.
    await new Promise((res) => setTimeout(res, 1500));

    scheduler.stop('emit-test');

    // At least one tick should have occurred
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(done.length).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it('emits job:error event when a job handler throws', async () => {
    const errors: SchedulerEvent[] = [];

    scheduler.on('job:error', (e) => errors.push(e));

    scheduler.register({
      id: 'error-job',
      cronExpression: '* * * * * *',
      description: 'Will fail',
      handler: async () => {
        throw new Error('intentional-failure');
      },
      autoStart: false,
    });

    scheduler.start('error-job');
    await new Promise((res) => setTimeout(res, 1500));

    // Verify error state before stopping the job
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.error).toContain('intentional-failure');
    expect(scheduler.getJob('error-job')?.lastError).toContain('intentional-failure');

    scheduler.stop('error-job');
  }, 10_000);

  it('on() returns an unsubscribe function that removes the listener', async () => {
    const received: string[] = [];
    const unsubscribe = scheduler.on('job:done', (e) => received.push(e.jobId));

    scheduler.register({
      id: 'unsub-job',
      cronExpression: '* * * * * *',
      description: 'Unsub test',
      handler: vi.fn(),
      autoStart: false,
    });

    unsubscribe();
    scheduler.start('unsub-job');
    await new Promise((res) => setTimeout(res, 1500));
    scheduler.stop('unsub-job');

    expect(received).toHaveLength(0);
  }, 10_000);

  it('stopAll stops all running jobs and marks them stopped', () => {
    scheduler.register({
      id: 'job-x',
      cronExpression: '0 * * * *',
      description: 'Hourly X',
      handler: vi.fn(),
      autoStart: false,
    });
    scheduler.register({
      id: 'job-y',
      cronExpression: '0 * * * *',
      description: 'Hourly Y',
      handler: vi.fn(),
      autoStart: false,
    });

    scheduler.startAll();
    scheduler.stopAll();

    for (const job of scheduler.listJobs()) {
      expect(job.status).toBe('stopped');
    }
  });
});
