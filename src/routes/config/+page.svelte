<script lang="ts">
	import ConfigEditor from '$lib/components/config/ConfigEditor.svelte';
	import { stringifyOverlay } from '$lib/config/overlay-io';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Remount editor when the stored overlay changes (save / invalidate). */
	const overlayKey = $derived(stringifyOverlay(data.overlay));
</script>

{#key overlayKey}
	<ConfigEditor
		overlay={data.overlay}
		hasStoredOverlay={data.hasStoredOverlay}
		knownTables={data.knownTables}
		knownRelations={data.knownRelations}
		diagnostics={data.diagnostics}
		loadError={data.error}
	/>
{/key}
