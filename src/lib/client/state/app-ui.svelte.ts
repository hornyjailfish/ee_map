/**
 * Shared client UI state across Table / Graph / Map views.
 * focusedId is the canonical “current record”; selectedIds is multi-select (v1 mostly single).
 */

export type SearchScope = 'view' | 'all';

export type AppUiSearch = {
	q: string;
	scope: SearchScope;
};

export type AppUiStateSnapshot = {
	selectedIds: string[];
	focusedId: string | null;
	levelId: string | null;
	search: AppUiSearch;
};

class AppUiState {
	selectedIds = $state<string[]>([]);
	focusedId = $state<string | null>(null);
	levelId = $state<string | null>(null);
	search = $state<AppUiSearch>({ q: '', scope: 'view' });

	setFocused(id: string | null) {
		this.focusedId = id;
	}

	/**
	 * Focus + single-select a record (primary click path across views).
	 * Pass null to clear both focus and selection.
	 */
	focusRecord(id: string | null) {
		if (id == null || id === '') {
			this.selectedIds = [];
			this.focusedId = null;
			return;
		}
		this.focusedId = id;
		this.selectedIds = [id];
	}

	toggleSelected(id: string) {
		const idx = this.selectedIds.indexOf(id);
		if (idx === -1) {
			this.selectedIds = [...this.selectedIds, id];
			this.focusedId = id;
		} else {
			this.selectedIds = this.selectedIds.filter((x) => x !== id);
			if (this.focusedId === id) {
				this.focusedId = this.selectedIds[this.selectedIds.length - 1] ?? null;
			}
		}
	}

	setSelected(ids: string[]) {
		this.selectedIds = [...ids];
		if (this.focusedId != null && !ids.includes(this.focusedId)) {
			this.focusedId = ids[ids.length - 1] ?? null;
		} else if (this.focusedId == null && ids.length > 0) {
			this.focusedId = ids[ids.length - 1] ?? null;
		}
	}

	clearSelection() {
		this.selectedIds = [];
		this.focusedId = null;
	}

	setLevel(id: string | null) {
		this.levelId = id;
	}

	setSearch(partial: Partial<AppUiSearch>) {
		this.search = { ...this.search, ...partial };
	}

	reset() {
		this.selectedIds = [];
		this.focusedId = null;
		this.levelId = null;
		this.search = { q: '', scope: 'view' };
	}
}

/** Singleton shared by Table / Graph / Map (and shell). */
export const appUi = new AppUiState();
