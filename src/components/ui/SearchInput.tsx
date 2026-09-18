import { SearchInput as UiSearchInput, type SearchInputProps as UiSearchInputProps } from '@estiva-app/ui'

/**
 * Peek's SearchInput: the shared one from @estiva-app/ui (2026-09-01). The
 * default placeholder is the only thing that is Peek's — the package says
 * just "Search…".
 */
export type SearchInputProps = UiSearchInputProps

/** The package's search field, with Peek's own placeholder: "Search Peek...". */
export function SearchInput({ placeholder = 'Search Peek...', ...props }: SearchInputProps) {
  return <UiSearchInput placeholder={placeholder} {...props} />
}
