<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { AppCatalog, AppRole } from '$lib/catalog-types';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { cn } from '$lib/utils';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';

	type FieldKey = 'namespace' | 'database' | 'username' | 'password';
	type PendingKey = 'ns' | 'db' | 'signin' | 'logout';

	const NAV = [
		{ href: '/table', label: 'Table' },
		{ href: '/graph', label: 'Graph' },
		{ href: '/map', label: 'Map' }
	] as const;

	type Props = {
		selection: { namespace: string; database: string };
		user: string | null;
		catalog: AppCatalog;
		dbError?: string | null;
		userRoles?: AppRole[];
		configError?: string | null;
	};

	let { selection, user, catalog, dbError = null, userRoles, configError = null }: Props = $props();

	const pathname = $derived(page.url.pathname);

	function navActive(href: string): boolean {
		return pathname === href || pathname.startsWith(`${href}/`);
	}

	let open = $state(false);
	let password = $state('');
	let pendingUser = $state('');
	let formMessage = $state<string | null>(null);
	let fieldErrors = $state<Partial<Record<FieldKey, string>>>({});
	let pending = $state<Record<PendingKey, boolean>>({
		ns: false,
		db: false,
		signin: false,
		logout: false
	});

	const sessionAction = resolve('/session');
	const anyPending = $derived(pending.ns || pending.db || pending.signin || pending.logout);
	const formBusy = $derived(anyPending);
	const roles = $derived(
		userRoles ?? catalog.users.find((entry) => entry.name === user)?.roles ?? []
	);
	const databases = $derived(
		catalog.databases.length > 0 ? catalog.databases : [selection.database]
	);

	function clearErrors() {
		formMessage = null;
		fieldErrors = {};
	}

	function resetFormFields() {
		password = '';
		pendingUser = user ?? '';
		clearErrors();
	}

	function setFieldError(key: FieldKey, message: string) {
		fieldErrors = { ...fieldErrors, [key]: message };
	}

	function failureMessage(result: { type: string; data?: unknown }, fallback: string) {
		if (result.type !== 'failure') return fallback;
		const data = result.data as { message?: unknown; field?: unknown } | undefined;
		return typeof data?.message === 'string' && data.message ? data.message : fallback;
	}

	function failureField(result: { type: string; data?: unknown }): FieldKey | null {
		if (result.type !== 'failure') return null;
		const data = result.data as { field?: unknown } | undefined;
		const field = data?.field;
		if (
			field === 'namespace' ||
			field === 'database' ||
			field === 'username' ||
			field === 'password'
		) {
			return field;
		}
		return null;
	}

	function makeEnhance(
		key: PendingKey,
		opts: {
			field?: FieldKey;
			fallback: string;
			closeOnSuccess?: boolean;
		}
	): SubmitFunction {
		return () => {
			clearErrors();
			pending = { ...pending, [key]: true };

			return async ({ result, update }) => {
				try {
					await update();

					if (result.type === 'failure') {
						const message = failureMessage(result, opts.fallback);
						const field = failureField(result) ?? opts.field;
						if (field) setFieldError(field, message);
						else formMessage = message;
						return;
					}

					if (opts.closeOnSuccess) {
						password = '';
						if (key === 'logout') pendingUser = '';
						open = false;
					}
				} finally {
					pending = { ...pending, [key]: false };
				}
			};
		};
	}

	function validateSignIn(): boolean {
		const next: Partial<Record<FieldKey, string>> = {};
		if (!pendingUser.trim()) next.username = 'Select a user';
		if (!password) next.password = 'Password is required';
		fieldErrors = next;
		formMessage = null;
		return Object.keys(next).length === 0;
	}

	function submitOnChange(event: Event) {
		const el = event.currentTarget as HTMLSelectElement;
		el.form?.requestSubmit();
	}
</script>

<header class="z-40 border-b border-border bg-background/95 backdrop-blur">
	<div class="flex h-14 items-center justify-between gap-4 px-4">
		<div class="flex min-w-0 items-center gap-4">
			<a href={resolve('/')} class="text-sm font-semibold tracking-tight">Map</a>

			<nav class="flex items-center gap-1" aria-label="Views">
				{#each NAV as item (item.href)}
					{@const active = navActive(item.href)}
					<a
						href={resolve(item.href)}
						class={cn(
							'rounded-md px-2.5 py-1.5 text-sm transition-colors',
							active
								? 'bg-muted font-medium text-foreground'
								: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
						)}
						aria-current={active ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>

		<div class="flex items-center gap-2">
			{#if dbError}
				<span class="hidden text-xs text-destructive sm:inline" title={dbError}>DB error</span>
			{/if}
			{#if configError}
				<span class="hidden text-xs text-destructive sm:inline" title={configError}
					>Config error</span
				>
			{/if}

			<div class="hidden items-center gap-1.5 sm:flex">
				<span class="text-xs text-muted-foreground">
					{selection.namespace}/{selection.database}
				</span>
				{#each roles as role (role)}
					<Badge variant="secondary">{role}</Badge>
				{/each}
				{#if anyPending}
					<Spinner class="size-3.5 text-muted-foreground" />
				{/if}
			</div>

			<Dialog.Root
				bind:open
				onOpenChange={(next) => {
					if (next) resetFormFields();
				}}
			>
				<Dialog.Trigger>
					{#snippet child({ props })}
						<Button variant="outline" {...props}>Session</Button>
					{/snippet}
				</Dialog.Trigger>

				<Dialog.Content class="sm:max-w-sm">
					<Dialog.Header>
						<Dialog.Title>Session</Dialog.Title>
						<Dialog.Description>
							Signed in as {user ?? '—'}
							{#if roles.length}
								· {roles.join(', ')}
							{/if}
						</Dialog.Description>
					</Dialog.Header>

					{#if formMessage}
						<Alert.Root variant="destructive">
							<CircleAlertIcon />
							<Alert.Title>Something went wrong</Alert.Title>
							<Alert.Description>{formMessage}</Alert.Description>
						</Alert.Root>
					{/if}

					<Field.Group class="gap-3">
						<form
							method="POST"
							action="{sessionAction}?/selectNamespace"
							use:enhance={makeEnhance('ns', {
								field: 'namespace',
								fallback: 'Failed to switch namespace'
							})}
						>
							<Field.Field data-invalid={fieldErrors.namespace ? 'true' : undefined}>
								<Field.Label for="ns-select">Namespace</Field.Label>
								<NativeSelect.Root
									id="ns-select"
									name="namespace"
									class="w-full"
									value={selection.namespace}
									disabled={formBusy}
									aria-invalid={fieldErrors.namespace ? true : undefined}
									aria-describedby={fieldErrors.namespace ? 'ns-select-error' : undefined}
									onchange={submitOnChange}
								>
									{#each catalog.namespaces as ns (ns)}
										<NativeSelect.Option value={ns}>{ns}</NativeSelect.Option>
									{/each}
								</NativeSelect.Root>
								<Field.Error id="ns-select-error" errors={[{ message: fieldErrors.namespace }]} />
							</Field.Field>
						</form>

						<form
							method="POST"
							action="{sessionAction}?/selectDatabase"
							use:enhance={makeEnhance('db', {
								field: 'database',
								fallback: 'Failed to switch database'
							})}
						>
							<Field.Field data-invalid={fieldErrors.database ? 'true' : undefined}>
								<div class="flex items-center gap-2">
									<Field.Label for="db-select">Database</Field.Label>
									{#if pending.ns || pending.db}
										<Spinner class="size-3.5 text-muted-foreground" />
									{/if}
								</div>
								<NativeSelect.Root
									id="db-select"
									name="database"
									class="w-full"
									value={selection.database}
									disabled={formBusy || databases.length === 0}
									aria-invalid={fieldErrors.database ? true : undefined}
									aria-describedby={fieldErrors.database ? 'db-select-error' : undefined}
									onchange={submitOnChange}
								>
									{#each databases as db (db)}
										<NativeSelect.Option value={db}>{db}</NativeSelect.Option>
									{/each}
								</NativeSelect.Root>
								<Field.Error id="db-select-error" errors={[{ message: fieldErrors.database }]} />
							</Field.Field>
						</form>

						<Field.Separator />

						<form
							method="POST"
							action="{sessionAction}?/selectUser"
							use:enhance={makeEnhance('signin', {
								fallback: 'Sign-in failed',
								closeOnSuccess: true
							})}
							onsubmit={(event) => {
								if (!validateSignIn()) event.preventDefault();
							}}
						>
							<Field.Group class="gap-3">
								<Field.Field data-invalid={fieldErrors.username ? 'true' : undefined}>
									<Field.Label for="user-select">User</Field.Label>
									<NativeSelect.Root
										id="user-select"
										name="username"
										class="w-full"
										bind:value={pendingUser}
										required
										disabled={formBusy}
										aria-invalid={fieldErrors.username ? true : undefined}
										aria-describedby={fieldErrors.username ? 'user-select-error' : undefined}
										onchange={() => {
											if (!fieldErrors.username) return;
											const next = { ...fieldErrors };
											delete next.username;
											fieldErrors = next;
										}}
									>
										<NativeSelect.Option value="" disabled={Boolean(user)}>
											Select user…
										</NativeSelect.Option>
										{#each catalog.users as entry (entry.name)}
											<NativeSelect.Option value={entry.name}>
												{entry.name}{entry.roles.length ? ` (${entry.roles.join(', ')})` : ''}
											</NativeSelect.Option>
										{/each}
									</NativeSelect.Root>
									<Field.Error
										id="user-select-error"
										errors={[{ message: fieldErrors.username }]}
									/>
								</Field.Field>

								<Field.Field data-invalid={fieldErrors.password ? 'true' : undefined}>
									<Field.Label for="user-password">Password</Field.Label>
									<Input
										id="user-password"
										name="password"
										type="password"
										autocomplete="current-password"
										bind:value={password}
										required
										placeholder="Password"
										disabled={formBusy}
										aria-invalid={fieldErrors.password ? true : undefined}
										aria-describedby={fieldErrors.password ? 'user-password-error' : undefined}
										oninput={() => {
											if (!fieldErrors.password) return;
											const next = { ...fieldErrors };
											delete next.password;
											fieldErrors = next;
										}}
									/>
									<Field.Error
										id="user-password-error"
										errors={[{ message: fieldErrors.password }]}
									/>
								</Field.Field>

								<Button type="submit" class="w-full" disabled={formBusy}>
									{#if pending.signin}
										<Spinner data-icon="inline-start" />
									{/if}
									Switch user
								</Button>
							</Field.Group>
						</form>

						<form
							method="POST"
							action="{sessionAction}?/logout"
							use:enhance={makeEnhance('logout', {
								fallback: 'Logout failed',
								closeOnSuccess: true
							})}
						>
							<Button type="submit" variant="destructive" class="w-full" disabled={formBusy}>
								{#if pending.logout}
									<Spinner data-icon="inline-start" />
								{/if}
								Log out
							</Button>
						</form>
					</Field.Group>
				</Dialog.Content>
			</Dialog.Root>
		</div>
	</div>
</header>
