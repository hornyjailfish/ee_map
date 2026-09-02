/**
 * Client registry: config `edgeType` → Svelte Flow edge components.
 * Empty for v1 — built-in default edge is enough.
 */

import type { EdgeTypes } from '@xyflow/svelte';

/** Optional custom edge types; leave empty to use SF built-ins. */
export const edgeTypes = {} satisfies EdgeTypes;

export type RegisteredEdgeType = keyof typeof edgeTypes;
