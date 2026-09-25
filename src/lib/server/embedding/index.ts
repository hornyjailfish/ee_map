export {
	createEmbeddingClient,
	resolveEmbeddingConfig,
	EmbeddingServiceError,
	type EmbeddingClient,
	type EmbeddingConfig
} from './client';

export { resolveMarkerContext, type MarkerContext, type MarkerPoint } from './marker-context';

export {
	createEmbeddingMarker,
	reembedMarker,
	reembedMarkerAfterEdit,
	type CreateEmbeddingMarkerInput,
	type CreateEmbeddingMarkerResult,
	type MarkerEmbeddingStatus
} from './marker-mutate';
