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

export type GraphNodeEditRef = {
	id: string;
	table: string;
	label: string;
	/** Serialized writable field values to prefill the edit form. */
	values?: Record<string, string>;
};

export type GraphNodeActions = {
	/** Open add-child modal for the selected parent node. */
	requestAddChild: (parent: GraphNodeParentRef) => void;
	/** Open edit modal for a domain node's record. */
	requestEditNode: (node: GraphNodeEditRef) => void;
	/** Confirm + delete a domain node after server success. */
	requestDeleteNode: (node: GraphNodeDeleteRef) => void;
};

const [getGraphNodeActions, setGraphNodeActions] = createContext<GraphNodeActions>();

export { getGraphNodeActions, setGraphNodeActions };
