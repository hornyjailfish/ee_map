import type { Surreal, Tokens } from 'surrealdb';
import type { DbSelection } from '$lib/server/db';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			/** Live Surreal session for this request (closed after the response). */
			session?: Surreal;
			/** Last access/refresh tokens loaded from cookies (null if signed out). */
			tokens: Tokens | null;
			/** Last selected namespace/database (from cookies, with env defaults). */
			selection: DbSelection;
			/**
			 * Active `app_config:<id>` key (cookie override, else APP_CONFIG_ID / main).
			 * Used by load/save overlay and resolveAppConfig.
			 */
			appConfigId: string;
			/** Optional authenticated principal id/label once you resolve it. */
			user?: string;
			/** Set when Surreal connect/auth failed; request still continues. */
			dbError?: string;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
