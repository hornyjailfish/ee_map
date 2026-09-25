/**
 * Embedding client — thin proxy over an LM Studio (OpenAI-compatible) embeddings
 * endpoint. Jina Embeddings V5 Omni is multimodal: text and image map into one
 * vector space, but we keep text / image vectors in *separate* columns so the
 * caller can skip the image pass when only text is provided (and vice versa).
 *
 * No auth for now, per product decision. Config flows from env vars with LM
 * Studio defaults (default model + localhost:1234).
 */

export type EmbeddingConfig = {
	/** e.g. `http://127.0.0.1:1234/v1` (no trailing slash). */
	baseUrl: string;
	/** LM Studio model id. */
	model: string;
	timeoutMs: number;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
const DEFAULT_MODEL = 'jina-embeddings-v5-omni-small-retrieval';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Thrown when the embedding service is unreachable / errors out. */
export class EmbeddingServiceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EmbeddingServiceError';
	}
}

export function resolveEmbeddingConfig(
	env: Record<string, string | undefined> = process.env
): EmbeddingConfig {
	const baseUrl = (env.EMBEDDING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
	const timeoutRaw = Number(env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
	return {
		baseUrl,
		model: env.EMBEDDING_MODEL ?? DEFAULT_MODEL,
		timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS
	};
}

type EmbeddingsPayload = {
	data: Array<{ embedding?: number[] }>;
};

async function requestEmbedding(cfg: EmbeddingConfig, input: unknown): Promise<number[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
	try {
		const res = await fetch(`${cfg.baseUrl}/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: cfg.model, input }),
			signal: controller.signal
		});

		if (!res.ok) {
			throw new EmbeddingServiceError(`Embedding service ${res.status} ${res.statusText}`);
		}

		const json = (await res.json()) as EmbeddingsPayload;
		const vector = json.data?.[0]?.embedding;
		if (!Array.isArray(vector) || vector.length === 0) {
			throw new EmbeddingServiceError('Embedding service returned an empty vector');
		}
		return vector.map(Number);
	} catch (error) {
		if (error instanceof EmbeddingServiceError) throw error;
		if (error instanceof Error && error.name === 'AbortError') {
			throw new EmbeddingServiceError('Embedding service timed out');
		}
		throw new EmbeddingServiceError(error instanceof Error ? error.message : 'Embedding failed');
	} finally {
		clearTimeout(timer);
	}
}

export type EmbeddingClient = {
	model: string;
	/** Embed a text query/marker description. */
	embedText: (text: string) => Promise<number[]>;
	/** Embed an image — pass a base64 data URL. */
	embedImage: (imageDataUrl: string) => Promise<number[]>;
};

export function createEmbeddingClient(
	cfg: EmbeddingConfig = resolveEmbeddingConfig()
): EmbeddingClient {
	return {
		model: cfg.model,
		embedText: (text) => requestEmbedding(cfg, text),
		// Multimodal vLLM / LM Studio embeddings accept image content parts.
		// Payload shape may need tuning per LM Studio build — isolated here.
		embedImage: (imageDataUrl) =>
			requestEmbedding(cfg, [{ type: 'image_url', image_url: { url: imageDataUrl } }])
	};
}
