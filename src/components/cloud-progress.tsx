"use client";
import { useRef, useState } from "react";
import { Cloud, LogOut, RefreshCw } from "lucide-react";
import { concepts } from "@/lib/catalog";
import { cloudConfigured, getAccount, getToken, signIn } from "@/lib/auth";
import { getControl } from "@/lib/simulation";
import { mergeCloud, type Progress } from "@/lib/progress";

export function CloudProgress({
  account,
  progress,
  onMerge,
  onLogout,
  onSelect,
}: {
  account: string;
  progress: Progress;
  onMerge: (data: unknown) => void;
  onLogout: () => void;
  onSelect: (id: string) => void;
}) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const operation = useRef(0);
  const sync = async (direction: "load" | "save") => {
    const token = getToken(),
      identity = getAccount();
    if (!token || identity !== account) {
      setStatus(
        "Session expired. Your account progress remains local. Sign in again to sync.",
      );
      return;
    }
    const requestId = ++operation.current;
    setBusy(true);
    setStatus(
      direction === "load"
        ? "Loading account progress…"
        : "Saving explored lessons…",
    );
    const current = () =>
      requestId === operation.current && getAccount() === identity;
    try {
      if (direction === "load") {
        const response = await fetch("/api/runs", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error(
            response.status === 401 || response.status === 403
              ? "Session expired or access denied. Sign in again."
              : "Cloud load failed. Your local progress is intact; retry when available.",
          );
        const data: unknown = await response.json();
        mergeCloud(progress, data);
        if (current()) {
          onMerge(data);
          setStatus(
            "Explored lessons loaded from your account. Understanding checks remain local to this account.",
          );
        }
      } else {
        let saved = 0;
        for (const id of progress.explored) {
          if (!current())
            throw new Error(
              "Session changed. Sync stopped; local progress is intact.",
            );
          // Preserve the deployed legacy progress envelope. These fields do not represent the v2 experiment.
          const response = await fetch("/api/runs", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              conceptId: id,
              traffic: 1200,
              replicas: 3,
              parameter: getControl(concepts.find((c) => c.id === id)!).initial,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok)
            throw new Error(
              `${saved} of ${progress.explored.length} explored lessons synced. ${response.status === 401 || response.status === 403 ? "Sign in again." : "Retry to safely resend the remaining progress."} Local records are intact.`,
            );
          saved++;
        }
        if (current())
          setStatus(
            `${saved} explored lessons synced. Understanding checks stay local to this account; the current cloud schema does not store them.`,
          );
      }
    } catch (error) {
      if (current())
        setStatus(
          error instanceof Error
            ? error.message
            : "Cloud sync failed. Retry when available.",
        );
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <>
      <header className="lesson-heading">
        <div>
          <div className="eyebrow">OPTIONAL CLOUD LAYER</div>
          <h1>Learn here. Connect when ready.</h1>
          <p>
            Every experiment runs in your browser. AWS is an explanatory layer
            and an optional progress backend.
          </p>
        </div>
      </header>
      <section className="cloud-card">
        <Cloud size={30} />
        <div>
          <h2>
            {account === "guest"
              ? "Guest learning is fully usable"
              : "Signed-in account progress"}
          </h2>
          <p>
            {cloudConfigured
              ? "This configuration uses an invite-only Cognito pool. An administrator must create an account; public signup is not enabled."
              : "No cloud identity is configured. You can use every lesson, challenge, comparison, and journey as a guest."}
          </p>
          <p>
            Guest progress and account progress are stored separately. Loading
            cloud records never imports your guest work. The existing backend
            syncs explored lessons only.
          </p>
          <div className="button-row">
            {account === "guest" ? (
              <button
                className="button primary"
                disabled={!cloudConfigured}
                onClick={async () => {
                  try {
                    await signIn();
                  } catch (e) {
                    setStatus(
                      e instanceof Error
                        ? e.message
                        : "Sign-in could not start.",
                    );
                  }
                }}
              >
                {cloudConfigured
                  ? "Sign in to invited account"
                  : "Cloud not configured"}
              </button>
            ) : (
              <>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => sync("load")}
                >
                  <RefreshCw size={16} />
                  Load account progress
                </button>
                <button
                  className="button primary"
                  disabled={busy || !progress.explored.length}
                  onClick={() => sync("save")}
                >
                  {busy ? "Syncing…" : "Sync explored lessons"}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    operation.current++;
                    onLogout();
                  }}
                >
                  <LogOut size={16} />
                  Sign out locally
                </button>
              </>
            )}
          </div>
          {status && (
            <p role="status" className="inline-notice">
              {status}
            </p>
          )}
        </div>
      </section>
      <section className="cloud-flow">
        <h2>Optional progress path</h2>
        <p>
          Browser → Cognito identity → Next.js proxy → API Gateway JWT
          authorizer → Lambda validation → user-scoped DynamoDB records.
        </p>
        <p>
          Local sign-out removes this browser’s tokens. It does not revoke
          already-issued tokens or end the identity provider’s separate login
          session.
        </p>
      </section>
      <div className="table-scroll">
        <table>
          <caption>
            All 56 concepts and their example AWS implementations
          </caption>
          <thead>
            <tr>
              <th>Concept</th>
              <th>Example service</th>
              <th>Execution choice</th>
            </tr>
          </thead>
          <tbody>
            {concepts.map((c) => (
              <tr key={c.id}>
                <th>
                  <button
                    className="text-button"
                    onClick={() => onSelect(c.id)}
                  >
                    {c.title}
                  </button>
                </th>
                <td>{c.service}</td>
                <td>{c.compute}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
