import { describe, expect, it } from 'vitest';
import { DeliveryTracker } from '../../src/services/delivery-tracker.js';

describe('DeliveryTracker', () => {
  it('records a successful delivery lifecycle and exposes sent metrics', () => {
    const tracker = new DeliveryTracker();
    const recordId = tracker.createRecord('telegram', '123');

    tracker.recordAttemptStart(recordId);
    tracker.recordSuccess(recordId);

    const metrics = tracker.getMetrics();
    const record = metrics.recentRecords.find((item) => item.id === recordId);

    expect(metrics.totalSent).toBe(1);
    expect(metrics.totalFailed).toBe(0);
    expect(metrics.totalRetries).toBe(0);
    expect(metrics.averageAttempts).toBe(1);
    expect(record?.state).toBe('sent');
    expect(record?.resolvedAt).toBeDefined();
    expect(record?.attempts[0]?.durationMs).toBeTypeOf('number');
  });

  it('tracks retries and terminal failures', () => {
    const tracker = new DeliveryTracker();
    const recordId = tracker.createRecord('whatsapp', '5551112222');

    tracker.recordAttemptStart(recordId);
    tracker.recordFailure(recordId, 'timeout');
    tracker.recordAttemptStart(recordId);
    tracker.recordFailure(recordId, 'upstream-503');
    tracker.markFailed(recordId);

    const metrics = tracker.getMetrics();
    const record = metrics.recentRecords.find((item) => item.id === recordId);

    expect(metrics.totalSent).toBe(0);
    expect(metrics.totalFailed).toBe(1);
    expect(metrics.totalRetries).toBe(1);
    expect(metrics.averageAttempts).toBe(2);
    expect(record?.state).toBe('failed');
    expect(record?.attempts.length).toBe(2);
    expect(record?.attempts[1]?.error).toBe('upstream-503');
  });

  it('safely ignores unknown record IDs without throwing', () => {
    const tracker = new DeliveryTracker();

    expect(() => {
      tracker.recordAttemptStart('missing-record');
      tracker.recordFailure('missing-record', 'error');
      tracker.recordSuccess('missing-record');
      tracker.markFailed('missing-record');
    }).not.toThrow();

    const metrics = tracker.getMetrics();
    expect(metrics.totalSent).toBe(0);
    expect(metrics.totalFailed).toBe(0);
    expect(metrics.recentRecords).toHaveLength(0);
  });
});
