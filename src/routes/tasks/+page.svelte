<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { ApiError, postFormAction } from '$lib/client/http';
	import { normalizeStatus, type TaskRow, type TaskStatus } from '$lib/embedding-types';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let pendingId = $state<string | null>(null);
	let retryAll = $state(false);
	let writeError = $state<string | null>(null);
	let writeOk = $state<string | null>(null);
	/** Marker ids we just requeued — cleared as each reaches a terminal state. */
	let retriedIds = $state<string[]>([]);

	let live = $state<'connecting' | 'connected' | 'offline'>('connecting');
	let metrics = $state<{ pending: number; capacity: number | null } | null>(null);

	// Live facts layered over the server snapshot (keyed by marker view id).
	let overrides = $state<Record<string, LiveFact>>({});
	let liveOnly = $state<Record<string, TaskRow>>({});

	type LiveFact = { status: TaskStatus; error: string | null; updatedAt: string | null };

	const tasks = $derived.by(() => {
		const merged: TaskRow[] = data.tasks.map((row) => {
			const fact = overrides[row.id];
			if (!fact) return row;
			return {
				...row,
				status: fact.status,
				error: fact.error ?? row.error,
				updatedAt: fact.updatedAt ?? row.updatedAt,
				source: row.source === 'db' ? 'both' : row.source
			};
		});

		return [...merged, ...Object.values(liveOnly)].sort(compareTasks);
	});

	const failedTasks = $derived(tasks.filter((t) => t.status === 'failed'));
	const queueBadge = $derived.by(() => {
		if (!metrics) return `${data.dbTaskCount} queued`;
		const cap = metrics.capacity;
		return cap != null && cap > 0
			? `${metrics.pending}/${cap} queued`
			: `${metrics.pending} queued`;
	});

	function compareTasks(a: TaskRow, b: TaskRow): number {
		const at = a.updatedAt;
		const bt = b.updatedAt;
		if (at && bt && at !== bt) return at < bt ? 1 : -1;
		if (at && !bt) return -1;
		if (!at && bt) return 1;
		return a.id.localeCompare(b.id);
	}

	// SSE feed from the embedding service (proxied through `/tasks/stream`).
	$effect(() => {
		if (!browser) return;

		const source = new EventSource(resolve('/tasks/stream'));

		source.onopen = () => {
			live = 'connected';
		};

		source.onmessage = (event) => {
			let msg: unknown;
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}
			if (msg == null || typeof msg !== 'object') return;

			const { type, data: payload } = msg as { type?: unknown; data?: unknown };
			if (type === 'snapshot') {
				metrics = snapshotMetrics(payload);
			} else if (type === 'task') {
				applyTaskEvent(payload);
			}
		};

		source.onerror = () => {
			live = 'offline';
		};

		return () => source.close();
	});

	function snapshotMetrics(raw: unknown) {
		if (raw == null || typeof raw !== 'object') return null;
		const s = raw as Record<string, unknown>;
		return {
			pending: asNum(s.pending),
			capacity: numOrNull(s, 'queue_capacity', 'max_capacity')
		};
	}

	function asNum(value: unknown): number {
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}

	function numOrNull(record: Record<string, unknown>, ...keys: string[]): number | null {
		for (const key of keys) {
			const value = record[key];
			if (typeof value === 'number' && Number.isFinite(value)) return value;
		}
		return null;
	}

	function applyTaskEvent(raw: unknown) {
		if (raw == null || typeof raw !== 'object') return;
		const t = raw as { record_id?: unknown; status?: unknown; error?: unknown };
		const id = typeof t.record_id === 'string' ? t.record_id : '';
		if (!id) return;

		const fact: LiveFact = {
			status: normalizeStatus(t.status),
			error: typeof t.error === 'string' && t.error !== '' ? t.error : null,
			updatedAt: new Date().toISOString()
		};

		if (data.tasks.some((row) => row.id === id)) {
			overrides = { ...overrides, [id]: fact };
		} else {
			liveOnly = {
				...liveOnly,
				[id]: { id, queueId: null, ...fact, version: null, source: 'service' }
			};
		}

		// Once a requeued item reaches a terminal state, drop it from the
		// "Queued" banner — and clear the banner when nothing is still pending.
		if (
			retriedIds.includes(id) &&
			(fact.status === 'done' || fact.status === 'failed')
		) {
			retriedIds = retriedIds.filter((r) => r !== id);
			if (retriedIds.length === 0) writeOk = null;
		}
	}

	const liveVariant = $derived<BadgeVariant>(
		live === 'connected' ? 'secondary' : live === 'offline' ? 'destructive' : 'outline'
	);
	const liveLabel = $derived(
		live === 'connected' ? 'live' : live === 'offline' ? 'offline' : 'connecting…'
	);

	function statusVariant(status: TaskStatus): BadgeVariant {
		switch (status) {
			case 'done':
				return 'positive';
			case 'processing':
				return 'secondary';
			case 'failed':
				return 'destructive';
			default:
				return 'outline';
		}
	}

	function formatTime(value: string | null): string {
		if (!value) return '—';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	async function retry(ids: string[]) {
		writeError = null;
		writeOk = null;
		if (ids.length === 1) pendingId = ids[0] ?? null;
		else retryAll = true;

		try {
			await postFormAction('regenerate', { items: JSON.stringify(ids) });
			writeOk =
				ids.length === 1 ? `Requeued ${ids[0]}` : `Requeued ${ids.length} tasks`;
			retriedIds = Array.from(new Set([...retriedIds, ...ids]));
			// Live updates arrive via the SSE `task` events — no reload needed.
		} catch (err) {
			writeError = err instanceof ApiError ? err.message : 'Regenerate failed';
		} finally {
			pendingId = null;
			retryAll = false;
		}
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2"
	>
		<span class="text-sm font-medium tracking-tight">Tasks</span>
		<span class="text-xs text-muted-foreground">Marker embedding queue</span>

		<div class="flex items-center gap-1.5">
			<Badge variant={liveVariant}>{liveLabel}</Badge>
			<Badge variant="outline">{queueBadge}</Badge>
			{#if data.serviceTaskCount !== data.dbTaskCount}
				<Badge variant="outline">{data.serviceTaskCount} live</Badge>
			{/if}
		</div>

		{#if failedTasks.length > 0}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={retryAll}
				onclick={() => retry(failedTasks.map((t) => t.id))}
			>
				{#if retryAll}
					<Spinner data-icon="inline-start" />
				{/if}
				Retry {failedTasks.length} failed
			</Button>
		{/if}
	</div>

	{#if data.serviceError}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Embedding service unreachable</Alert.Title>
				<Alert.Description>{data.serviceError}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if data.dbError}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Queue read failed</Alert.Title>
				<Alert.Description>{data.dbError}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if writeError}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Regenerate failed</Alert.Title>
				<Alert.Description>{writeError}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if writeOk}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root>
				<Alert.Title>Queued</Alert.Title>
				<Alert.Description>{writeOk}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-auto">
		{#if tasks.length === 0}
			<div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
				<p>No embedding tasks yet.</p>
			</div>
		{:else}
			<table class="w-full border-collapse text-sm">
				<thead class="sticky top-0 z-10 bg-background">
					<tr class="border-b border-border text-left text-xs text-muted-foreground">
						<th class="px-4 py-2 font-medium">Marker view</th>
						<th class="px-4 py-2 font-medium">Status</th>
						<th class="px-4 py-2 font-medium">Version</th>
						<th class="px-4 py-2 font-medium">Error</th>
						<th class="px-4 py-2 font-medium">Updated</th>
						<th class="px-4 py-2 font-medium">Source</th>
						<th class="px-4 py-2 text-right font-medium">Action</th>
					</tr>
				</thead>
				<tbody>
					{#each tasks as task (task.id)}
						<tr class={`border-b border-border/60 hover:bg-muted/40${task.status === 'processing' ? ' bg-primary/10' : ''}`}>
							<td class="px-4 py-2 align-top">
								<span class="block font-mono text-xs break-all">{task.id}</span>
								{#if task.queueId && task.queueId !== task.id}
									<span class="block font-mono text-xs text-muted-foreground">
										{task.queueId}
									</span>
								{/if}
							</td>
							<td class="px-4 py-2 align-top">
								<Badge variant={statusVariant(task.status)}>{task.status}</Badge>
							</td>
							<td class="px-4 py-2 align-top tabular-nums">
								{task.version == null ? '—' : task.version}
							</td>
							<td class="max-w-xs px-4 py-2 align-top text-xs text-muted-foreground">
								{task.error ?? '—'}
							</td>
							<td class="px-4 py-2 align-top text-xs text-muted-foreground tabular-nums">
								{formatTime(task.updatedAt)}
							</td>
							<td class="px-4 py-2 align-top">
								<Badge variant="outline">{task.source}</Badge>
							</td>
							<td class="px-4 py-2 align-top text-right">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={pendingId === task.id}
									onclick={() => retry([task.id])}
								>
									{#if pendingId === task.id}
										<Spinner data-icon="inline-start" />
									{:else}
										<RefreshCwIcon data-icon="inline-start" />
									{/if}
									Retry
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
