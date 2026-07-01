/**
 * Generic bounded-JSON value/object types + validators, owned by the connectors feature.
 * Relocated out of the removed live-artifacts schema module; connectors and memory-connectors
 * depend on these to bound connector tool input/output JSON.
 */
export type BoundedJsonValue = null | boolean | number | string | BoundedJsonValue[] | { [key: string]: BoundedJsonValue };

export interface BoundedJsonObject {
  [key: string]: BoundedJsonValue;
}

export interface BoundedJsonValidationIssue {
  path: string;
  message: string;
}

export type BoundedJsonValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: BoundedJsonValidationIssue[] };

const BOUNDED_JSON_CONSTRAINTS = {
  maxDepth: 8,
  maxObjectKeys: 100,
  maxArrayLength: 500,
  maxStringLength: 16 * 1024,
  maxSerializedBytes: 256 * 1024,
} as const;

const FORBIDDEN_JSON_KEYS = new Set([
  'raw',
  'rawresponse',
  'payload',
  'body',
  'headers',
  'cookie',
  'authorization',
  'token',
  'secret',
  'credential',
  'password',
]);

function fail<T>(issues: BoundedJsonValidationIssue[]): BoundedJsonValidationResult<T> {
  return {
    ok: false,
    error: issues[0]?.message ?? 'Live artifact validation failed',
    issues,
  };
}

function ok<T>(value: T): BoundedJsonValidationResult<T> {
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateBoundedJsonInternal(value: unknown, path: string, issues: BoundedJsonValidationIssue[], depth: number): value is BoundedJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      issues.push({ path, message: `${path} must be a finite number` });
      return false;
    }
    return true;
  }

  if (typeof value === 'string') {
    if (value.length > BOUNDED_JSON_CONSTRAINTS.maxStringLength) {
      issues.push({
        path,
        message: `${path} exceeds max string length (${BOUNDED_JSON_CONSTRAINTS.maxStringLength})`,
      });
      return false;
    }
    return true;
  }

  if (Array.isArray(value)) {
    if (depth > BOUNDED_JSON_CONSTRAINTS.maxDepth) {
      issues.push({ path, message: `${path} exceeds max JSON depth (${BOUNDED_JSON_CONSTRAINTS.maxDepth})` });
      return false;
    }
    if (value.length > BOUNDED_JSON_CONSTRAINTS.maxArrayLength) {
      issues.push({
        path,
        message: `${path} exceeds max array length (${BOUNDED_JSON_CONSTRAINTS.maxArrayLength})`,
      });
      return false;
    }
    return value.every((item, index) => validateBoundedJsonInternal(item, `${path}.${index}`, issues, depth + 1));
  }

  if (isPlainObject(value)) {
    if (depth > BOUNDED_JSON_CONSTRAINTS.maxDepth) {
      issues.push({ path, message: `${path} exceeds max JSON depth (${BOUNDED_JSON_CONSTRAINTS.maxDepth})` });
      return false;
    }
    const entries = Object.entries(value);
    if (entries.length > BOUNDED_JSON_CONSTRAINTS.maxObjectKeys) {
      issues.push({
        path,
        message: `${path} exceeds max object keys (${BOUNDED_JSON_CONSTRAINTS.maxObjectKeys})`,
      });
      return false;
    }
    let valid = true;
    for (const [key, child] of entries) {
      if (FORBIDDEN_JSON_KEYS.has(key.toLowerCase())) {
        issues.push({ path: `${path}.${key}`, message: `${path}.${key} uses a forbidden key` });
        valid = false;
      }
      valid = validateBoundedJsonInternal(child, `${path}.${key}`, issues, depth + 1) && valid;
    }
    return valid;
  }

  issues.push({ path, message: `${path} must be JSON-serializable` });
  return false;
}

export function validateBoundedJsonValue(value: unknown, path = 'value'): BoundedJsonValidationResult<BoundedJsonValue> {
  const issues: BoundedJsonValidationIssue[] = [];
  if (validateBoundedJsonInternal(value, path, issues, 1)) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') <= BOUNDED_JSON_CONSTRAINTS.maxSerializedBytes) {
      return ok(value);
    }
    issues.push({
      path,
      message: `${path} exceeds max serialized size (${BOUNDED_JSON_CONSTRAINTS.maxSerializedBytes} bytes)`,
    });
  }
  return fail(issues);
}

export function validateBoundedJsonObject(value: unknown, path = 'value'): BoundedJsonValidationResult<BoundedJsonObject> {
  const result = validateBoundedJsonValue(value, path);
  if (!result.ok) return result;
  if (!isPlainObject(result.value)) {
    return fail([{ path, message: `${path} must be a JSON object` }]);
  }
  return ok(result.value);
}
