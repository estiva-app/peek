/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as desk from "../desk.js";
import type * as dev_bulk from "../dev/bulk.js";
import type * as dev_seedDates from "../dev/seedDates.js";
import type * as dev_seedDemo from "../dev/seedDemo.js";
import type * as huddles from "../huddles.js";
import type * as identityProbe from "../identityProbe.js";
import type * as messages from "../messages.js";
import type * as nostr_config from "../nostr/config.js";
import type * as nostr_data from "../nostr/data.js";
import type * as nostr_events from "../nostr/events.js";
import type * as nostr_nip19 from "../nostr/nip19.js";
import type * as nostr_nip98 from "../nostr/nip98.js";
import type * as nostr_outbox from "../nostr/outbox.js";
import type * as nostr_projection from "../nostr/projection.js";
import type * as nostr_refs from "../nostr/refs.js";
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
  crons: typeof crons;
  desk: typeof desk;
  "dev/bulk": typeof dev_bulk;
  "dev/seedDates": typeof dev_seedDates;
  "dev/seedDemo": typeof dev_seedDemo;
  huddles: typeof huddles;
  identityProbe: typeof identityProbe;
  messages: typeof messages;
  "nostr/config": typeof nostr_config;
  "nostr/data": typeof nostr_data;
  "nostr/events": typeof nostr_events;
  "nostr/nip19": typeof nostr_nip19;
  "nostr/nip98": typeof nostr_nip98;
  "nostr/outbox": typeof nostr_outbox;
  "nostr/projection": typeof nostr_projection;
  "nostr/refs": typeof nostr_refs;
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
