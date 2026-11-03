import { randomBytes } from "node:crypto";

let lastMs = 0;
let seq = 0;

/** UUID v7 (RFC 9562), monotonic within a process so rows created in one run sort in creation order. */
export function uuidV7(nowMs = Date.now()): string {
  if (nowMs <= lastMs) { seq++; nowMs = lastMs; } else { lastMs = nowMs; seq = 0; }
  const b = randomBytes(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
