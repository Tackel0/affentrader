"use client";
import { useState, useRef } from "react";
import { Upload, Trash2, BookOpen } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { Modal, IconButton } from "./ui";
export function PineLibraries({ onClose }: { onClose: () => void }) {
  const libraries = useChartStore((s) => s.pineLibraries);
  const [path, setPath] = useState(""),
    [source, setSource] = useState(""),
    [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[1-9]\d*$/.test(path.trim())) {
      setError("Use the exact import path: Author/Library/Version.");
      return;
    }
    if (!/\blibrary\s*\(/.test(source)) {
      setError("The source must contain a Pine library() declaration.");
      return;
    }
    const store = useChartStore.getState();
    store.set({
      pineLibraries: { ...store.pineLibraries, [path.trim()]: source },
    });
    setError("");
    store.toast(
      "Pine library registered",
      `${path} is available to imported scripts. Run the script again.`,
      "success",
    );
    setPath("");
    setSource("");
  };
  return (
    <Modal
      title="Pine import libraries"
      onClose={onClose}
      className="library-modal"
    >
      <div className="library-intro">
        <BookOpen size={18} />
        <p>
          Register the source of a library referenced by{" "}
          <code>import Author/Library/Version</code>. Dependencies resolve in
          the worker through the official PineTS bridge. Use scripts and
          libraries you have access to.
        </p>
      </div>
      <div className="library-list">
        {Object.keys(libraries).map((key) => (
          <div key={key}>
            <button
              onClick={() => {
                setPath(key);
                setSource(libraries[key]);
              }}
            >
              <code>{key}</code>
            </button>
            <IconButton
              label={`Remove library ${key}`}
              onClick={() => {
                const next = { ...libraries };
                delete next[key];
                useChartStore.getState().set({ pineLibraries: next });
              }}
            >
              <Trash2 size={13} />
            </IconButton>
          </div>
        ))}
      </div>
      <form onSubmit={save}>
        <div className="form-body">
          <label>
            Import path
            <input
              aria-label="Library import path"
              placeholder="LuxAlgo/LibraryName/1"
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <label>
            Library Pine source
            <textarea
              className="library-source"
              aria-label="Library source"
              required
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
            />
          </label>
          {error ? <p className="error-message">{error}</p> : null}
        </div>
        <div className="modal-actions">
          <button
            className="button"
            type="button"
            onClick={() => file.current?.click()}
          >
            <Upload size={13} />
            Import file
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".pine,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setSource(await f.text());
              e.target.value = "";
            }}
          />
          <span className="flex-1" />
          <button className="button primary">Register library</button>
        </div>
      </form>
    </Modal>
  );
}
