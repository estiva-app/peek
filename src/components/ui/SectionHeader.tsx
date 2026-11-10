/**
 * Peek's SectionHeader and SectionLabel are the shared ones (2026-09-01).
 * The label is the merged 9px micro-label (Katerina's ruling: the two
 * near-twins — this file's 12px span and the rail's 9px menu-token label —
 * are one thing now, mono under Signal as before). The header kept its look
 * and hover behaviour; its two hard-wired action slots became `actions`,
 * which nothing here had used yet. This file only keeps the import paths.
 */
export { SectionHeader, SectionLabel, type SectionAction, type SectionHeaderProps } from '@estiva-app/ui'
