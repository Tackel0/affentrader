"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, Heart, Lock, Globe, Trash2 } from "lucide-react";
import { useServerStore } from "@/stores/useServerStore";
import { useChartStore } from "@/stores/useChartStore";
import {
  scriptLibrary,
  type ScriptDetail,
  type ScriptKind,
  type ScriptSummary,
  type Visibility,
} from "@/lib/libraryClient";
import { ServerKeyField } from "./RuleForm";
import { Modal } from "./ui";

type Tab = "browse" | "invite" | "mine" | "publish";

interface Props {
  name: string;
  source: string;
  onLoad: (name: string, source: string) => void;
  onClose: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ScriptLibrary({ name, source, onLoad, onClose }: Props) {
  const serverKey = useServerStore((s) => s.key);
  const [tab, setTab] = useState<Tab>("browse");
  const [rows, setRows] = useState<ScriptSummary[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("recent");
  const [selected, setSelected] = useState<ScriptDetail | null>(null);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // Publish form.
  const [title, setTitle] = useState(name);
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [pubKind, setPubKind] = useState<ScriptKind>(/\bstrategy\s*\(/.test(source) ? "strategy" : /\blibrary\s*\(/.test(source) ? "library" : "indicator");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [notes, setNotes] = useState("");
  const [updating, setUpdating] = useState<ScriptDetail | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const list = tab === "mine" ? await scriptLibrary.mine(serverKey) : await scriptLibrary.list(query, kind, sort);
      setRows(list.scripts);
    } catch (e) {
      setRows([]);
      setError(messageOf(e));
    }
  }, [tab, query, kind, sort, serverKey]);

  useEffect(() => {
    if (tab !== "browse" && tab !== "mine") return;
    const handle = setTimeout(() => void refresh(), tab === "browse" ? 200 : 0);
    return () => clearTimeout(handle);
  }, [tab, refresh]);

  const open = async (row: ScriptSummary) => {
    setError("");
    try {
      const code = row.visibility === "invite" ? invite : "";
      setSelected((await scriptLibrary.get(row.id, code, tab === "mine" ? serverKey : "")).script);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const useScript = (script: ScriptDetail) => {
    onLoad(script.title, script.source);
    useChartStore.getState().toast("Script loaded", `${script.title} v${script.version} is in the editor. Review the source, then add it to the chart.`, "success");
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fields = {
        title,
        description,
        author,
        kind: pubKind,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility,
        source,
        notes,
      };
      const result = updating
        ? await scriptLibrary.update(serverKey, updating.id, { ...fields, visibility: updating.visibility === visibility && visibility === "invite" ? undefined : visibility })
        : await scriptLibrary.publish(serverKey, fields);
      setSelected(result.script);
      setUpdating(null);
      setNotice(
        result.invite
          ? `Published. Share this invite code (shown once): ${result.invite}`
          : `Published version ${result.script.version}.`,
      );
      setTab("mine");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const like = async (script: ScriptDetail) => {
    try {
      const result = await scriptLibrary.like(script.id, !script.liked, script.visibility === "invite" ? invite : "");
      setSelected({ ...script, liked: result.liked, likes: result.likes });
      setRows((current) => current.map((r) => (r.id === script.id ? { ...r, likes: result.likes } : r)));
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const tabs: [Tab, string][] = [
    ["browse", "Browse"],
    ["invite", "Invite code"],
    ["mine", "My scripts"],
    ["publish", "Publish"],
  ];

  return (
    <Modal title="Community scripts" onClose={onClose} className="library-modal script-library">
      <div className="library-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setSelected(null);
              setError("");
              setNotice("");
              if (id === "publish" && !updating) setTitle(name);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="form-body library-body">
        {tab === "browse" || tab === "mine" ? (
          <>
            {tab === "browse" ? (
              <div className="library-filters">
                <input aria-label="Search scripts" placeholder="Search title, author or tag" value={query} onChange={(e) => setQuery(e.target.value)} />
                <select aria-label="Script type" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">All types</option>
                  <option value="indicator">Indicators</option>
                  <option value="strategy">Strategies</option>
                  <option value="library">Libraries</option>
                </select>
                <select aria-label="Sort scripts" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="recent">Newest</option>
                  <option value="popular">Most liked</option>
                </select>
              </div>
            ) : !serverKey ? (
              <ServerKeyField />
            ) : null}
            <div className="library-results">
              {rows.length === 0 && !error ? <p className="form-help">{tab === "browse" ? "No public scripts yet." : "You have not published anything yet."}</p> : null}
              {rows.map((row) => (
                <button key={row.id} className={`library-row ${selected?.id === row.id ? "active" : ""}`} onClick={() => void open(row)}>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {row.kind} · v{row.version} · {row.author}
                    {row.visibility === "invite" ? " · invite-only" : ""}
                  </span>
                  <span className="muted">
                    <Heart size={11} /> {row.likes}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {tab === "invite" ? (
          <>
            <p className="form-help">Invite-only scripts are not listed anywhere. Paste the code the author sent you to open one.</p>
            <input aria-label="Invite code" placeholder="Invite code" value={invite} onChange={(e) => setInvite(e.target.value.trim())} />
            <button
              className="button primary"
              disabled={!invite}
              onClick={async () => {
                setError("");
                try {
                  setSelected((await scriptLibrary.openInvite(invite)).script);
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            >
              <Lock size={13} /> Open script
            </button>
          </>
        ) : null}
        {tab === "publish" ? (
          <form onSubmit={submit} className="library-publish">
            {!serverKey ? (
              <>
                <p className="form-help">Publishing needs this server&apos;s access key.</p>
                <ServerKeyField />
              </>
            ) : null}
            {updating ? (
              <p className="form-help">
                Publishing a new version of <strong>{updating.title}</strong> (currently v{updating.version}).
              </p>
            ) : null}
            <label>
              Title
              <input required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Description
              <textarea maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="library-filters">
              <label>
                Author name
                <input maxLength={60} placeholder="Anonymous" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </label>
              <label>
                Type
                <select value={pubKind} onChange={(e) => setPubKind(e.target.value as ScriptKind)}>
                  <option value="indicator">Indicator</option>
                  <option value="strategy">Strategy</option>
                  <option value="library">Library</option>
                </select>
              </label>
              <label>
                Visibility
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                  <option value="public">Public (listed)</option>
                  <option value="invite">Invite-only (code required)</option>
                </select>
              </label>
            </div>
            <label>
              Tags (comma separated)
              <input value={tags} placeholder="trend, ema" onChange={(e) => setTags(e.target.value)} />
            </label>
            <label>
              Release notes
              <input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <p className="form-help">
              Publishes the script currently in the editor ({source.split("\n").length} lines). Only publish code you wrote or may redistribute.
            </p>
            <button className="button primary" disabled={busy || !serverKey}>
              {busy ? "Publishing…" : updating ? "Publish new version" : "Publish script"}
            </button>
          </form>
        ) : null}
        {selected ? (
          <div className="library-detail">
            <h3>
              {selected.title} <small>v{selected.version}</small>
            </h3>
            <p className="muted">
              {selected.kind} by {selected.author} · {selected.visibility === "invite" ? <Lock size={11} /> : <Globe size={11} />} {selected.visibility}
            </p>
            {selected.description ? <p>{selected.description}</p> : null}
            {selected.tags.length ? <p className="muted">{selected.tags.map((t) => `#${t}`).join(" ")}</p> : null}
            <details>
              <summary>Version history ({selected.versions.length})</summary>
              <ul>
                {[...selected.versions].reverse().map((v) => (
                  <li key={v.version}>
                    v{v.version} · {new Date(v.publishedAt).toLocaleDateString()} · {v.notes}
                  </li>
                ))}
              </ul>
            </details>
            <div className="sync-actions">
              <button className="button primary small" onClick={() => useScript(selected)}>
                Load into editor
              </button>
              <button className="button small" onClick={() => void like(selected)}>
                <Heart size={12} fill={selected.liked ? "currentColor" : "none"} /> {selected.likes}
              </button>
              <button
                className="button small"
                aria-label="Copy source"
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.source);
                  setNotice("Source copied.");
                }}
              >
                <Copy size={12} /> Copy
              </button>
              {tab === "mine" && serverKey ? (
                <>
                  <button
                    className="button small"
                    onClick={() => {
                      setUpdating(selected);
                      setTitle(selected.title);
                      setDescription(selected.description);
                      setPubKind(selected.kind);
                      setTags(selected.tags.join(", "));
                      setVisibility(selected.visibility);
                      setTab("publish");
                      setSelected(null);
                    }}
                  >
                    Publish new version
                  </button>
                  {selected.visibility === "invite" ? (
                    <button
                      className="button small"
                      onClick={async () => {
                        try {
                          const result = await scriptLibrary.update(serverKey, selected.id, { visibility: "invite" });
                          setNotice(`New invite code (old links stop working): ${result.invite}`);
                        } catch (e) {
                          setError(messageOf(e));
                        }
                      }}
                    >
                      New invite code
                    </button>
                  ) : null}
                  <button
                    className="button small"
                    onClick={async () => {
                      if (!window.confirm(`Delete "${selected.title}" and all its versions from this server?`)) return;
                      try {
                        await scriptLibrary.remove(serverKey, selected.id);
                        setSelected(null);
                        void refresh();
                      } catch (e) {
                        setError(messageOf(e));
                      }
                    }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? <p className="error-message">{error}</p> : null}
        {notice ? <p className="ticket-ok">{notice}</p> : null}
      </div>
    </Modal>
  );
}
