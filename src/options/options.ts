interface UserNote {
  id: string;
  username: string;
  note: string;
  updatedAt: number;
}

type NotesMap = Record<string, UserNote>;

interface ExtensionSettings {
  preferLocal: boolean;
}

const STORAGE_KEY = "xtag_notes_v1";
const SETTINGS_KEY = "xtag_settings";

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

  get settingsState(): ExtensionSettings {
    return this.settings;
  }

  async setPreference(preferLocal: boolean): Promise<void> {
    this.settings = { preferLocal };
    await chrome.storage.local.set({ [SETTINGS_KEY]: this.settings });
    this.primary = preferLocal ? chrome.storage.local : chrome.storage.sync;
    this.secondary = preferLocal ? chrome.storage.sync : chrome.storage.local;
    this.useSecondary = false;
    await this.persist(this.cache);
  }

  async replaceAll(map: NotesMap): Promise<void> {
    this.cache = map;
    await this.persist(this.cache);
  }

  async clearAll(): Promise<void> {
    this.cache = {};
    await this.persist(this.cache);
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
}

const qs = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

const validateNotes = (data: unknown): NotesMap => {
  if (typeof data !== "object" || !data) throw new Error("Invalid data");
  const map: NotesMap = {};
  const entries = Object.entries(data as Record<string, unknown>);
  for (const [_key, value] of entries) {
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

class OptionsPage {
  private repo = new NotesRepository();

  async init(): Promise<void> {
    await this.repo.init();
    this.bindEvents();
    this.syncUI();
  }

  private bindEvents(): void {
    qs<HTMLInputElement>("#preferLocal").addEventListener("change", async (evt) => {
      const preferLocal = (evt.target as HTMLInputElement).checked;
      await this.repo.setPreference(preferLocal);
      this.toast(preferLocal ? "Using local storage only." : "Using Chrome sync storage.");
    });

    qs<HTMLButtonElement>("#export").addEventListener("click", () => this.handleExport());
    qs<HTMLButtonElement>("#import").addEventListener("click", () => this.handleImport());
    qs<HTMLButtonElement>("#clear").addEventListener("click", () => this.handleClear());
  }

  private syncUI(): void {
    qs<HTMLInputElement>("#preferLocal").checked = this.repo.settingsState.preferLocal;
    this.renderStats();
  }

  private renderStats(): void {
    const count = Object.keys(this.repo.notes).length;
    const stats = qs<HTMLElement>("#stats");
    stats.textContent = `${count} saved note${count === 1 ? "" : "s"}`;
  }

  private handleExport(): void {
    const data = JSON.stringify(this.repo.notes, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "twitter-user-notes.json";
    a.click();
    URL.revokeObjectURL(url);
    this.toast("Exported JSON file.");
  }

  private handleImport(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const map = validateNotes(JSON.parse(text) as unknown);
        await this.repo.replaceAll(map);
        this.renderStats();
        this.toast("Import completed.");
      } catch (err) {
        console.error(err);
        this.toast("Import failed. Please pick a valid export file.");
      }
    });
    input.click();
  }

  private async handleClear(): Promise<void> {
    const confirmed = window.confirm("This will remove all notes. Continue?");
    if (!confirmed) return;
    await this.repo.clearAll();
    this.renderStats();
    this.toast("All notes removed.");
  }

  private toast(message: string): void {
    const bar = qs<HTMLElement>("#toast");
    bar.textContent = message;
    bar.classList.add("visible");
    setTimeout(() => bar.classList.remove("visible"), 2200);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const page = new OptionsPage();
  page.init().catch((err) => {
    console.error("[xtag options] failed to init", err);
  });
});

export {};
