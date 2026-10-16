import { unavailableMemory } from '@estiva-app/ui'

/**
 * Chosen cards this device last found not available — deleted, or not this
 * reader's to see — so the next open draws the one-line row from the first
 * paint instead of a card's height that then closes (OPT-10; Miky, 14 Oct).
 * The kit's memory (`unavailableMemory`), under the key Peek has used since
 * OPT-10, so what a device remembered before the kit still counts. Cleared
 * with the rest of the device's copy (`deviceCopy`).
 */
const memory = unavailableMemory('peek.unavailable-cards', 300)

export function rememberedUnavailable(reference: string): boolean {
  return memory.has(reference)
}

export function noteCardAvailability(reference: string, available: boolean): void {
  memory.note(reference, available)
}

export function clearUnavailableCards(): void {
  memory.clear()
}
