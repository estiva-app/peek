// Moved to @estiva-app/launcher, which every app's ⌘K runs on (KIN-4). The path stays so Peek's callers do not change.
export {
  type CatalogueEntry,
  isProposable,
  PROPOSAL_SCHEMA,
  proposalInstruction,
  NO_PROPOSAL,
  type Proposal,
  readProposal,
  probeable,
} from '@estiva-app/launcher'
