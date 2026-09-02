/**
 * Client registry: config `nodeType` / graph `role` → Svelte Flow node components.
 * Keys must stay strings — ResolvedConfig never embeds components.
 * One component per type (Svelte Flow custom node registry).
 */

import type { NodeTypes } from '@xyflow/svelte';
import BoardNode from '$lib/components/graph/nodes/BoardNode.svelte';
import BreakerNode from '$lib/components/graph/nodes/BreakerNode.svelte';
import DefaultNode from '$lib/components/graph/nodes/DefaultNode.svelte';
import GroupNode from '$lib/components/graph/nodes/GroupNode.svelte';
import OutputNode from '$lib/components/graph/nodes/OutputNode.svelte';
import RoomNode from '$lib/components/graph/nodes/RoomNode.svelte';

/**
 * Default map used by GraphView.
 * Explicit role keys + default/entity fallbacks.
 * Define outside components so SF does not warn about new nodeTypes objects.
 */
export const nodeTypes = {
	room: RoomNode,
	board: BoardNode,
	breaker: BreakerNode,
	output: OutputNode,
	group: GroupNode,
	default: DefaultNode,
	entity: DefaultNode
} satisfies NodeTypes;

export type RegisteredNodeType = keyof typeof nodeTypes;
