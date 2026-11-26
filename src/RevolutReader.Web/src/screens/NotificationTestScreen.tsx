import { useSyncExternalStore, type JSX } from "react";
import {
  clearRecord,
  readRecord,
  RECORD_CHANGED,
  RECORD_KEY,
  type Listed,
  type RecordEntry,
  type RecordEvent,
} from "../app/notificationTestRecord";

/**
 * Temporary, for the iPhone test of #113 (reverted with it): the test page, at an address nothing links to
 * (`/test/notifications`). It shows the record `notificationTestRecord.ts` keeps, the newest entry first, and updates
 * as entries come. It reads only the phone's own storage: it sends no request, so it reads no bank data and needs no
 * login.
 */
export function NotificationTestScreen(): JSX.Element {
  const stored = useSyncExternalStore(subscribe, storedRecord);
  const entries = [...readRecord({ getItem: () => stored })].reverse();

  return (
    <main className="flex min-h-dvh flex-col gap-3 bg-background px-4 pt-[calc(env(safe-area-inset-top,0px)_+_1rem)] pb-[calc(env(safe-area-inset-bottom,0px)_+_1rem)] font-mono text-xs text-ink">
      <h1 className="text-base font-semibold">Zkouška oznámení (#113)</h1>
      <p>
        Záznam je jen v tomto telefonu, nic se neodesílá. Nejnovější nahoře.
      </p>
      <button
        type="button"
        className="self-start rounded border px-3 py-1"
        onClick={() => {
          clearRecord(window);
        }}
      >
        Smazat záznam
      </button>
      {entries.length === 0 ? (
        <p>Záznam je prázdný.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </main>
  );
}

function Entry({ entry }: { entry: RecordEntry }): JSX.Element {
  const loaded = entry.loadedBy === null ? "" : ` · ${entry.loadedBy}`;
  const listed = entry.listed;

  return (
    <li className="flex flex-col gap-0.5 border-t pt-2">
      <span className="font-semibold">
        #{entry.id} {EVENTS[entry.event]} {time(entry.at)} ·{" "}
        {VISIBILITY[entry.visibility] ?? entry.visibility}
        {loaded}
      </span>
      <span>
        {entry.path}
        {entry.fragment === "" ? " (bez #)" : entry.fragment}
      </span>
      <span>{listedText(listed)}</span>
      {listed?.kind === "listed"
        ? listed.test.map((notification, index) => (
            <span key={index} className="break-all">
              {notification.title} · {notification.body} ·{" "}
              {JSON.stringify(notification.test)}
            </span>
          ))
        : null}
      <span>stránka spuštěna {time(entry.startedAt)}</span>
    </li>
  );
}

const EVENTS: Record<RecordEvent, string> = {
  start: "spuštění",
  front: "zpět na popředí",
  fragment: "změna #",
  restored: "obnovení z mezipaměti",
};

const VISIBILITY: Record<string, string> = {
  visible: "viditelná",
  hidden: "skrytá",
};

function listedText(listed: Listed | null): string {
  if (listed === null) return "oznámení: čeká se na odpověď";
  switch (listed.kind) {
    case "listed":
      return `oznámení po ${listed.afterMs} ms: ${listed.test.length} zkušební, ${listed.others} jiné`;
    case "failed":
      return `oznámení po ${listed.afterMs} ms: chyba ${listed.error}`;
    case "unavailable":
      return `oznámení: nelze (${listed.reason})`;
  }
}

/** The phone's local date and time to the millisecond, as `26.11. 14:03:21.123`. */
function time(iso: string): string {
  const at = new Date(iso);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${at.getDate()}.${at.getMonth() + 1}. ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, "0")}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(RECORD_CHANGED, onChange);
  return () => {
    window.removeEventListener(RECORD_CHANGED, onChange);
  };
}

/** The record as stored, compared as text, so the page renders again only when it changed. */
function storedRecord(): string | null {
  try {
    return localStorage.getItem(RECORD_KEY);
  } catch {
    return null;
  }
}
