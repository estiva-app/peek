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
import type * as messages from "../messages.js";
import type * as nostr_config from "../nostr/config.js";
import type * as nostr_data from "../nostr/data.js";
import type * as nostr_outbox from "../nostr/outbox.js";
import type * as nostr_refs from "../nostr/refs.js";
import type * as nostr_resolution from "../nostr/resolution.js";
import type * as nostr_sync from "../nostr/sync.js";
import type * as people from "../people.js";
import type * as readState from "../readState.js";
import type * as screener from "../screener.js";
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
  messages: typeof messages;
  "nostr/config": typeof nostr_config;
  "nostr/data": typeof nostr_data;
  "nostr/outbox": typeof nostr_outbox;
  "nostr/refs": typeof nostr_refs;
  "nostr/resolution": typeof nostr_resolution;
  "nostr/sync": typeof nostr_sync;
  people: typeof people;
  readState: typeof readState;
  screener: typeof screener;
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
