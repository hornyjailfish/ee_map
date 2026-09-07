<script lang="ts">
	import ConfigEditor from '$lib/components/config/ConfigEditor.svelte';
	import { emptyOverlay, stringifyOverlay } from '$lib/config/overlay-io';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const overlay = $derived(data.overlay ?? emptyOverlay());
	/** Remount editor when the stored overlay changes (save / invalidate). */
	const overlayKey = $derived(stringifyOverlay(overlay));
</script>

{#key overlayKey}
	<ConfigEditor
		{overlay}
		hasStoredOverlay={data.hasStoredOverlay}
		knownTables={data.knownTables ?? []}
		knownRelations={data.knownRelations ?? []}
		diagnostics={data.diagnostics ?? []}
		loadError={data.error}
	/>
{/key}
