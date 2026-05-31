import { createId } from "@paralleldrive/cuid2";

export function generateBookingSlug(): string {
  return createId().slice(0, 12).toLowerCase();
}

export function generateIdempotencyKey(...parts: string[]): string {
  return parts.join(":");
}
