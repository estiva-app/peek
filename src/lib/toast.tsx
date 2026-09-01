/**
 * The toast and its provider are the shared ones (2026-09-01): @estiva-app/ui
 * owns the pill, the portal, the bottom-left position and the 5 s
 * auto-dismiss — verbatim what lived here. This file only keeps the import
 * path every caller already uses.
 */
export { ToastProvider, useToast, type ToastOptions } from '@estiva-app/ui'
