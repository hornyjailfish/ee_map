<script lang="ts">
	import ConfigEditor from '$lib/components/config/ConfigEditor.svelte';
	import { emptyOverlay, stringifyOverlay } from '$lib/config/overlay-io';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const overlay = $derived(data.overlay ?? emptyOverlay());
	/** Remount editor when stored overlay or active id changes (save / switch / invalidate). */
	const editorKey = $derived(`${data.overlayId}::${stringifyOverlay(overlay)}`);
</script>

{#key editorKey}
	<ConfigEditor
		{overlay}
		hasStoredOverlay={data.hasStoredOverlay}
		overlayId={data.overlayId}
		availableOverlayIds={data.availableOverlayIds ?? []}
		envOverlayId={data.envOverlayId ?? 'main'}
		knownTables={data.knownTables ?? []}
		knownRelations={data.knownRelations ?? []}
		diagnostics={data.diagnostics ?? []}
		loadError={data.error}
	/>
{/key}
