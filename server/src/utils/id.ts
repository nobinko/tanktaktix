import * as crypto from "crypto";

export function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Math.random().toString(16).slice(2)} -${Math.random().toString(16).slice(2)} `;
}
