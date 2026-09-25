/**
 * Serializable marker context shared by server resolve + client marker modal.
 * Mirrors the auto-generated description parts (level · zone · shop) and the
 * structured ids persisted on the `embeddings` row.
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
	draftDescription: string;
};
