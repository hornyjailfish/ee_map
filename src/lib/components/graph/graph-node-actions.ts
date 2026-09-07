/**
 * Callbacks for graph node toolbars (add child / delete).
 * Set once from GraphView; read inside custom node components.
 */

import { createContext } from 'svelte';

export type GraphNodeParentRef = {
	id: string;
	table: string;
	label: string;
};

export type GraphNodeDeleteRef = {
	id: string;
	table: string;
	label: string;
};

export type GraphNodeActions = {
	/** Open add-child modal for the selected parent node. */
	requestAddChild: (parent: GraphNodeParentRef) => void;
	/** Confirm + delete a domain node after server success. */
	requestDeleteNode: (node: GraphNodeDeleteRef) => void;
};

const [getGraphNodeActions, setGraphNodeActions] = createContext<GraphNodeActions>();

export { getGraphNodeActions, setGraphNodeActions };
