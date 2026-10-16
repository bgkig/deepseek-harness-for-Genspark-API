/**
 * Wire types of the `genspark` Remote namespace (no key literal ever appears in them).
 *
 * @module @deepseek-ai/dsh-llm-genspark/types
 */

/** Status of one slot, without the key literal. */
export interface GensparkKeySlotStatus {
  /** 1-based slot. */
  slot: number
  /** Credential reference holding the key. */
  ref: string
  /** Whether a key is stored. */
  configured: boolean
  /** Whether this is the key the next request uses. */
  active: boolean
  /** Last four characters of the key, for telling keys apart; absent when empty. */
  hint?: string
}

/** The last rotation this process performed. */
export interface GensparkRotationRecord {
  /** Abandoned slot. */
  from: number
  /** Slot now in use. */
  to: number
  /** Human-readable reason. */
  reason: string
  /** Whether the walk wrapped back to the first key. */
  wrapped: boolean
  /** Epoch milliseconds. */
  at: number
}

/** Rotation status for the settings page. */
export interface GensparkKeyStatus {
  /** Number of configured keys. */
  configured: number
  /** Slot the next request uses, when any key is configured. */
  activeSlot?: number
  /** Every slot, in order. */
  slots: GensparkKeySlotStatus[]
  /** The last rotation this process performed. */
  lastRotation?: GensparkRotationRecord
}

/** Result of a bulk key import. */
export interface GensparkImportResult {
  /** Keys stored. */
  stored: number
  /** Keys that did not fit into the remaining slots. */
  skipped: number
  /** Keys already present in some slot. */
  duplicates: number
}
