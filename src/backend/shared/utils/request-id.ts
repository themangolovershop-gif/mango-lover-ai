import { randomUUID } from "node:crypto";

export function createRequestId() {
  return randomUUID();
}
