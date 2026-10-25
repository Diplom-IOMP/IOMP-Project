import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

// Runtime copies of the contract, generated into @iomp/api-types by `pnpm gen:api-types`.
const generated = join(dirname(require.resolve('@iomp/api-types/package.json')), 'src');
const openapi = JSON.parse(readFileSync(join(generated, 'iomp-v1.json'), 'utf8')) as {
  components: { schemas: Record<string, Record<string, unknown>> };
};
const registry = JSON.parse(readFileSync(join(generated, 'event-types.json'), 'utf8')) as {
  types: Record<string, { fingerprint_labels?: string[] }>;
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

export function fingerprintLabels(eventType: string): string[] {
  return registry.types[eventType]?.fingerprint_labels ?? [];
}
