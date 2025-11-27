console.log('>>> Twitter Notes content script v999');
(() => {
  interface UserNote {
    id: string;
    username: string;
    note: string;
    updatedAt: number;
  }

  type NotesMap = Record<string, UserNote>;

  const STORAGE_KEY = "xtag_notes_v1";
  const SETTINGS_KEY = "xtag_settings";
  const ATTR_ENHANCED = "data-xtag-enhanced";
  const ATTR_USERNAME = "data-xtag-username";

  const log = (...args: unknown[]) => console.debug("[xtag]", ...args);

  const now = () => Date.now();

  interface ExtensionSettings {
    preferLocal: boolean;
  }

  class NotesStorage {
    private primary: chrome.storage.StorageArea;
    private secondary: chrome.storage.StorageArea | null;
    private cache: NotesMap = {};
    private useSecondary = false;
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

    syncCacheFromExternal(map: NotesMap): void {
      this.cache = map;
    }

    async save(username: string, note: string): Promise<UserNote> {
      const trimmed = note.trim();
      const key = username.toLowerCase();
      const record: UserNote = {
        id: key,
        username,
        note: trimmed,
        updatedAt: now()
      };

      this.cache[key] = record;
      await this.persist(this.cache);
      return record;
    }

    async remove(username: string): Promise<void> {
      const key = username.toLowerCase();
      delete this.cache[key];
      await this.persist(this.cache);
    }

    private async loadSettings(): Promise<ExtensionSettings> {
      try {
        const data = await chrome.storage.local.get(SETTINGS_KEY);
        const settings = (data?.[SETTINGS_KEY] as ExtensionSettings | undefined) ?? { preferLocal: false };
        return settings;
      } catch {
        return { preferLocal: false };
      }
    }

    private async readAll(): Promise<NotesMap> {
      try {
        const syncData = await this.primary.get(STORAGE_KEY);
        const map = (syncData?.[STORAGE_KEY] as NotesMap | undefined) ?? {};
        return map;
      } catch (err) {
        log("primary storage failed, falling back to secondary", err);
        this.useSecondary = true;
        if (!this.secondary) return {};
        const localData = await this.secondary.get(STORAGE_KEY);
        const map = (localData?.[STORAGE_KEY] as NotesMap | undefined) ?? {};
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
          log("primary set failed, switching to secondary", err);
          this.useSecondary = true;
          await this.secondary.set({ [STORAGE_KEY]: map });
          return;
        }
        throw err;
      }
    }
  }

  const storage = new NotesStorage();

  const injectStyles = () => {
    if (document.getElementById("xtag-style")) return;
    const style = document.createElement("style");
    style.id = "xtag-style";
    style.textContent = `
      .xtag-note-wrapper {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #4b5563;
      }
      .xtag-note-pill {
        max-width: 220px;
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(59,130,246,0.12);
        color: #1f2937;
        border: 1px solid rgba(59,130,246,0.25);
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .xtag-note-pill.empty {
        background: rgba(107,114,128,0.12);
        color: #4b5563;
        border-color: rgba(107,114,128,0.25);
        font-weight: 500;
      }
      .xtag-note-btn {
        cursor: pointer;
        border: 1px solid rgba(59,130,246,0.3);
        background: none;
        color: #1f2937;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1;
        transition: all 0.16s ease;
      }
      .xtag-note-btn:hover {
        background: rgba(59,130,246,0.1);
        transform: translateY(-1px);
      }
      .xtag-note-btn:active {
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  };

  const normalizeUsername = (href: string): string | null => {
    if (!href.startsWith("/")) return null;
    const normalized = href.split("?")[0].split("#")[0];
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    const username = parts[0];
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;
    return username;
  };

  const extractUsername = (article: HTMLElement): { username: string; anchor: HTMLAnchorElement } | null => {
    const header = article.querySelector<HTMLElement>('div[data-testid="User-Name"]');
    const anchors = header
      ? Array.from(header.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'))
      : Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'));

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      const username = normalizeUsername(href);
      if (username) {
        return { username, anchor };
      }
    }
    return null;
  };

  const createNoteUI = (username: string, noteText: string | undefined): HTMLElement => {
    const wrapper = document.createElement("span");
    wrapper.className = "xtag-note-wrapper";
    wrapper.setAttribute(ATTR_USERNAME, username);

    const pill = document.createElement("span");
    pill.className = "xtag-note-pill";
    pill.title = noteText ?? "No note yet";
    pill.setAttribute(ATTR_USERNAME, username);

    const label = noteText?.trim();
    if (label) {
      pill.textContent = `[${label}]`;
    } else {
      pill.textContent = "[ ]";
      pill.classList.add("empty");
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "xtag-note-btn";
    btn.textContent = "✏️";
    btn.title = label ? "Edit note" : "Add note";

    btn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      const current = storage.notes[username.toLowerCase()]?.note ?? "";
      const next = window.prompt(`Add a note for @${username}`, current);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) {
        await storage.remove(username);
        updatePill(pill, username, undefined, btn);
        return;
      }
      await storage.save(username, trimmed);
      updatePill(pill, username, trimmed, btn);
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(pill);
    return wrapper;
  };

  const updatePill = (pill: HTMLElement, username: string, noteText: string | undefined, btn?: HTMLElement) => {
    const label = noteText?.trim();
    if (label) {
      pill.textContent = `[${label}]`;
      pill.classList.remove("empty");
      pill.title = label;
      if (btn) btn.title = "Edit note";
    } else {
      pill.textContent = "[Add note]";
      pill.classList.add("empty");
      pill.title = "No note yet";
      if (btn) btn.title = "Add note";
    }
    pill.setAttribute(ATTR_USERNAME, username);
  };

  const enhanceTweet = (article: HTMLElement): void => {
    if (article.getAttribute(ATTR_ENHANCED)) return;
    const parsed = extractUsername(article);
    if (!parsed) return;

    const { username, anchor } = parsed;
    const existingNote = storage.notes[username.toLowerCase()];
    const ui = createNoteUI(username, existingNote?.note);

    anchor.insertAdjacentElement("afterend", ui);
    article.setAttribute(ATTR_ENHANCED, "1");
  };

  const scanExistingTweets = () => {
    const articles = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
    articles.forEach((article) => enhanceTweet(article));
  };

  const observeTimeline = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('article[data-testid="tweet"]')) {
            enhanceTweet(node);
          } else {
            const nested = node.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
            nested.forEach((article) => enhanceTweet(article));
          }
        });
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true
    });
  };

  const refreshRenderedNotes = (notes: NotesMap) => {
    const pills = document.querySelectorAll<HTMLElement>(".xtag-note-pill");
    pills.forEach((pill) => {
      const username = pill.getAttribute(ATTR_USERNAME);
      if (!username) return;
      const record = notes[username.toLowerCase()];
      updatePill(pill, username, record?.note);
    });
  };

  const setupStorageListener = () => {
    chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
      if (changes[SETTINGS_KEY]) {
        storage
          .init()
          .then(() => refreshRenderedNotes(storage.notes))
          .catch((err) => console.error("[xtag] failed to reload settings", err));
        return;
      }
      const changed = changes[STORAGE_KEY];
      if (!changed) return;
      const newValue = (changed.newValue as NotesMap | undefined) ?? {};
      storage.syncCacheFromExternal(newValue);
      refreshRenderedNotes(newValue);
      log(`storage updated from ${areaName}`);
    });
  };

  const start = async () => {
    injectStyles();
    await storage.init();
    scanExistingTweets();
    observeTimeline();
    setupStorageListener();
    log("content script ready");
  };

  start().catch((err) => console.error("[xtag] failed to init", err));
})();
