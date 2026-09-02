export const APP_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type CatalogUser = {
	name: string;
	roles: AppRole[];
};

export type AppCatalog = {
	namespaces: string[];
	namespace: string;
	databases: string[];
	users: CatalogUser[];
};
