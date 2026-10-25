#!/usr/bin/env node
// Validates contracts/fixtures/** against contracts/openapi/iomp-v1.yaml, contracts/event-types.yaml
// and the rules in contracts/fixtures/README.md. Usage: node validate-fixtures.cjs <repo root>.
// Needs ajv, ajv-formats and yaml on NODE_PATH (installed by the workflow).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;
const YAML = require('yaml');

const root = path.resolve(process.argv[2] ?? '.');
const contracts = path.join(root, 'contracts');
const openapi = YAML.parse(fs.readFileSync(path.join(contracts, 'openapi/iomp-v1.yaml'), 'utf8'));
const registry = YAML.parse(fs.readFileSync(path.join(contracts, 'event-types.yaml'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'iomp-v1', components: openapi.components });

const errors = [];
const fail = (fixture, message) => errors.push(`${fixture}: ${message}`);

// Follows a local $ref ('#/components/...') inside the OpenAPI document.
function deref(node) {
  while (node && typeof node.$ref === 'string') {
    node = node.$ref
      .slice(2)
      .split('/')
      .reduce((value, key) => value?.[key], openapi);
  }
  return node;
}

function schemaRef(schema) {
  return schema.$ref ? { $ref: `iomp-v1${schema.$ref}` } : schema;
}

function validate(schema, value) {
  const check = ajv.compile(schemaRef(schema));
  return check(value) ? [] : check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}

const dir = path.join(contracts, 'fixtures');
const fixtures = new Map();
for (const group of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const file of fs.readdirSync(path.join(dir, group.name)).filter((f) => f.endsWith('.json'))) {
    const name = `${group.name}/${file.slice(0, -5)}`;
    try {
      fixtures.set(name, JSON.parse(fs.readFileSync(path.join(dir, group.name, file), 'utf8')));
    } catch (error) {
      fail(name, `not valid JSON: ${error.message}`);
    }
  }
}

const keys = new Map();
for (const [name, fixture] of fixtures) {
  const group = name.split('/')[0];
  for (const field of ['description', 'preconditions', 'request', 'response']) {
    if (!(field in fixture)) fail(name, `missing "${field}"`);
  }
  if (!fixture.request || !fixture.response) continue;

  for (const pre of fixture.preconditions ?? []) {
    if (!fixtures.has(`${group}/${pre}`)) fail(name, `precondition ${pre} does not exist`);
  }

  const { method, path: url, headers = {}, body } = fixture.request;
  const operation = openapi.paths?.[url]?.[String(method).toLowerCase()];
  if (!operation) {
    fail(name, `${method} ${url} is not in the OpenAPI document`);
    continue;
  }

  // Request body. A 422 fixture must be invalid on purpose; a null body needs a generator.
  const requestSchema = deref(operation.requestBody)?.content?.['application/json']?.schema;
  if (body === null) {
    if (!fixture.request.body_generator) fail(name, 'body is null without body_generator');
  } else if (requestSchema) {
    const problems = validate(requestSchema, body);
    if (fixture.response.status === 422 && problems.length === 0) {
      fail(name, 'expects 422 but the request body is valid');
    } else if (fixture.response.status !== 422 && problems.length > 0) {
      fail(name, `request body: ${problems.join('; ')}`);
    }
    for (const [i, event] of (body.events ?? []).entries()) {
      if (event?.event_type && !Object.hasOwn(registry.types ?? {}, event.event_type)) {
        fail(name, `events[${i}].event_type ${event.event_type} is not in event-types.yaml`);
      }
    }
  }

  // Idempotency-Key: unique, except when shared with a precondition (README "Independence").
  const key = headers['Idempotency-Key'];
  if (key !== undefined) {
    const owner = keys.get(key);
    if (owner && !(fixture.preconditions ?? []).some((pre) => `${group}/${pre}` === owner)) {
      const other = fixtures.get(owner);
      if (!(other.preconditions ?? []).some((pre) => `${group}/${pre}` === name)) {
        fail(name, `Idempotency-Key is also used by ${owner}, which is not a precondition`);
      }
    }
    if (!owner) keys.set(key, name);
  }

  // Response body against the documented response for that status.
  const { status, headers: responseHeaders = {}, body: responseBody } = fixture.response;
  const response = deref(operation.responses?.[String(status)]);
  if (!response) {
    fail(name, `status ${status} is not documented for ${method} ${url}`);
    continue;
  }
  const contentType = String(responseHeaders['Content-Type'] ?? '');
  const responseSchema = response.content?.[contentType]?.schema;
  if (!responseSchema) {
    fail(name, `no schema for ${status} ${contentType}`);
  } else {
    const problems = validate(responseSchema, responseBody);
    if (problems.length > 0) fail(name, `response body: ${problems.join('; ')}`);
  }

  if (status === 202 && responseBody?.items) {
    const items = responseBody.items;
    const rejected = items.filter((item) => item.status === 'Rejected').length;
    if (responseBody.accepted_count !== items.length - rejected) fail(name, 'accepted_count does not match items');
    if (responseBody.rejected_count !== rejected) fail(name, 'rejected_count does not match items');
    if (body?.events && items.length !== body.events.length) fail(name, 'items do not match the request events');
    items.forEach((item, i) => {
      if (item.index !== i) fail(name, `items[${i}].index is ${item.index}`);
      if (body?.events?.[i] && item.source_event_id !== body.events[i].source_event_id) {
        fail(name, `items[${i}].source_event_id does not match events[${i}]`);
      }
    });
  }
  if (status === 429 || status === 503) {
    const retryAfter = responseHeaders['Retry-After'];
    if (!/^[1-9][0-9]*$/.test(String(retryAfter))) fail(name, 'Retry-After must be a positive integer');
    if (responseBody?.retry_after_seconds !== undefined && String(responseBody.retry_after_seconds) !== retryAfter) {
      fail(name, 'retry_after_seconds differs from Retry-After');
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.log(`::error::${error}`);
  process.exit(1);
}
console.log(`${fixtures.size} fixtures valid.`);
