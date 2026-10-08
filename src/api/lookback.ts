/**
 * Buzz desktop's reconnect lookback (`relayReconnectReplay.ts`): the relay's
 * 960 s `created_at` floor, plus room for two clocks that disagree. Every
 * store that catches up from a cursor subtracts it — the channel store and the
 * held conversations (OPT-3).
 */
export const LOOKBACK_SECONDS = 1_870
