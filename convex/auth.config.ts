/**
 * Whose tokens Convex will accept.
 *
 * **Estiva ID only, since PEEK-41.** There was a second provider here pointing
 * at `CONVEX_SITE_URL` — Convex Auth's own issuer, served by the HTTP routes
 * that `convex/auth.ts` mounted. Both are gone, so that entry would have Convex
 * fetching `/.well-known/openid-configuration` from a deployment that no longer
 * serves one.
 *
 * `domain` is the issuer: Convex fetches `<domain>/.well-known/openid-configuration`,
 * follows `jwks_uri`, and requires the token's `iss` to equal this exactly.
 *
 * `applicationID` is matched against the token's `aud`, which Estiva ID sets to
 * the calling app's client_id — so this string must stay in step with the
 * `estiva-peek` row in that service's `app_credentials`.
 */
export default {
  providers: [
    {
      domain: 'https://id.estiva.app',
      applicationID: 'estiva-peek',
    },
  ],
}
