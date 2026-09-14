/**
 * Client-only node UI controls (no backend writes).
 * Set once from GraphCanvas; read inside custom node components.
 */

import { createContext } from 'svelte';

export type GraphNodeUiFlags = {
	selectable?: boolean;
	draggable?: boolean;
};

export type GraphNodeUiActions = {
	/** Toggle whether the node can be selected. */
	setSelectable: (id: string, value: boolean) => void;
	/** Toggle whether the node can be dragged. */
	setDraggable: (id: string, value: boolean) => void;
	/** Re-run ELK layout (only meaningful for compound nodes). */
	layoutNode: (id: string) => void;
};

const [getGraphNodeUi, setGraphNodeUi] = createContext<GraphNodeUiActions>();

export { getGraphNodeUi, setGraphNodeUi };
