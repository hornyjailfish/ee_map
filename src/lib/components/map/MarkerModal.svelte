<script lang="ts">
	/**
	 * Marker save dialog (embedding search dataset).
	 * Shows the auto-generated context (level · zone · shop) and lets the editor
	 * edit the final `description` before saving. Parent resolves context and
	 * creates the marker via server actions.
	 */
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { MarkerContextData } from '$lib/transform/marker';

	type Props = {
		open?: boolean;
		context?: MarkerContextData | null;
		resolving?: boolean;
		submitting?: boolean;
		error?: string | null;
		/** Called on submit with the final description and optional image data URL. */
		onCreate?: (description: string, image: string | null) => void | Promise<void>;
	};

	let {
		open = $bindable(false),
		context = null,
		resolving = false,
		submitting = false,
		error = null,
		onCreate
	}: Props = $props();

	let description = $state('');
	let imageDataUrl = $state<string | null>(null);
	let imageName = $state<string | null>(null);
	let imageError = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let wasOpen = false;

	// Seed the editor when the dialog opens, before context resolves.
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) {
			description = context?.draftDescription ?? '';
			imageDataUrl = null;
			imageName = null;
			imageError = null;
		}
		wasOpen = isOpen;
	});

	// When context resolves while open (after the draw), fill the draft — but
	// never clobber text the editor has already started typing.
	$effect(() => {
		if (open && context?.draftDescription && description.trim() === '') {
			description = context.draftDescription;
		}
	});

	const contextLine = $derived(
		[context?.levelName, context?.zoneName, context?.shopName ?? context?.rentName]
			.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
			.join(' · ')
	);

	const canSubmit = $derived(!submitting && !resolving);

	const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			imageError = 'Please choose an image file';
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			imageError = 'Image is too large (max 10 MB)';
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			imageDataUrl = typeof reader.result === 'string' ? reader.result : null;
			imageName = file.name;
			imageError = null;
		};
		reader.onerror = () => {
			imageError = 'Failed to read the image';
			imageDataUrl = null;
			imageName = null;
		};
		reader.readAsDataURL(file);
	}

	function clearImage() {
		imageDataUrl = null;
		imageName = null;
		imageError = null;
	}

	async function handleSubmit() {
		if (!canSubmit) return;
		await onCreate?.(description.trim(), imageDataUrl);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[min(90vh,40rem)] flex-col gap-4 overflow-hidden sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Place search marker</Dialog.Title>
			<Dialog.Description>
				Add a point to the indoor search dataset. Descriptions are matched by text and image
				embeddings — the editor can refine the auto-generated draft.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-0.5">
			<div class="flex flex-wrap items-center gap-1.5">
				{#if resolving}
					<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<Spinner class="size-3" data-icon="inline-start" />
						Resolving map context…
					</span>
				{:else if contextLine}
					<Badge variant="secondary">{contextLine}</Badge>
				{:else}
					<span class="text-xs text-muted-foreground">No zone / shop matched at this point.</span>
				{/if}
			</div>

			<Field.Field>
				<Field.Label for="marker-description">Description</Field.Label>
				<Textarea
					id="marker-description"
					bind:value={description}
					placeholder="e.g. Level 2, North, Starbucks"
					rows={4}
					disabled={submitting || resolving}
					autocomplete="off"
				/>
				<Field.FieldDescription>
					Embedded as text — keep it specific and human-readable.
				</Field.FieldDescription>
			</Field.Field>

			<Field.Field>
				<Field.Label>Image (optional)</Field.Label>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={onFileChange}
				/>
				{#if imageDataUrl}
					<div class="flex items-center gap-3">
						<img
							src={imageDataUrl}
							alt={imageName ?? 'Marker image'}
							class="size-14 shrink-0 rounded-md border object-cover"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-medium">{imageName}</p>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={submitting}
								onclick={clearImage}
							>
								Remove image
							</Button>
						</div>
					</div>
				{:else}
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={submitting || resolving}
						onclick={() => fileInput?.click()}
					>
						<ImagePlusIcon class="size-3.5" data-icon="inline-start" />
						Upload image
					</Button>
				{/if}
				{#if imageError}
					<Field.Error>{imageError}</Field.Error>
				{/if}
				<Field.FieldDescription>
					Optional reference photo — embedded for image search.
				</Field.FieldDescription>
			</Field.Field>
		</div>

		{#if error}
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Save failed</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props} disabled={submitting}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button type="button" disabled={!canSubmit} onclick={handleSubmit}>
				{#if submitting}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{/if}
				Save marker
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
