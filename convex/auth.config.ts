export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
    // Estiva ID (PEEK-29). Added *alongside* Convex Auth rather than replacing
    // it: this proves the identity service issues tokens Convex accepts, which
    // is a different question from moving Peek onto it (PEEK-38).
    //
    // `domain` is the issuer. Convex fetches
    // `<domain>/.well-known/openid-configuration`, follows `jwks_uri`, and
    // requires the token's `iss` to equal this exactly.
    //
    // `applicationID` is matched against the token's `aud`, which Estiva ID sets
    // to the calling app's client_id — so this string must stay in step with the
    // `estiva-peek` row in that service's `app_credentials`.
    {
      domain: 'https://id.estiva.app',
      applicationID: 'estiva-peek',
    },
  ],
}
