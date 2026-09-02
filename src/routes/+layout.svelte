<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Map</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
	<div class="shrink-0">
		<AppHeader
			selection={data.selection}
			user={data.user}
			catalog={data.catalog}
			dbError={data.dbError}
			userRoles={data.userRoles}
			configError={data.configError}
		/>
	</div>

	<main class="min-h-0 flex-1 overflow-hidden">
		{@render children()}
	</main>
</div>

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Pathname)}>{locale}</a>
	{/each}
</div>
