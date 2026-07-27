/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as desk from "../desk.js";
import type * as dev_bulk from "../dev/bulk.js";
import type * as dev_seedDates from "../dev/seedDates.js";
import type * as dev_seedDemo from "../dev/seedDemo.js";
import type * as http from "../http.js";
import type * as huddles from "../huddles.js";
import type * as messages from "../messages.js";
import type * as nostr_act from "../nostr/act.js";
import type * as nostr_bridge from "../nostr/bridge.js";
import type * as nostr_data from "../nostr/data.js";
import type * as nostr_events from "../nostr/events.js";
import type * as nostr_foreign from "../nostr/foreign.js";
import type * as nostr_keys from "../nostr/keys.js";
import type * as nostr_nip19 from "../nostr/nip19.js";
import type * as nostr_nip98 from "../nostr/nip98.js";
import type * as nostr_projection from "../nostr/projection.js";
import type * as nostr_publish from "../nostr/publish.js";
import type * as nostr_sign from "../nostr/sign.js";
import type * as nostr_sync from "../nostr/sync.js";
import type * as people from "../people.js";
import type * as readState from "../readState.js";
import type * as replies from "../replies.js";
import type * as screener from "../screener.js";
import type * as topics from "../topics.js";
import type * as unread from "../unread.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  desk: typeof desk;
  "dev/bulk": typeof dev_bulk;
  "dev/seedDates": typeof dev_seedDates;
  "dev/seedDemo": typeof dev_seedDemo;
  http: typeof http;
  huddles: typeof huddles;
  messages: typeof messages;
  "nostr/act": typeof nostr_act;
  "nostr/bridge": typeof nostr_bridge;
  "nostr/data": typeof nostr_data;
  "nostr/events": typeof nostr_events;
  "nostr/foreign": typeof nostr_foreign;
  "nostr/keys": typeof nostr_keys;
  "nostr/nip19": typeof nostr_nip19;
  "nostr/nip98": typeof nostr_nip98;
  "nostr/projection": typeof nostr_projection;
  "nostr/publish": typeof nostr_publish;
  "nostr/sign": typeof nostr_sign;
  "nostr/sync": typeof nostr_sync;
  people: typeof people;
  readState: typeof readState;
  replies: typeof replies;
  screener: typeof screener;
  topics: typeof topics;
  unread: typeof unread;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
