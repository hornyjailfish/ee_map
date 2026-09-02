<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedConfig } from '$lib/config/types';

	let {
		data
	}: {
		data: {
			selection: { namespace: string; database: string };
			user: string | null;
			dbError?: string | null;
			config: ResolvedConfig | null;
			configError?: string | null;
			catalog: {
				namespaces: string[];
				databases: string[];
				users: { name: string; roles: string[] }[];
			};
		};
	} = $props();

	const views = [
		{ href: '/table', label: 'Table', blurb: 'Tabular browse and edit' },
		{ href: '/graph', label: 'Graph', blurb: 'Relations and hierarchy' },
		{ href: '/map', label: 'Map', blurb: 'Spatial layout' }
	] as const;
</script>

<section class="mx-auto h-full max-w-3xl space-y-6 overflow-auto px-4 py-8">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Home</h1>
		<p class="text-sm text-muted-foreground">
			Connected to <span class="font-medium text-foreground">{data.selection.namespace}</span> /
			<span class="font-medium text-foreground">{data.selection.database}</span>
			{#if data.user}
				as <span class="font-medium text-foreground">{data.user}</span>
			{/if}
		</p>
	</div>

	<div class="grid gap-3 sm:grid-cols-3">
		{#each views as view (view.href)}
			<a
				href={resolve(view.href)}
				class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-muted/40"
			>
				<div class="text-sm font-semibold tracking-tight">{view.label}</div>
				<p class="mt-1 text-xs text-muted-foreground">{view.blurb}</p>
			</a>
		{/each}
	</div>

	<div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
		<p class="text-sm leading-relaxed">
			Use the <strong>Session</strong> control in the header to switch namespace, database, or
			namespace user. Catalog data comes from a system-level <code class="text-xs">viewer</code>
			session via <code class="text-xs">INFO FOR NS STRUCTURE</code>.
		</p>

		{#if data.dbError}
			<p class="mt-3 text-sm text-destructive">{data.dbError}</p>
		{/if}

		{#if data.config}
			<p class="mt-3 text-sm text-muted-foreground">
				Resolved config:
				<span class="font-medium text-foreground">{data.config.tables.length} tables</span>
				·
				<span class="font-medium text-foreground">{data.config.relations.length} relations</span>
				{#if data.config.diagnostics.length}
					·
					<span class="font-medium text-foreground"
						>{data.config.diagnostics.length} diagnostics</span
					>
				{/if}
			</p>
		{:else if data.configError}
			<p class="mt-3 text-sm text-destructive">Config: {data.configError}</p>
		{:else}
			<p class="mt-3 text-sm text-muted-foreground">Config not resolved (no live session).</p>
		{/if}

		<ul class="mt-4 space-y-1 text-sm text-muted-foreground">
			<li>
				<span class="font-medium text-foreground">Namespaces:</span>
				{data.catalog.namespaces.join(', ') || '—'}
			</li>
			<li>
				<span class="font-medium text-foreground">Databases:</span>
				{data.catalog.databases.join(', ') || '—'}
			</li>
			<li>
				<span class="font-medium text-foreground">Users:</span>
				{#if data.catalog.users.length === 0}
					—
				{:else}
					{data.catalog.users
						.map((u) => `${u.name}${u.roles.length ? ` [${u.roles.join('|')}]` : ''}`)
						.join(', ')}
				{/if}
			</li>
		</ul>
	</div>
</section>
