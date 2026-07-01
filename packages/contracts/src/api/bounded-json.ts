import type { JsonPrimitive } from '../common';

/** Generic bounded-JSON value/object types shared by the connectors API. */
export type BoundedJsonValue =
  | JsonPrimitive
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

export interface BoundedJsonObject {
  [key: string]: BoundedJsonValue;
}
