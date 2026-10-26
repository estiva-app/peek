// Preload for the agent legs of app-speed.mjs (node --import): logs every fetch the agent makes — host, path,
// status, answer bytes, ms — as one JSON line on stderr prefixed "FETCH ". Bodies are not logged: a /token call
// carries the client secret.
const native = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  const started = Date.now()
  const response = await native(input, init)
  response.clone().arrayBuffer().then(
    (b) => process.stderr.write(`FETCH ${JSON.stringify({ host: url.host, path: url.pathname, status: response.status, bytes: b.byteLength, ms: Date.now() - started })}\n`),
    () => process.stderr.write(`FETCH ${JSON.stringify({ host: url.host, path: url.pathname, status: response.status, bytes: null })}\n`),
  )
  return response
}
