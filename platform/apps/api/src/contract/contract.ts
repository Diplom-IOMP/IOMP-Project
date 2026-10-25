import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

// Runtime copies of the contract, generated into @iomp/api-types by `pnpm gen:api-types`.
const generated = join(dirname(require.resolve('@iomp/api-types/package.json')), 'src');
const openapi = JSON.parse(readFileSync(join(generated, 'iomp-v1.json'), 'utf8')) as {
  components: { schemas: Record<string, Record<string, unknown>> };
};
interface EventTypeRule {
  severity?: string[];
  status?: string[];
  condition_id?: string;
  labels?: { required?: Record<string, unknown> };
  fingerprint_labels?: string[];
}
const registry = JSON.parse(readFileSync(join(generated, 'event-types.json'), 'utf8')) as {
  types: Record<string, EventTypeRule>;
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'iomp-v1', components: openapi.components });

const schema = (name: string): Record<string, unknown> => {
  const found = openapi.components.schemas[name];
  if (!found) throw new Error(`Schema ${name} is missing from the contract`);
  return found;
};

// The ingest envelope is validated without its events: a bad envelope rejects the whole batch
// (422), a bad event rejects only that item.
const ingestRequest = schema('IngestRequest') as { properties: Record<string, Record<string, unknown>> };
export const validateIngestEnvelope: ValidateFunction = ajv.compile({
  ...ingestRequest,
  properties: { ...ingestRequest.properties, events: { type: 'array', minItems: 1 } },
});
export const validateInputEvent: ValidateFunction = ajv.compile({ $ref: 'iomp-v1#/components/schemas/InputEvent' });

export function fieldOf(error: ErrorObject): string {
  if (error.keyword === 'required') return `${error.instancePath}/${String(error.params.missingProperty)}`;
  if (error.keyword === 'additionalProperties') {
    return `${error.instancePath}/${String(error.params.additionalProperty)}`;
  }
  return error.instancePath || '/';
}

export function eventTypeRegistered(eventType: string): boolean {
  return Object.hasOwn(registry.types, eventType);
}

export interface RuleViolation {
  field: string;
  detail: string;
}

// Per-type rules from contracts/event-types.yaml: allowed severity and status, whether
// condition_id is required or forbidden, and the required labels.
export function checkEventTypeRules(event: {
  event_type: string;
  severity: string;
  status: string;
  condition_id?: string;
  labels: Record<string, string>;
}): RuleViolation | undefined {
  const rule = registry.types[event.event_type];
  if (!rule) return undefined;
  if (rule.severity && !rule.severity.includes(event.severity)) {
    return { field: '/severity', detail: `${event.event_type} allows severity ${rule.severity.join(', ')}` };
  }
  if (rule.status && !rule.status.includes(event.status)) {
    return { field: '/status', detail: `${event.event_type} allows status ${rule.status.join(', ')}` };
  }
  const condition = rule.condition_id?.trim() ?? '';
  if (condition === 'forbidden' && event.condition_id !== undefined) {
    return { field: '/condition_id', detail: `${event.event_type} must not have condition_id` };
  }
  if (condition.startsWith('required') && !event.condition_id) {
    return { field: '/condition_id', detail: `${event.event_type} requires condition_id` };
  }
  for (const label of Object.keys(rule.labels?.required ?? {})) {
    if (!Object.hasOwn(event.labels, label)) {
      return { field: `/labels/${label}`, detail: `${event.event_type} requires label ${label}` };
    }
  }
  return undefined;
}

export function fingerprintLabels(eventType: string): string[] {
  return registry.types[eventType]?.fingerprint_labels ?? [];
}
