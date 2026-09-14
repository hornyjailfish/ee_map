import type { AppRole } from '$lib/catalog-types';

/** Roles that may modify domain data (table cells/rows, graph wires, map geometry). */
export const EDIT_ROLES: readonly AppRole[] = ['EDITOR', 'OWNER'] as const;

/** Roles that may administer app_config overlay. */
export const OWNER_ROLES: readonly AppRole[] = ['OWNER'] as const;

/**
 * Whether the given roles grant write access.
 * Pure — usable on client (hide controls) and server (enforce).
 */
export function canEdit(roles: readonly AppRole[] | undefined | null): boolean {
	if (!roles) return false;
	return roles.includes('EDITOR') || roles.includes('OWNER');
}

/**
 * Whether the given roles grant overlay admin (app config editor).
 * Pure — usable on client (nav/hide) and server (enforce).
 */
export function canOwn(roles: readonly AppRole[] | undefined | null): boolean {
	if (!roles) return false;
	return roles.includes('OWNER');
}
