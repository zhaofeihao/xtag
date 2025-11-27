interface UserNote {
  id: string;
  username: string;
  note: string;
  updatedAt: number;
}

type NotesMap = Record<string, UserNote>;

const STORAGE_KEY = "xtag_notes_v1";
const SETTINGS_KEY = "xtag_settings";

interface ExtensionSettings {
  preferLocal: boolean;
}

class NotesRepository {
  private primary: chrome.storage.StorageArea;
  private secondary: chrome.storage.StorageArea | null;
  private useSecondary = false;
  private cache: NotesMap = {};
  private settings: ExtensionSettings = { preferLocal: false };

  constructor() {
    this.primary = chrome.storage.sync;
    this.secondary = chrome.storage.local;
  }

  async init(): Promise<void> {
    this.settings = await this.loadSettings();
    if (this.settings.preferLocal) {
      this.primary = chrome.storage.local;
      this.secondary = chrome.storage.sync;
    }
    this.cache = await this.readAll();
  }

  get notes(): NotesMap {
    return this.cache;
  }

  private async loadSettings(): Promise<ExtensionSettings> {
    try {
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      return (data?.[SETTINGS_KEY] as ExtensionSettings | undefined) ?? { preferLocal: false };
    } catch {
      return { preferLocal: false };
    }
  }

  private async readAll(): Promise<NotesMap> {
    try {
      const data = await this.primary.get(STORAGE_KEY);
      const map = (data?.[STORAGE_KEY] as NotesMap | undefined) ?? {};
      return map;
    } catch (err) {
      this.useSecondary = true;
      if (!this.secondary) return {};
      const data = await this.secondary.get(STORAGE_KEY);
      const map = (data?.[STORAGE_KEY] as NotesMap | undefined) ?? {};
      return map;
    }
  }

  private async persist(map: NotesMap): Promise<void> {
    const target = this.useSecondary ? this.secondary : this.primary;
    if (!target) return;
    try {
      await target.set({ [STORAGE_KEY]: map });
    } catch (err) {
      if (!this.useSecondary && this.secondary) {
        this.useSecondary = true;
        await this.secondary.set({ [STORAGE_KEY]: map });
        return;
      }
      throw err;
    }
  }

  async upsert(username: string, note: string): Promise<NotesMap> {
    const key = username.toLowerCase();
    const trimmed = note.trim();
    if (!trimmed) throw new Error("Note cannot be empty");
    const record: UserNote = {
      id: key,
      username,
      note: trimmed,
      updatedAt: Date.now()
    };
    this.cache[key] = record;
    await this.persist(this.cache);
    return this.cache;
  }

  async remove(username: string): Promise<NotesMap> {
    delete this.cache[username.toLowerCase()];
    await this.persist(this.cache);
    return this.cache;
  }

  async replaceAll(map: NotesMap): Promise<void> {
    this.cache = map;
    await this.persist(this.cache);
  }
}

const repo = new NotesRepository();

const qs = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el;
};

const formatRelativeTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString();
};

const filterNotes = (map: NotesMap, keyword: string): UserNote[] => {
  const term = keyword.trim().toLowerCase();
  const items = Object.values(map);
  if (!term) return items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items
    .filter((item) => item.username.toLowerCase().includes(term) || item.note.toLowerCase().includes(term))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

const renderEmpty = (container: HTMLElement) => {
  container.innerHTML = `
    <div class="empty">
      <p>No notes yet</p>
      <p class="muted">Add one from the timeline or create a quick note below.</p>
    </div>
  `;
};

const renderList = (items: UserNote[], container: HTMLElement) => {
  container.innerHTML = "";
  if (!items.length) {
    renderEmpty(container);
    return;
  }

  for (const item of items) {
    container.appendChild(createCard(item));
  }
};

const createCard = (item: UserNote): HTMLElement => {
  const card = document.createElement("div");
  card.className = "note-card";

  const top = document.createElement("div");
  top.className = "note-card__top";

  const userLink = document.createElement("a");
  userLink.href = `https://x.com/${item.username}`;
  userLink.target = "_blank";
  userLink.rel = "noopener noreferrer";
  userLink.textContent = `@${item.username}`;
  userLink.className = "note-card__user";

  const meta = document.createElement("span");
  meta.className = "note-card__meta";
  meta.textContent = formatRelativeTime(item.updatedAt);

  top.appendChild(userLink);
  top.appendChild(meta);

  const body = document.createElement("textarea");
  body.className = "note-card__body";
  body.value = item.note;
  body.disabled = true;

  const actions = document.createElement("div");
  actions.className = "note-card__actions";

  const editBtn = document.createElement("button");
  editBtn.className = "ghost";
  editBtn.textContent = "Edit";

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "Save";
  saveBtn.hidden = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "ghost";
  cancelBtn.textContent = "Cancel";
  cancelBtn.hidden = true;

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "danger";
  deleteBtn.textContent = "Delete";

  const toggleEdit = (editing: boolean) => {
    body.disabled = !editing;
    body.focus();
    editBtn.hidden = editing;
    saveBtn.hidden = !editing;
    cancelBtn.hidden = !editing;
  };

  editBtn.addEventListener("click", () => toggleEdit(true));

  cancelBtn.addEventListener("click", () => {
    body.value = item.note;
    toggleEdit(false);
  });

  saveBtn.addEventListener("click", async () => {
    const next = body.value.trim();
    if (!next) {
      alert("Note cannot be empty");
      return;
    }
    await repo.upsert(item.username, next);
    item.note = next;
    item.updatedAt = Date.now();
    meta.textContent = formatRelativeTime(item.updatedAt);
    toggleEdit(false);
  });

  deleteBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(`Delete note for @${item.username}?`);
    if (!confirmed) return;
    await repo.remove(item.username);
    card.remove();
    if (!Object.keys(repo.notes).length) {
      const list = qs<HTMLElement>("#notesList");
      renderEmpty(list);
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(top);
  card.appendChild(body);
  card.appendChild(actions);
  return card;
};

const handleSearch = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const list = qs<HTMLElement>("#notesList");
  const items = filterNotes(repo.notes, input.value);
  renderList(items, list);
  updateCounter(items.length);
};

const updateCounter = (count: number) => {
  const label = qs<HTMLElement>("#noteCount");
  label.textContent = `${count} note${count === 1 ? "" : "s"}`;
};

const handleExport = async () => {
  const data = JSON.stringify(repo.notes, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "twitter-user-notes.json";
  a.click();
  URL.revokeObjectURL(url);
};

const handleImport = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validated = validateNotes(parsed);
      await repo.replaceAll(validated);
      const list = qs<HTMLElement>("#notesList");
      const items = filterNotes(repo.notes, "");
      renderList(items, list);
      updateCounter(items.length);
      alert("Import succeeded");
    } catch (err) {
      alert("Failed to import file. Ensure it is a valid export.");
      console.error(err);
    }
  });
  input.click();
};

const validateNotes = (data: unknown): NotesMap => {
  if (typeof data !== "object" || !data) throw new Error("Invalid data");
  const map: NotesMap = {};
  const entries = Object.entries(data as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const item = value as Partial<UserNote>;
    if (!item.username || !item.note) continue;
    const username = String(item.username);
    map[username.toLowerCase()] = {
      id: username.toLowerCase(),
      username,
      note: String(item.note),
      updatedAt: item.updatedAt ? Number(item.updatedAt) : Date.now()
    };
  }
  return map;
};

const handleCreate = async () => {
  const usernameInput = qs<HTMLInputElement>("#newUsername");
  const noteInput = qs<HTMLTextAreaElement>("#newNote");
  const username = usernameInput.value.trim().replace(/^@/, "");
  const note = noteInput.value.trim();

  if (!username) {
    alert("Username is required");
    return;
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    alert("Username is invalid");
    return;
  }
  if (!note) {
    alert("Note cannot be empty");
    return;
  }

  await repo.upsert(username, note);
  usernameInput.value = "";
  noteInput.value = "";

  const list = qs<HTMLElement>("#notesList");
  const items = filterNotes(repo.notes, qs<HTMLInputElement>("#search").value);
  renderList(items, list);
  updateCounter(items.length);
};

const mount = async () => {
  await repo.init();

  const search = qs<HTMLInputElement>("#search");
  search.addEventListener("input", handleSearch);

  qs<HTMLButtonElement>("#exportBtn").addEventListener("click", handleExport);
  qs<HTMLButtonElement>("#importBtn").addEventListener("click", handleImport);
  qs<HTMLButtonElement>("#createBtn").addEventListener("click", handleCreate);

  const items = filterNotes(repo.notes, "");
  renderList(items, qs<HTMLElement>("#notesList"));
  updateCounter(items.length);
};

document.addEventListener("DOMContentLoaded", () => {
  mount().catch((err) => {
    console.error("[xtag popup] failed to init", err);
    renderEmpty(qs<HTMLElement>("#notesList"));
  });
});

export {};
