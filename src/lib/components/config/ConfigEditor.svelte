<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type {
		AppConfigOverlay,
		Diagnostic,
		EdgeOverlay,
		EntityOverlay,
		GraphLayoutAlign,
		GraphLayoutDirection,
		GraphRole
	} from '$lib/config/types';
	import {
		cloneOverlay,
		formatDisplayText,
		formatSortText,
		formatStringList,
		parseDisplayText,
		parseSortText,
		parseStringList,
		softParseOverlay,
		sortedKeys,
		stringifyOverlay
	} from '$lib/config/overlay-io';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SaveIcon from '@lucide/svelte/icons/save';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';

	const GRAPH_ROLES = ['room', 'board', 'breaker', 'output', 'group', 'ignore'] as const;
	const EDGE_ROLES = ['feeds', 'to-output', 'other', 'ignore'] as const;
	const LAYOUT_DIRS = ['DOWN', 'RIGHT'] as const;
	const LAYOUT_ALIGNS = ['start', 'center', 'balance'] as const;
	const SPACING_FIELDS = [
		['node', 'Node spacing'],
		['layer', 'Layer spacing'],
		['edgeLayer', 'Edge/layer spacing'],
		['edgeEdge', 'Edge/edge spacing'],
		['edgeNode', 'Edge/node spacing']
	] as const;

	type Props = {
		overlay: AppConfigOverlay;
		hasStoredOverlay: boolean;
		knownTables: string[];
		knownRelations: string[];
		diagnostics: Diagnostic[];
		loadError?: string | null;
	};

	let {
		overlay: initialOverlay,
		hasStoredOverlay,
		knownTables,
		knownRelations,
		diagnostics,
		loadError = null
	}: Props = $props();

	// Parent remounts via {#key} when server overlay changes — capture once.
	const initial = untrack(() => cloneOverlay(initialOverlay));
	const initialJson = untrack(() => stringifyOverlay(initialOverlay));

	/** Working draft — mutated via touchDraft / JSON apply / reset. */
	let draft = $state.raw(initial);
	let baseline = $state(initialJson);
	let tab = $state('general');
	/** null = auto-pick first key (derived below). */
	let entityPick = $state<string | null>(null);
	let edgePick = $state<string | null>(null);
	let newEntityKey = $state('');
	let newEdgeKey = $state('');
	let jsonText = $state(initialJson);
	let jsonError = $state<string | null>(null);
	let formMessage = $state<string | null>(null);
	let formOk = $state(false);
	let saving = $state(false);

	const dirty = $derived(stringifyOverlay(draft) !== baseline);
	const entityKeys = $derived(sortedKeys(draft.entities as Record<string, unknown> | undefined));
	const edgeKeys = $derived(sortedKeys(draft.edges as Record<string, unknown> | undefined));
	const selectedEntity = $derived(
		entityPick && entityKeys.includes(entityPick) ? entityPick : (entityKeys[0] ?? null)
	);
	const selectedEdge = $derived(
		edgePick && edgeKeys.includes(edgePick) ? edgePick : (edgeKeys[0] ?? null)
	);
	const searchTables = $derived(
		[...new Set([...knownTables, ...sortedKeys(draft.search?.fieldsByTable)])].sort((a, b) =>
			a.localeCompare(b)
		)
	);
	const payloadJson = $derived(stringifyOverlay(draft));

	const activeEntity = $derived.by((): EntityOverlay | undefined => {
		if (!selectedEntity || !draft.entities) return undefined;
		return draft.entities[selectedEntity];
	});
	const activeEdge = $derived.by((): EdgeOverlay | undefined => {
		if (!selectedEdge || !draft.edges) return undefined;
		return draft.edges[selectedEdge];
	});

	function touchDraft(mutator: (next: AppConfigOverlay) => void) {
		const next = cloneOverlay(draft);
		mutator(next);
		draft = next;
		if (tab === 'json') {
			jsonText = stringifyOverlay(next);
			jsonError = null;
		}
	}

	function resetDraft() {
		draft = cloneOverlay(initial);
		baseline = initialJson;
		jsonText = initialJson;
		jsonError = null;
		formMessage = null;
		formOk = false;
		entityPick = null;
		edgePick = null;
	}

	function applyJson(): boolean {
		const result = softParseOverlay(jsonText);
		if (!result.ok) {
			jsonError = result.message;
			return false;
		}
		draft = result.overlay;
		jsonText = stringifyOverlay(result.overlay);
		jsonError = null;
		return true;
	}

	function setExcludeTables(text: string) {
		touchDraft((next) => {
			const list = parseStringList(text);
			if (list.length) next.excludeTables = list;
			else delete next.excludeTables;
		});
	}

	function addEntity() {
		const key = newEntityKey.trim();
		if (!key) return;
		touchDraft((next) => {
			next.entities = { ...(next.entities ?? {}), [key]: next.entities?.[key] ?? {} };
		});
		entityPick = key;
		newEntityKey = '';
	}

	function removeEntity(key: string) {
		touchDraft((next) => {
			if (!next.entities) return;
			const { [key]: _removed, ...rest } = next.entities;
			if (Object.keys(rest).length) next.entities = rest;
			else delete next.entities;
		});
	}

	function patchEntity(key: string, patch: (entity: EntityOverlay) => void) {
		touchDraft((next) => {
			const current: EntityOverlay = { ...(next.entities?.[key] ?? {}) };
			patch(current);
			// Drop empty nested buckets
			if (current.graph && Object.keys(current.graph).length <= 1 && !current.graph.role) {
				delete current.graph;
			}
			if (current.map && Object.keys(current.map).length === 0) delete current.map;
			if (current.table && Object.keys(current.table).length === 0) delete current.table;
			next.entities = { ...(next.entities ?? {}), [key]: current };
		});
	}

	function ensureGraph(ent: EntityOverlay, role: GraphRole = 'group') {
		ent.graph = ent.graph ?? { role };
	}

	function addEdge() {
		const key = newEdgeKey.trim();
		if (!key) return;
		touchDraft((next) => {
			next.edges = { ...(next.edges ?? {}), [key]: next.edges?.[key] ?? { role: 'other' } };
		});
		edgePick = key;
		newEdgeKey = '';
	}

	function removeEdge(key: string) {
		touchDraft((next) => {
			if (!next.edges) return;
			const { [key]: _removed, ...rest } = next.edges;
			if (Object.keys(rest).length) next.edges = rest;
			else delete next.edges;
		});
	}

	function patchEdge(key: string, patch: (edge: EdgeOverlay) => void) {
		touchDraft((next) => {
			const current: EdgeOverlay = { ...(next.edges?.[key] ?? {}) };
			patch(current);
			next.edges = { ...(next.edges ?? {}), [key]: current };
		});
	}

	function ensureMap(next: AppConfigOverlay) {
		next.map = {
			units: next.map?.units ?? 'm',
			plane: next.map?.plane ?? 'xy-meters',
			...next.map
		};
	}

	function setSearchTableFields(table: string, text: string) {
		touchDraft((next) => {
			const fields = parseStringList(text);
			const byTable = { ...(next.search?.fieldsByTable ?? {}) };
			if (fields.length) byTable[table] = fields;
			else delete byTable[table];
			if (Object.keys(byTable).length) next.search = { fieldsByTable: byTable };
			else delete next.search;
		});
	}

	function setSpacing(prop: (typeof SPACING_FIELDS)[number][0], raw: string) {
		touchDraft((next) => {
			next.graph = { ...(next.graph ?? {}), layout: { ...(next.graph?.layout ?? {}) } };
			const spacing = { ...(next.graph.layout?.spacing ?? {}) };
			if (!raw.trim()) {
				delete spacing[prop];
			} else {
				const n = Number(raw);
				if (!Number.isFinite(n)) return;
				spacing[prop] = n;
			}
			if (Object.keys(spacing).length) next.graph.layout!.spacing = spacing;
			else delete next.graph.layout!.spacing;
		});
	}

	const onSave: SubmitFunction = () => {
		if (tab === 'json' && !applyJson()) {
			return async () => {
				/* blocked — invalid JSON */
			};
		}
		formMessage = null;
		formOk = false;
		saving = true;
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
				if (result.type === 'failure') {
					const data = result.data as { message?: string } | undefined;
					formMessage = data?.message ?? 'Save failed';
					formOk = false;
					return;
				}
				if (result.type === 'success') {
					formOk = true;
					formMessage = 'Saved app_config:main';
					await invalidateAll();
				}
			} finally {
				saving = false;
			}
		};
	};
</script>

<div class="flex h-full min-h-0 flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-2"
	>
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<span class="text-sm font-medium tracking-tight">App config</span>
			<Badge variant="secondary">OWNER</Badge>
			<span class="text-xs text-muted-foreground">app_config:main</span>
			{#if hasStoredOverlay}
				<Badge variant="outline">stored</Badge>
			{:else}
				<Badge variant="outline">new</Badge>
			{/if}
			{#if dirty}
				<Badge>unsaved</Badge>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={!dirty || saving}
				onclick={resetDraft}
			>
				<RotateCcwIcon data-icon="inline-start" />
				Reset
			</Button>
			<form method="POST" action="?/save" use:enhance={onSave}>
				<input type="hidden" name="overlay" value={payloadJson} />
				<Button type="submit" size="sm" disabled={saving || (!dirty && hasStoredOverlay)}>
					{#if saving}
						<Spinner data-icon="inline-start" />
					{:else}
						<SaveIcon data-icon="inline-start" />
					{/if}
					Save
				</Button>
			</form>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
			{#if loadError}
				<Alert.Root variant="destructive">
					<CircleAlertIcon />
					<Alert.Title>Load warning</Alert.Title>
					<Alert.Description>{loadError}</Alert.Description>
				</Alert.Root>
			{/if}

			{#if formMessage}
				<Alert.Root variant={formOk ? 'default' : 'destructive'}>
					<CircleAlertIcon />
					<Alert.Title>{formOk ? 'Saved' : 'Save failed'}</Alert.Title>
					<Alert.Description>{formMessage}</Alert.Description>
				</Alert.Root>
			{/if}

			<Alert.Root>
				<Alert.Title>Soft overlay contract</Alert.Title>
				<Alert.Description>
					Nested entity/edge/map keys stay free-form (SCHEMALESS). Structured tabs cover known
					fields; use the JSON tab for anything new. Seed uses INSERT IGNORE so local OWNER edits
					survive re-seed.
				</Alert.Description>
			</Alert.Root>

			<Tabs.Root bind:value={tab} class="flex flex-col gap-4">
				<Tabs.List class="flex h-auto w-full flex-wrap justify-start gap-1">
					<Tabs.Trigger value="general">General</Tabs.Trigger>
					<Tabs.Trigger value="entities">Entities</Tabs.Trigger>
					<Tabs.Trigger value="edges">Edges</Tabs.Trigger>
					<Tabs.Trigger value="graph">Graph</Tabs.Trigger>
					<Tabs.Trigger value="map">Map</Tabs.Trigger>
					<Tabs.Trigger value="search">Search</Tabs.Trigger>
					<Tabs.Trigger value="json">JSON</Tabs.Trigger>
					<Tabs.Trigger value="diagnostics">Diagnostics</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="general" class="flex flex-col gap-4">
					<Card.Root>
						<Card.Header>
							<Card.Title>Exclude tables</Card.Title>
							<Card.Description>
								Skipped in addition to system <code class="text-xs">__*</code> tables.
							</Card.Description>
						</Card.Header>
						<Card.Content>
							<Field.Field>
								<Field.FieldLabel for="exclude-tables">Tables (comma or newline)</Field.FieldLabel>
								<Textarea
									id="exclude-tables"
									rows={4}
									value={formatStringList(draft.excludeTables)}
									oninput={(e) => setExcludeTables(e.currentTarget.value)}
								/>
								<Field.FieldDescription>
									Typical: app_config, embeddings, __entity, __rollout
								</Field.FieldDescription>
							</Field.Field>
						</Card.Content>
					</Card.Root>
				</Tabs.Content>

				<Tabs.Content value="entities" class="flex flex-col gap-4">
					<div class="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
						<Card.Root class="h-fit">
							<Card.Header class="pb-3">
								<Card.Title class="text-base">Tables</Card.Title>
							</Card.Header>
							<Card.Content class="flex flex-col gap-2">
								<div class="flex flex-col gap-1">
									{#each entityKeys as key (key)}
										<button
											type="button"
											class={[
												'rounded-md px-2 py-1.5 text-left text-sm transition-colors',
												selectedEntity === key
													? 'bg-muted font-medium text-foreground'
													: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
											]}
											onclick={() => (entityPick = key)}
										>
											{key}
										</button>
									{:else}
										<p class="text-xs text-muted-foreground">No entity overlays yet.</p>
									{/each}
								</div>
								<Field.Field class="gap-2">
									<Input
										placeholder="table name"
										bind:value={newEntityKey}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												addEntity();
											}
										}}
									/>
									{#if knownTables.length}
										<NativeSelect.Root
											class="w-full"
											value=""
											onchange={(e) => {
												const v = e.currentTarget.value;
												if (!v) return;
												newEntityKey = v;
												addEntity();
												e.currentTarget.value = '';
											}}
										>
											<NativeSelect.Option value="" disabled>Add known table…</NativeSelect.Option>
											{#each knownTables as name (name)}
												<NativeSelect.Option value={name} disabled={entityKeys.includes(name)}>
													{name}
												</NativeSelect.Option>
											{/each}
										</NativeSelect.Root>
									{/if}
									<Button type="button" variant="outline" size="sm" onclick={addEntity}>
										<PlusIcon data-icon="inline-start" />
										Add
									</Button>
								</Field.Field>
							</Card.Content>
						</Card.Root>

						{#if selectedEntity && activeEntity}
							{@const key = selectedEntity}
							{@const entity = activeEntity}
							<Card.Root>
								<Card.Header class="flex-row items-start justify-between gap-2">
									<div class="flex flex-col gap-1">
										<Card.Title>{key}</Card.Title>
										<Card.Description>
											Sparse deltas only — field inventories come from live schema.
										</Card.Description>
									</div>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										onclick={() => removeEntity(key)}
									>
										<TrashIcon data-icon="inline-start" />
										Remove
									</Button>
								</Card.Header>
								<Card.Content>
									<Field.FieldGroup class="gap-4">
										<Field.Field>
											<Field.FieldLabel for="ent-label">Label</Field.FieldLabel>
											<Input
												id="ent-label"
												value={entity.label ?? ''}
												oninput={(e) =>
													patchEntity(key, (ent) => {
														const v = e.currentTarget.value.trim();
														if (v) ent.label = v;
														else delete ent.label;
													})}
											/>
										</Field.Field>

										<Field.Field>
											<Field.FieldLabel for="ent-display">Display paths</Field.FieldLabel>
											<Textarea
												id="ent-display"
												rows={2}
												value={formatDisplayText(entity.display)}
												oninput={(e) =>
													patchEntity(key, (ent) => {
														const display = parseDisplayText(
															e.currentTarget.value,
															entity.display?.sep
														);
														if (display) ent.display = display;
														else delete ent.display;
													})}
											/>
											<Field.FieldDescription>
												One path → field; multiple lines → parts (e.g. room.name + name)
											</Field.FieldDescription>
										</Field.Field>

										<Field.Field>
											<Field.FieldLabel for="ent-sep">Display separator</Field.FieldLabel>
											<Input
												id="ent-sep"
												value={entity.display?.sep ?? ''}
												placeholder=" · "
												oninput={(e) =>
													patchEntity(key, (ent) => {
														const display = parseDisplayText(
															formatDisplayText(ent.display),
															e.currentTarget.value
														);
														if (display) ent.display = display;
														else delete ent.display;
													})}
											/>
										</Field.Field>

										<div class="grid gap-4 sm:grid-cols-2">
											<Field.Field>
												<Field.FieldLabel for="ent-graph-role">Graph role</Field.FieldLabel>
												<NativeSelect.Root
													id="ent-graph-role"
													class="w-full"
													value={entity.graph?.role ?? ''}
													onchange={(e) =>
														patchEntity(key, (ent) => {
															const role = e.currentTarget.value;
															if (!role) {
																delete ent.graph;
																return;
															}
															ent.graph = {
																...(ent.graph ?? { role: role as GraphRole }),
																role: role as GraphRole
															};
														})}
												>
													<NativeSelect.Option value="">(none)</NativeSelect.Option>
													{#each GRAPH_ROLES as role (role)}
														<NativeSelect.Option value={role}>{role}</NativeSelect.Option>
													{/each}
												</NativeSelect.Root>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-parent">Parent field</Field.FieldLabel>
												<Input
													id="ent-parent"
													value={entity.graph?.parentField ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ensureGraph(ent);
															if (v) ent.graph!.parentField = v;
															else delete ent.graph!.parentField;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-label-field">Graph label field</Field.FieldLabel>
												<Input
													id="ent-label-field"
													value={entity.graph?.labelField ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ensureGraph(ent);
															if (v) ent.graph!.labelField = v;
															else delete ent.graph!.labelField;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-sub-field">Subtitle field</Field.FieldLabel>
												<Input
													id="ent-sub-field"
													value={entity.graph?.subtitleField ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ensureGraph(ent);
															if (v) ent.graph!.subtitleField = v;
															else delete ent.graph!.subtitleField;
														})}
												/>
											</Field.Field>
										</div>

										<div
											class="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
										>
											<div class="flex flex-col gap-0.5">
												<span class="text-sm font-medium">Map layer</span>
												<span class="text-xs text-muted-foreground"
													>Enable geometry on the map view</span
												>
											</div>
											<Switch
												checked={entity.map?.enabled === true}
												onCheckedChange={(checked) =>
													patchEntity(key, (ent) => {
														ent.map = { ...(ent.map ?? {}), enabled: checked };
													})}
											/>
										</div>

										<div class="grid gap-4 sm:grid-cols-2">
											<Field.Field>
												<Field.FieldLabel for="ent-level">Level field</Field.FieldLabel>
												<Input
													id="ent-level"
													value={entity.map?.levelField ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ent.map = { ...(ent.map ?? {}) };
															if (v) ent.map.levelField = v;
															else delete ent.map.levelField;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-geom">Geometry field</Field.FieldLabel>
												<Input
													id="ent-geom"
													value={entity.map?.geometryField ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ent.map = { ...(ent.map ?? {}) };
															if (v) ent.map.geometryField = v;
															else delete ent.map.geometryField;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-layer">Layer group</Field.FieldLabel>
												<Input
													id="ent-layer"
													value={entity.map?.layerGroup ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ent.map = { ...(ent.map ?? {}) };
															if (v) ent.map.layerGroup = v;
															else delete ent.map.layerGroup;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-style">Style key</Field.FieldLabel>
												<Input
													id="ent-style"
													value={entity.map?.styleKey ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const v = e.currentTarget.value.trim();
															ent.map = { ...(ent.map ?? {}) };
															if (v) ent.map.styleKey = v;
															else delete ent.map.styleKey;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-z">zIndex</Field.FieldLabel>
												<Input
													id="ent-z"
													type="number"
													value={entity.map?.zIndex ?? ''}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const raw = e.currentTarget.value.trim();
															ent.map = { ...(ent.map ?? {}) };
															if (!raw) {
																delete ent.map.zIndex;
																return;
															}
															const n = Number(raw);
															if (!Number.isFinite(n)) return;
															ent.map.zIndex = n;
														})}
												/>
											</Field.Field>
										</div>

										<div class="grid gap-4 sm:grid-cols-2">
											<Field.Field>
												<Field.FieldLabel for="ent-order">Table column order</Field.FieldLabel>
												<Textarea
													id="ent-order"
													rows={2}
													value={formatStringList(entity.table?.order)}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const order = parseStringList(e.currentTarget.value);
															ent.table = { ...(ent.table ?? {}) };
															if (order.length) ent.table.order = order;
															else delete ent.table.order;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-hide">Hide columns</Field.FieldLabel>
												<Textarea
													id="ent-hide"
													rows={2}
													value={formatStringList(entity.table?.hide)}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const hide = parseStringList(e.currentTarget.value);
															ent.table = { ...(ent.table ?? {}) };
															if (hide.length) ent.table.hide = hide;
															else delete ent.table.hide;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-ro">Read-only columns</Field.FieldLabel>
												<Textarea
													id="ent-ro"
													rows={2}
													value={formatStringList(entity.table?.readOnly)}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const readOnly = parseStringList(e.currentTarget.value);
															ent.table = { ...(ent.table ?? {}) };
															if (readOnly.length) ent.table.readOnly = readOnly;
															else delete ent.table.readOnly;
														})}
												/>
											</Field.Field>
											<Field.Field>
												<Field.FieldLabel for="ent-sort">Default sort</Field.FieldLabel>
												<Textarea
													id="ent-sort"
													rows={2}
													value={formatSortText(entity.table?.sort)}
													oninput={(e) =>
														patchEntity(key, (ent) => {
															const sort = parseSortText(e.currentTarget.value);
															ent.table = { ...(ent.table ?? {}) };
															if (sort != null) ent.table.sort = sort;
															else delete ent.table.sort;
														})}
												/>
												<Field.FieldDescription>
													e.g. name, or room then name desc
												</Field.FieldDescription>
											</Field.Field>
										</div>
									</Field.FieldGroup>
								</Card.Content>
							</Card.Root>
						{:else}
							<Card.Root>
								<Card.Content class="py-8 text-sm text-muted-foreground">
									Select or add an entity overlay key.
								</Card.Content>
							</Card.Root>
						{/if}
					</div>
				</Tabs.Content>

				<Tabs.Content value="edges" class="flex flex-col gap-4">
					<div class="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
						<Card.Root class="h-fit">
							<Card.Header class="pb-3">
								<Card.Title class="text-base">Relations</Card.Title>
							</Card.Header>
							<Card.Content class="flex flex-col gap-2">
								<div class="flex flex-col gap-1">
									{#each edgeKeys as key (key)}
										<button
											type="button"
											class={[
												'rounded-md px-2 py-1.5 text-left text-sm transition-colors',
												selectedEdge === key
													? 'bg-muted font-medium text-foreground'
													: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
											]}
											onclick={() => (edgePick = key)}
										>
											{key}
										</button>
									{:else}
										<p class="text-xs text-muted-foreground">No edge overlays yet.</p>
									{/each}
								</div>
								<Field.Field class="gap-2">
									<Input
										placeholder="relation table"
										bind:value={newEdgeKey}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												addEdge();
											}
										}}
									/>
									{#if knownRelations.length}
										<NativeSelect.Root
											class="w-full"
											value=""
											onchange={(e) => {
												const v = e.currentTarget.value;
												if (!v) return;
												newEdgeKey = v;
												addEdge();
												e.currentTarget.value = '';
											}}
										>
											<NativeSelect.Option value="" disabled
												>Add known relation…</NativeSelect.Option
											>
											{#each knownRelations as name (name)}
												<NativeSelect.Option value={name} disabled={edgeKeys.includes(name)}>
													{name}
												</NativeSelect.Option>
											{/each}
										</NativeSelect.Root>
									{/if}
									<Button type="button" variant="outline" size="sm" onclick={addEdge}>
										<PlusIcon data-icon="inline-start" />
										Add
									</Button>
								</Field.Field>
							</Card.Content>
						</Card.Root>

						{#if selectedEdge && activeEdge}
							{@const key = selectedEdge}
							{@const edge = activeEdge}
							<Card.Root>
								<Card.Header class="flex-row items-start justify-between gap-2">
									<div class="flex flex-col gap-1">
										<Card.Title>{key}</Card.Title>
										<Card.Description>Relation role for the graph view.</Card.Description>
									</div>
									<Button
										type="button"
										variant="destructive"
										size="sm"
										onclick={() => removeEdge(key)}
									>
										<TrashIcon data-icon="inline-start" />
										Remove
									</Button>
								</Card.Header>
								<Card.Content>
									<Field.FieldGroup class="gap-4">
										<Field.Field>
											<Field.FieldLabel for="edge-role">Role</Field.FieldLabel>
											<NativeSelect.Root
												id="edge-role"
												class="w-full"
												value={edge.role ?? 'other'}
												onchange={(e) =>
													patchEdge(key, (ed) => {
														ed.role = e.currentTarget.value as (typeof EDGE_ROLES)[number];
													})}
											>
												{#each EDGE_ROLES as role (role)}
													<NativeSelect.Option value={role}>{role}</NativeSelect.Option>
												{/each}
											</NativeSelect.Root>
										</Field.Field>
										<Field.Field>
											<Field.FieldLabel for="edge-type">Edge type key</Field.FieldLabel>
											<Input
												id="edge-type"
												value={edge.edgeType ?? ''}
												oninput={(e) =>
													patchEdge(key, (ed) => {
														const v = e.currentTarget.value.trim();
														if (v) ed.edgeType = v;
														else delete ed.edgeType;
													})}
											/>
										</Field.Field>
										<Field.Field>
											<Field.FieldLabel for="edge-label">Label field</Field.FieldLabel>
											<Input
												id="edge-label"
												value={edge.labelField ?? ''}
												oninput={(e) =>
													patchEdge(key, (ed) => {
														const v = e.currentTarget.value.trim();
														if (v) ed.labelField = v;
														else delete ed.labelField;
													})}
											/>
										</Field.Field>
									</Field.FieldGroup>
								</Card.Content>
							</Card.Root>
						{:else}
							<Card.Root>
								<Card.Content class="py-8 text-sm text-muted-foreground">
									Select or add an edge overlay key.
								</Card.Content>
							</Card.Root>
						{/if}
					</div>
				</Tabs.Content>

				<Tabs.Content value="graph" class="flex flex-col gap-4">
					<Card.Root>
						<Card.Header>
							<Card.Title>Graph layout</Card.Title>
							<Card.Description>ELK options for the graph view (sparse).</Card.Description>
						</Card.Header>
						<Card.Content>
							<Field.FieldGroup class="gap-4">
								<div class="grid gap-4 sm:grid-cols-2">
									<Field.Field>
										<Field.FieldLabel for="g-dir">Direction</Field.FieldLabel>
										<NativeSelect.Root
											id="g-dir"
											class="w-full"
											value={draft.graph?.layout?.direction ?? ''}
											onchange={(e) =>
												touchDraft((next) => {
													const v = e.currentTarget.value;
													if (!v) {
														if (next.graph?.layout) delete next.graph.layout.direction;
														return;
													}
													next.graph = {
														...(next.graph ?? {}),
														layout: {
															...(next.graph?.layout ?? {}),
															direction: v as GraphLayoutDirection
														}
													};
												})}
										>
											<NativeSelect.Option value="">(default)</NativeSelect.Option>
											{#each LAYOUT_DIRS as d (d)}
												<NativeSelect.Option value={d}>{d}</NativeSelect.Option>
											{/each}
										</NativeSelect.Root>
									</Field.Field>
									<Field.Field>
										<Field.FieldLabel for="g-align">Align</Field.FieldLabel>
										<NativeSelect.Root
											id="g-align"
											class="w-full"
											value={draft.graph?.layout?.align ?? ''}
											onchange={(e) =>
												touchDraft((next) => {
													const v = e.currentTarget.value;
													if (!v) {
														if (next.graph?.layout) delete next.graph.layout.align;
														return;
													}
													next.graph = {
														...(next.graph ?? {}),
														layout: {
															...(next.graph?.layout ?? {}),
															align: v as GraphLayoutAlign
														}
													};
												})}
										>
											<NativeSelect.Option value="">(default)</NativeSelect.Option>
											{#each LAYOUT_ALIGNS as a (a)}
												<NativeSelect.Option value={a}>{a}</NativeSelect.Option>
											{/each}
										</NativeSelect.Root>
									</Field.Field>
								</div>

								<div class="grid gap-4 sm:grid-cols-3">
									{#each SPACING_FIELDS as [prop, label] (prop)}
										<Field.Field>
											<Field.FieldLabel for={`g-sp-${prop}`}>{label}</Field.FieldLabel>
											<Input
												id={`g-sp-${prop}`}
												type="number"
												value={draft.graph?.layout?.spacing?.[prop] ?? ''}
												oninput={(e) => setSpacing(prop, e.currentTarget.value)}
											/>
										</Field.Field>
									{/each}
								</div>
							</Field.FieldGroup>
						</Card.Content>
					</Card.Root>
				</Tabs.Content>

				<Tabs.Content value="map" class="flex flex-col gap-4">
					<Card.Root>
						<Card.Header>
							<Card.Title>Map defaults</Card.Title>
							<Card.Description>Global map plane / levels table settings.</Card.Description>
						</Card.Header>
						<Card.Content>
							<Field.FieldGroup class="gap-4">
								<div class="grid gap-4 sm:grid-cols-2">
									<Field.Field>
										<Field.FieldLabel for="map-units">Units</Field.FieldLabel>
										<Input
											id="map-units"
											value={draft.map?.units ?? 'm'}
											oninput={(e) =>
												touchDraft((next) => {
													ensureMap(next);
													next.map!.units = (e.currentTarget.value.trim() || 'm') as 'm';
												})}
										/>
									</Field.Field>
									<Field.Field>
										<Field.FieldLabel for="map-plane">Plane</Field.FieldLabel>
										<Input
											id="map-plane"
											value={draft.map?.plane ?? 'xy-meters'}
											oninput={(e) =>
												touchDraft((next) => {
													ensureMap(next);
													next.map!.plane = (e.currentTarget.value.trim() ||
														'xy-meters') as 'xy-meters';
												})}
										/>
									</Field.Field>
									<Field.Field>
										<Field.FieldLabel for="map-levels">Levels table</Field.FieldLabel>
										<Input
											id="map-levels"
											value={draft.map?.levelsTable ?? ''}
											placeholder="levels"
											oninput={(e) =>
												touchDraft((next) => {
													ensureMap(next);
													const v = e.currentTarget.value.trim();
													if (v) next.map!.levelsTable = v;
													else delete next.map!.levelsTable;
												})}
										/>
									</Field.Field>
									<Field.Field>
										<Field.FieldLabel for="map-ord">Level order field</Field.FieldLabel>
										<Input
											id="map-ord"
											value={draft.map?.levelOrderField ?? ''}
											placeholder="ord"
											oninput={(e) =>
												touchDraft((next) => {
													ensureMap(next);
													const v = e.currentTarget.value.trim();
													if (v) next.map!.levelOrderField = v;
													else delete next.map!.levelOrderField;
												})}
										/>
									</Field.Field>
								</div>
							</Field.FieldGroup>
						</Card.Content>
					</Card.Root>
				</Tabs.Content>

				<Tabs.Content value="search" class="flex flex-col gap-4">
					<Card.Root>
						<Card.Header>
							<Card.Title>Search fields</Card.Title>
							<Card.Description>
								Per-table fields for future global search. Blank removes the table entry.
							</Card.Description>
						</Card.Header>
						<Card.Content class="flex flex-col gap-4">
							{#each searchTables as table (table)}
								<Field.Field>
									<Field.FieldLabel for={`search-${table}`}>{table}</Field.FieldLabel>
									<Input
										id={`search-${table}`}
										value={formatStringList(draft.search?.fieldsByTable?.[table])}
										placeholder="name, description"
										oninput={(e) => setSearchTableFields(table, e.currentTarget.value)}
									/>
								</Field.Field>
							{:else}
								<p class="text-sm text-muted-foreground">No tables available yet.</p>
							{/each}
						</Card.Content>
					</Card.Root>
				</Tabs.Content>

				<Tabs.Content value="json" class="flex flex-col gap-4">
					<Card.Root>
						<Card.Header class="flex-row items-start justify-between gap-2">
							<div class="flex flex-col gap-1">
								<Card.Title>Raw overlay JSON</Card.Title>
								<Card.Description>
									Escape hatch for unknown / future keys. Apply before saving if you edit here.
								</Card.Description>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={() => {
									applyJson();
								}}
							>
								Apply JSON
							</Button>
						</Card.Header>
						<Card.Content class="flex flex-col gap-3">
							{#if jsonError}
								<Alert.Root variant="destructive">
									<CircleAlertIcon />
									<Alert.Title>JSON error</Alert.Title>
									<Alert.Description>{jsonError}</Alert.Description>
								</Alert.Root>
							{/if}
							<Textarea
								class="min-h-96 font-mono text-xs"
								value={jsonText}
								onfocus={() => {
									jsonText = stringifyOverlay(draft);
									jsonError = null;
								}}
								oninput={(e) => {
									jsonText = e.currentTarget.value;
									jsonError = null;
								}}
							/>
						</Card.Content>
					</Card.Root>
				</Tabs.Content>

				<Tabs.Content value="diagnostics" class="flex flex-col gap-4">
					<Card.Root>
						<Card.Header>
							<Card.Title>Resolve diagnostics</Card.Title>
							<Card.Description>
								From the last ResolvedConfig merge. Save + reload refreshes these.
							</Card.Description>
						</Card.Header>
						<Card.Content class="flex flex-col gap-2">
							{#each diagnostics as d, i (`${d.code}-${i}`)}
								<div
									class="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-sm"
								>
									<div class="flex items-center gap-2">
										<Badge variant={d.level === 'error' ? 'destructive' : 'secondary'}>
											{d.level}
										</Badge>
										<code class="text-xs">{d.code}</code>
									</div>
									<p class="text-muted-foreground">{d.message}</p>
								</div>
							{:else}
								<p class="text-sm text-muted-foreground">No diagnostics.</p>
							{/each}
						</Card.Content>
					</Card.Root>
				</Tabs.Content>
			</Tabs.Root>
		</div>
	</div>
</div>
