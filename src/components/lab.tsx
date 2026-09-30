"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  FlaskConical,
  Heart,
  Layers3,
  Map,
  Menu,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { concepts, getConcept, groups } from "@/lib/catalog";
import {
  emptySession,
  readSession,
  restoreSessionRoute,
  saveSession,
  sessionQuery,
  visitSession,
  type DraftUpdate,
  type WorkspacePage,
  type WorkspaceSession,
} from "@/lib/session";
import {
  emptyProgress,
  markProgress,
  mergeCloud,
  readProgress,
  saveProgress,
  type Progress,
} from "@/lib/progress";
import { getAccount, signOut } from "@/lib/auth";
import { Experiment } from "./experiment";
import { Journey } from "./journey";
import { CloudProgress } from "./cloud-progress";

export function Lab() {
  const [workspace, setWorkspace] = useState<WorkspaceSession>(emptySession),
    [progress, setProgress] = useState<Progress>(emptyProgress),
    [account, setAccount] = useState("guest"),
    [status, setStatus] = useState(""),
    [open, setOpen] = useState(false),
    [navCollapsed, setNavCollapsed] = useState(false);
  const { page, lesson: selectedLesson, query, filter } = workspace;
  const draft = workspace.drafts[selectedLesson];
  const search = useRef<HTMLInputElement>(null),
    menu = useRef<HTMLDialogElement>(null),
    accountRef = useRef("guest"),
    progressRef = useRef(progress),
    writable = useRef(true),
    initialized = useRef(false),
    volatile = useRef<Record<string, Progress>>({}),
    workspaceRef = useRef(workspace),
    sessionWritable = useRef(true),
    sessionLoaded = useRef(false);
  const updateWorkspace = useCallback((next: WorkspaceSession) => {
    workspaceRef.current = next;
    setWorkspace(next);
    if (sessionLoaded.current && sessionWritable.current) {
      try {
        saveSession(localStorage, next);
      } catch {
        sessionWritable.current = false;
        setStatus(
          "Draft storage failed. Your controls and replay position are held for this visit; refresh cannot restore these changes.",
        );
      }
    }
  }, []);
  const navigate = useCallback(
    (next: WorkspacePage, lesson?: string) => {
      const current = workspaceRef.current;
      const destination = visitSession(current, next, lesson);
      if (
        destination.page !== current.page ||
        destination.lesson !== current.lesson
      )
        window.history.pushState(null, "", sessionQuery(destination));
      updateWorkspace(destination);
      setOpen(false);
    },
    [updateWorkspace],
  );
  const updateDraft = useCallback(
    (update: DraftUpdate) => {
      const current = workspaceRef.current;
      const next =
        typeof update === "function"
          ? update(current.drafts[selectedLesson])
          : update;
      if (next.config.lesson !== selectedLesson) return;
      updateWorkspace({
        ...current,
        drafts: { ...current.drafts, [selectedLesson]: next },
      });
    },
    [selectedLesson, updateWorkspace],
  );
  const setQuery = (value: string) =>
    updateWorkspace({ ...workspaceRef.current, query: value });
  const setFilter = (value: string) =>
    updateWorkspace({ ...workspaceRef.current, filter: value });
  const loadAccount = useCallback((next: string) => {
    if (initialized.current)
      volatile.current[accountRef.current] = progressRef.current;
    initialized.current = true;
    accountRef.current = next;
    setAccount(next);
    writable.current = true;
    let value = volatile.current[next] || emptyProgress();
    try {
      const saved = readProgress(localStorage, next);
      value = volatile.current[next] || saved;
    } catch {
      writable.current = false;
      setStatus(
        "Browser storage is unavailable or unrecognized. Existing data is untouched; new progress lasts for this session.",
      );
    }
    progressRef.current = value;
    setProgress(value);
  }, []);
  useEffect(() => {
    loadAccount(getAccount() || "guest");
    let saved = workspaceRef.current;
    try {
      saved = readSession(localStorage);
    } catch {
      sessionWritable.current = false;
      setStatus(
        "Saved drafts are unavailable or unrecognized. Existing data is untouched; changes last for this visit.",
      );
    }
    workspaceRef.current = saved;
    sessionLoaded.current = true;
    const restore = () => {
      try {
        const next = restoreSessionRoute(
          workspaceRef.current,
          window.location.search,
        );
        updateWorkspace(next);
        window.history.replaceState(null, "", sessionQuery(next));
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Invalid experiment link.");
        updateWorkspace(workspaceRef.current);
      }
      setOpen(false);
    };
    restore();
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        navigate("library");
        requestAnimationFrame(() => search.current?.focus());
      }
    };
    const expiry = setInterval(() => {
      const current = getAccount() || "guest";
      if (current !== accountRef.current) {
        loadAccount(current);
        setStatus(
          current === "guest"
            ? "Your sign-in expired. Account progress is preserved separately; guest learning is active."
            : "Account changed. Loaded its separate local progress.",
        );
      }
    }, 1000);
    window.addEventListener("popstate", restore);
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(expiry);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("keydown", key);
    };
  }, [loadAccount, navigate, updateWorkspace]);
  useEffect(() => {
    if (open) menu.current?.showModal();
    else menu.current?.close();
  }, [open]);
  const store = useCallback((next: Progress) => {
    progressRef.current = next;
    volatile.current[accountRef.current] = next;
    setProgress(next);
    if (writable.current) {
      try {
        saveProgress(localStorage, next, accountRef.current);
      } catch {
        writable.current = false;
        setStatus(
          "Storage write failed. Progress is held in this session only.",
        );
      }
    }
  }, []);
  const explore = useCallback(
    (id: string) => store(markProgress(progressRef.current, id)),
    [store],
  );
  const understand = useCallback(
    (id: string) => store(markProgress(progressRef.current, id, true)),
    [store],
  );
  const select = (id: string) => {
    if (!getConcept(id)) return;
    navigate("lesson", id);
    requestAnimationFrame(() =>
      document.getElementById("main-content")?.focus(),
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const nav = (
    <>
      <a className="brand" href="/" aria-label="System Lab home">
        <span>
          <Layers3 size={24} />
        </span>
        <strong>
          system<span>lab</span>
          <small>UNDERSTAND BY DOING</small>
        </strong>
      </a>
      <div className="workspace-label">
        <span className="avatar">SL</span>
        <span>
          Your learning workspace
          <small>
            {account === "guest"
              ? "Guest · local progress"
              : "Signed in · separate account progress"}
          </small>
        </span>
      </div>
      <nav className="main-nav" aria-label="Workspace">
        {(
          [
            ["lesson", "Experiment", FlaskConical],
            ["library", "Concept library", BookOpen],
            ["journey", "Build a system", Map],
            ["progress", "Your progress", Trophy],
            ["cloud", "AWS & account", Cloud],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={19} />
            {label}
            {id === "library" && <small>56</small>}
          </button>
        ))}
      </nav>
      <div className="path-heading">LEARNING PATHS</div>
      <nav className="path-nav" aria-label="Learning paths">
        {groups.map((g) => (
          <details key={g.id} open={g.id === getConcept(selectedLesson)?.group}>
            <summary>
              {g.name}
              <small>{concepts.filter((c) => c.group === g.id).length}</small>
            </summary>
            <div>
              {concepts
                .filter((c) => c.group === g.id)
                .map((c) => (
                  <button
                    key={c.id}
                    className={
                      page === "lesson" && c.id === selectedLesson
                        ? "active"
                        : ""
                    }
                    onClick={() => select(c.id)}
                  >
                    <span>
                      {progress.understood.includes(c.id) ? (
                        <Check size={13} />
                      ) : progress.explored.includes(c.id) ? (
                        "◐"
                      ) : (
                        "○"
                      )}
                    </span>
                    {c.title}
                  </button>
                ))}
            </div>
          </details>
        ))}
      </nav>
      <div className="nav-progress">
        <strong>
          {progress.explored.length}
          <small> / 56 explored</small>
        </strong>
        <progress
          value={progress.explored.length}
          max="56"
          aria-label="Lessons explored"
        />
        <span>{progress.understood.length} understood</span>
      </div>
    </>
  );
  const filtered = concepts.filter(
    (c) =>
      (filter === "all" || filter === c.group) &&
      `${c.title} ${c.description} ${c.service}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to learning workspace
      </a>
      <aside id="workspace-navigation" className="sidebar">
        {nav}
      </aside>
      <dialog
        ref={menu}
        className="mobile-navigation"
        aria-label="Navigation"
        onCancel={() => setOpen(false)}
      >
        <button
          className="icon-button close-nav"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        {open && nav}
      </dialog>
      <div className="app-content">
        <header className="topbar">
          <button
            className="icon-button desktop-nav-toggle"
            onClick={() => setNavCollapsed((value) => !value)}
            aria-label={
              navCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            aria-expanded={!navCollapsed}
            aria-controls="workspace-navigation"
          >
            <Menu />
          </button>
          <button
            className="icon-button mobile-toggle"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div>
            <span>System Lab</span>
            <ChevronRight size={15} />
            <strong>
              {page === "lesson"
                ? getConcept(selectedLesson)?.title
                : page === "journey"
                  ? "Build a system"
                  : page === "cloud"
                    ? "AWS & account"
                    : page === "progress"
                      ? "Your progress"
                      : "Concept library"}
            </strong>
          </div>
          <button
            className="search-shortcut"
            onClick={() => {
              navigate("library");
              requestAnimationFrame(() => search.current?.focus());
            }}
          >
            <Search size={17} />
            <span>Find a concept</span>
            <kbd>⌘ K</kbd>
          </button>
          <span className="local-badge">
            <span />
            Local simulation
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          {status && (
            <div className="status-banner" role="status">
              <span>{status}</span>
              <button
                className="icon-button"
                aria-label="Dismiss status"
                onClick={() => setStatus("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {page === "lesson" ? (
            <Experiment
              key={selectedLesson}
              draft={draft}
              onDraftChange={updateDraft}
              onExplore={explore}
              onUnderstand={understand}
              onSelect={select}
            />
          ) : page === "journey" ? (
            <Journey onSelect={select} />
          ) : page === "cloud" ? (
            <CloudProgress
              key={account}
              account={account}
              progress={progress}
              onMerge={(raw) => store(mergeCloud(progressRef.current, raw))}
              onSelect={select}
              onLogout={() => {
                try {
                  signOut();
                  loadAccount("guest");
                  setStatus(
                    "Signed out locally. Guest progress restored; account records remain separate.",
                  );
                } catch {
                  setStatus(
                    "Session storage could not be cleared. Sign-out is not confirmed.",
                  );
                }
              }}
            />
          ) : page === "library" ? (
            <>
              <header className="lesson-heading">
                <div>
                  <div className="eyebrow">
                    56 MECHANISMS · 7 LEARNING PATHS
                  </div>
                  <h1>Find your next “aha”.</h1>
                  <p>
                    Choose a concept, make a prediction, and inspect what
                    actually happens.
                  </p>
                </div>
              </header>
              <div className="library-toolbar">
                <label className="search-field">
                  <Search size={21} />
                  <input
                    ref={search}
                    aria-label="Search concepts"
                    placeholder="Search concepts, patterns, or AWS services"
                    maxLength={500}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <span>{filtered.length} concepts</span>
              </div>
              <div className="filter-chips" aria-label="Filter concepts">
                {[{ id: "all", name: "All concepts" }, ...groups].map((g) => (
                  <button
                    key={g.id}
                    aria-pressed={filter === g.id}
                    onClick={() => setFilter(g.id)}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
              <div className="library-grid">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    className="concept-card"
                    onClick={() => select(c.id)}
                  >
                    <span className="card-category">
                      {groups.find((g) => g.id === c.group)?.name}
                      <span>
                        {progress.understood.includes(c.id)
                          ? "✓ Understood"
                          : progress.explored.includes(c.id)
                            ? "◐ Explored"
                            : `${c.minutes} min`}
                      </span>
                    </span>
                    <h2>{c.title}</h2>
                    <p>{c.description}</p>
                    <span className="card-footer">
                      {c.difficulty}
                      <ArrowUpRight size={18} />
                    </span>
                  </button>
                ))}
              </div>
              {!filtered.length && (
                <section className="empty-state">
                  <h2>No matching concepts</h2>
                  <p>Try a broader search or another learning path.</p>
                  <button
                    className="button"
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  >
                    Clear search and filters
                  </button>
                </section>
              )}
            </>
          ) : (
            <>
              <header className="lesson-heading">
                <div>
                  <div className="eyebrow">
                    {account === "guest" ? "GUEST" : "ACCOUNT"} PROGRESS
                  </div>
                  <h1>From explored to understood.</h1>
                  <p>
                    Interaction marks a concept explored. A correct optional
                    prediction check records understanding. Revisit whenever you
                    need.
                  </p>
                </div>
              </header>
              <div className="progress-overview">
                <div>
                  <strong>
                    {progress.explored.length}
                    <small>/56</small>
                  </strong>
                  <span>Explored</span>
                </div>
                <div>
                  <strong>
                    {progress.understood.length}
                    <small>/56</small>
                  </strong>
                  <span>Understood</span>
                </div>
              </div>
              <p>
                Legacy completions are preserved as explored.{" "}
                {account === "guest"
                  ? "Guest records stay in this browser."
                  : "Account records are separate from guest records. Use AWS & account to sync explored lessons."}
              </p>
              <div className="progress-paths">
                {groups.map((g) => {
                  const list = concepts.filter((c) => c.group === g.id),
                    seen = list.filter((c) =>
                      progress.explored.includes(c.id),
                    ).length,
                    known = list.filter((c) =>
                      progress.understood.includes(c.id),
                    ).length;
                  return (
                    <section key={g.id}>
                      <div>
                        <h2>{g.name}</h2>
                        <p>
                          {seen} explored · {known} understood · {list.length}{" "}
                          total
                        </p>
                        <progress
                          value={known}
                          max={list.length}
                          aria-label={`${g.name} understood`}
                        />
                      </div>
                      <button
                        className="button"
                        onClick={() =>
                          select(
                            list.find(
                              (c) => !progress.understood.includes(c.id),
                            )?.id || list[0].id,
                          )
                        }
                      >
                        Continue
                        <ChevronRight size={16} />
                      </button>
                    </section>
                  );
                })}
              </div>
            </>
          )}
          <footer className="main-footer">
            <span>A workspace for curious engineers.</span>
            <a href="https://amankeshri.com" target="_blank" rel="noreferrer">
              Made with <Heart size={14} />
              <span className="sr-only">heart</span> by Aman
              <ArrowUpRight size={14} />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
