import { createHash } from 'node:crypto';
import type { Schemas } from '@iomp/api-types';
import { fingerprintLabels } from '../contract/contract';

// Fingerprint v1 (platform spec 4.4, ADR-CT-001 GAP-AG-006). Message, title, timestamp, severity
// and status never take part, so the opening and the recovery of one condition share it.
export function fingerprint(sourceId: string, event: Schemas['InputEvent']): string {
  const labels = fingerprintLabels(event.event_type)
    .filter((name) => Object.hasOwn(event.labels, name))
    .sort()
    .map((name) => [name, event.labels[name]]);
  const parts = [
    'v1',
    'default',
    sourceId,
    event.source_object_id ?? '',
    event.event_type,
    event.condition_id ?? '',
    labels,
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
