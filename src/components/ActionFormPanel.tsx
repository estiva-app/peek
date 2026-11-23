import { ActionFormFields as LauncherFormFields, type ActionFormFieldsProps as LauncherFormFieldsProps } from '@estiva-app/launcher'
import { PEEK_FORM } from './launcherForm'

/**
 * The fields of a form drawn from an action declaration, in the launcher's
 * form level.
 *
 * The fields themselves are `@estiva-app/launcher`'s since KIN-4, the same in
 * every app. What only Peek knows about them is in `launcherForm`: what `[`
 * and `@` offer inside a description, how a reference draws, and the person
 * picker over Peek's people.
 */
export type ActionFormFieldsProps = Omit<LauncherFormFieldsProps, 'form'>

export function ActionFormFields(props: ActionFormFieldsProps) {
  return <LauncherFormFields form={PEEK_FORM} {...props} />
}
