// Copies the contract files the API needs at runtime into JSON next to the generated types:
// the OpenAPI document (request validation) and the event type registry.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const contracts = new URL('../../../../contracts/', import.meta.url);
const out = new URL('../src/', import.meta.url);

for (const [source, target] of [
  ['openapi/iomp-v1.yaml', 'iomp-v1.json'],
  ['event-types.yaml', 'event-types.json'],
]) {
  const doc = parse(readFileSync(new URL(source, contracts), 'utf8'));
  writeFileSync(new URL(target, out), JSON.stringify(doc, null, 2) + '\n');
  console.log(`${source} -> ${fileURLToPath(new URL(target, out))}`);
}
