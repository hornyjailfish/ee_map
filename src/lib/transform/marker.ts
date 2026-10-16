/**
 * Serializable marker context shared by server resolve + client marker modal.
 * Holds the structured ids persisted on the `markers` row plus the human-readable
 * level / zone / shop names used for the modal badge.
 */

export type MarkerContextData = {
	levelId: string | null;
	levelName: string | null;
	zoneId: string | null;
	zoneName: string | null;
	rentId: string | null;
	rentName: string | null;
	shopId: string | null;
	shopName: string | null;
};
