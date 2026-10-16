<script lang="ts">
	/**
	 * SVAR inline editor for image fields (`image_url`).
	 *
	 * Editing the cell opens a modal to replace the row's reference image. The
	 * existing `images:<key>` filename is kept — the new bytes overwrite the same
	 * file via the Surreal file API (`file::put`), so `image_url` never changes and
	 * the server re-queues embedding renewal.
	 *
	 * Mirrors the other inline editors: seed from `editor.value`, render only cell
	 * chrome inside the SVAR `.wx-editor`, and delegate the real UI to a portaled
	 * bits-ui Dialog (no local trigger that would fight SVAR's editor/focus).
	 */
	import { invalidateAll } from '$app/navigation';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
	import { ApiError, postFormAction } from '$lib/client/http';
	import type { InlineEditorProps } from '$lib/client/editors/registry';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';

	let { editor, onsave, oncancel }: InlineEditorProps = $props();

	const recordId = $derived(String(editor.id ?? ''));
	const column = $derived(String(editor.column ?? ''));
	/** Stored `images:<key>` reference (unchanged on replace). */
	const imageRef = $derived(editor.value == null ? '' : String(editor.value));

	/** Only marker_views streams its image server-side (see /map/marker-image). */
	const previewUrl = $derived(
		recordId.startsWith('marker_views:') && /^images:[A-Za-z0-9_.\-/]+$/.test(imageRef)
			? `/map/marker-image?id=${encodeURIComponent(recordId)}`
			: null
	);

	let open = $state(true);
	let committed = false;
	let saving = $state(false);
	let error = $state<string | null>(null);
	let imageDataUrl = $state<string | null>(null);
	let imageName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

	function setOpen(next: boolean) {
		if (open === next) return;
		open = next;
		// Dismiss without a save → cancel the SVAR editor (re-focus the cell).
		if (!next && !committed) oncancel?.();
	}

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			fileError = 'Please choose an image file';
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			fileError = 'Image is too large (max 10 MB)';
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			imageDataUrl = typeof reader.result === 'string' ? reader.result : null;
			imageName = file.name;
			fileError = null;
		};
		reader.onerror = () => {
			fileError = 'Failed to read the image';
			imageDataUrl = null;
			imageName = null;
		};
		reader.readAsDataURL(file);
	}

	async function handleSave() {
		if (saving || !imageDataUrl) return;
		saving = true;
		error = null;
		try {
			await postFormAction('replaceImage', {
				id: recordId,
				field: column,
				data: imageDataUrl
			});
			committed = true;
			open = false;
			onsave?.(true);
			await invalidateAll();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to replace image';
			saving = false;
		}
	}
</script>

<div class="flex h-full w-full min-w-0 items-center gap-2 overflow-hidden px-2 text-sm">
	<ImagePlusIcon class="size-4 shrink-0 text-muted-foreground" />
	<span class="truncate text-muted-foreground">Replace image…</span>
</div>

<Dialog.Root bind:open={open} onOpenChange={setOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Replace image</Dialog.Title>
			<Dialog.Description>
				Upload a new image to replace the current one. The file name stays the same.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-3">
			{#if previewUrl}
				<div class="flex items-center gap-3 rounded-md border p-2">
					<img
						src={previewUrl}
						alt="Existing reference"
						class="size-16 shrink-0 rounded-md object-cover"
					/>
					<p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
						Current image will be overwritten.
					</p>
				</div>
			{:else}
				<p class="text-xs text-muted-foreground">No existing image to preview.</p>
			{/if}

			<Field.Field>
				<Field.Label for={`replace-image-${column}`}>New image</Field.Label>
				<input
					bind:this={fileInput}
					id={`replace-image-${column}`}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={onFileChange}
				/>
				{#if imageDataUrl}
					<div class="flex items-center gap-3">
						<img
							src={imageDataUrl}
							alt={imageName ?? 'Selected file preview'}
							class="size-16 shrink-0 rounded-md border object-cover"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-medium">{imageName}</p>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={saving}
								onclick={() => {
									imageDataUrl = null;
									imageName = null;
								}}
							>
								Remove
							</Button>
						</div>
					</div>
				{:else}
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={saving}
						onclick={() => fileInput?.click()}
					>
						<ImagePlusIcon class="size-3.5" data-icon="inline-start" />
						Choose image
					</Button>
				{/if}
				{#if fileError}
					<Field.Error>{fileError}</Field.Error>
				{/if}
			</Field.Field>

			{#if error}
				<Alert.Root variant="destructive">
					<CircleAlertIcon />
					<Alert.Title>Replace failed</Alert.Title>
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}
		</div>

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props} disabled={saving}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button type="button" disabled={saving || !imageDataUrl} onclick={handleSave}>
				{#if saving}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{/if}
				Replace image
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>