"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { setAuthToken } from "@/lib/api";
import { Logo } from "./Logo";

const MCP_URL = "http://localhost:8000/mcp";

/*
 * Colour carries one meaning each in this panel, which is the whole reason it
 * is readable at a glance:
 *
 *   emerald — the system is alive. Nothing else is ever emerald.
 *   violet  — structure and sequence: the rail, the step markers.
 *   cyan    — things you copy and run. Nothing decorative is cyan.
 *
 * The earlier version used cyan for all three, which left it meaning "this is
 * a bit important" — a colour saying that about four different things at once
 * is saying nothing.
 */

/**
 * How to connect, per client.
 *
 * Kept as data rather than markup because the list only grows, and because
 * every one of these is a thing a user has to type exactly right — the key
 * name differs per client and a wrong one fails silently, with the server
 * simply never appearing. Each entry says where the config lives, since "add
 * it to your MCP settings" is the instruction people are already stuck on.
 */
const CLIENTS = [
  {
    id: "claude",
    name: "Claude Code",
    where: "One command, from anywhere",
    code: `claude mcp add --scope user --transport http synapsse ${MCP_URL}`,
    note: "--scope user puts it in every project; drop it for this one only, or commit the server to a repo in .mcp.json",
  },
  {
    id: "cursor",
    name: "Cursor",
    where: "~/.cursor/mcp.json",
    code: `{
  "mcpServers": {
    "synapsse": { "url": "${MCP_URL}" }
  }
}`,
    note: "Or .cursor/mcp.json, to keep it to one project",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    where: "~/.gemini/settings.json",
    code: `{
  "mcpServers": {
    "synapsse": { "httpUrl": "${MCP_URL}" }
  }
}`,
    note: "The key is httpUrl — that is what Gemini CLI uses for HTTP servers",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    where: "~/.gemini/config/mcp_config.json",
    code: `{
  "mcpServers": {
    "synapsse": { "serverUrl": "${MCP_URL}" }
  }
}`,
    note: "In the IDE: Manage MCP Servers → View raw config. The key is serverUrl",
  },
] as const;

/*
 * The shortcut, for assistants that can edit their own configuration.
 *
 * Deliberately not one of the tabs above. Those name a client and a file, and
 * every one of them is true wherever you are; this is a request handed to
 * whatever you are talking to, and it only works if that thing can write to
 * your machine. Presenting it as the first tab implied it was the normal route
 * and left everyone else reading a paragraph aimed past them.
 *
 * Every instruction in it exists because leaving it out produced the wrong
 * setup in practice. Agents default to the narrowest MCP scope, so a memory
 * meant for every project lands in whichever folder the chat happened to start
 * in. Left to itself no agent installs the recall hook, because nothing in the
 * MCP handshake mentions one. And nothing tells the user why a freshly added
 * server appears broken until the client restarts.
 *
 * Deliberately names no client and quotes no command. Sitting under tabs that
 * each name one, a Claude Code flag in here read as though the paste only
 * worked there. What got the scope right was stating the requirement — every
 * project, widest scope available — not supplying the exact flag, and a
 * requirement is something any assistant can carry out in its own config.
 */
const SELF_SETUP_PROMPT = `Set up SYNAPSSE, my local memory graph, and use it from now on.

1. Add an MCP server named "synapsse" at ${MCP_URL} using streamable HTTP transport. Register it for every project rather than only the one we are in — use the widest scope your configuration offers.
2. If you support hooks that run on every message I send, make recall automatic: register hooks/synapsse_recall.py from the synapsse folder as one, alongside any hooks already configured rather than replacing them. Ask me where the folder is if you cannot find it.
3. Then tell me plainly what I have to do myself before either takes effect — the restart that attaches the MCP tools, and the reload that picks up the hook.`;

const TRIGGERS = [
  "You state a preference, or correct how it did something",
  "A decision is made, with a reason worth keeping",
  "It learns something durable about a person or client",
  "A problem is diagnosed — and again when something fixes it",
];

const EASE = [0.22, 1, 0.36, 1] as const;

/** The two-sheets copy glyph, and the tick that replaces it on success. */
function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {copied ? (
        <path d="M20 6 9 17l-5-5" />
      ) : (
        <>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )}
    </svg>
  );
}

function CopyBlock({ code, clamped = false }: { code: string; clamped?: boolean }) {
  const [copied, setCopied] = useState(false);
  // Only the long self-setup prompt asks to be clipped; the per-client
  // commands are one line and must never be, since a command you cannot read
  // whole is a command you cannot trust.
  const [open, setOpen] = useState(false);
  const clipped = clamped && !open;

  return (
    <div className="group/copy relative mt-2.5">
      <pre
        className={`overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-line/[.1] bg-canvas/40 py-3 pl-3.5 pr-11 font-mono text-xs leading-relaxed text-cyan ${
          clipped ? "max-h-[5.4em] overflow-y-hidden" : ""
        }`}
      >
        {code}
      </pre>
      {clipped && (
        // Fades the cut instead of slicing a line in half, so it reads as
        // "continues" rather than "ends badly".
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-px bottom-px h-10 rounded-b-lg bg-gradient-to-b from-transparent to-canvas"
        />
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        title={copied ? "Copied" : "Copy"}
        className={`absolute right-2 top-2 rounded-md p-1.5 transition ${
          copied
            ? "text-emerald-300"
            : "text-faint/70 hover:bg-elevated/10 hover:text-strong"
        }`}
      >
        <CopyIcon copied={copied} />
      </button>
    </div>
  );
}

function ConnectPanel() {
  const [active, setActive] = useState<string>(CLIENTS[0].id);
  const reduced = useReducedMotion();
  const client = CLIENTS.find((entry) => entry.id === active) ?? CLIENTS[0];

  return (
    <div className="mt-3.5 overflow-hidden rounded-xl border border-line/[.1] bg-elevated/[.03]">
      {/* A segmented control rather than four loose pills: one indicator that
          moves reads as a single choice, where four independent buttons
          lighting up read as four independent switches. */}
      <div
        role="tablist"
        aria-label="MCP client"
        className="flex flex-wrap gap-0.5 border-b border-line/[.08] p-1.5"
      >
        {CLIENTS.map((entry) => {
          const selected = entry.id === active;
          return (
            <button
              key={entry.id}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => setActive(entry.id)}
              className={`relative rounded-md px-3 py-1.5 text-xs transition-colors ${
                selected ? "text-strong" : "text-faint hover:text-muted"
              }`}
            >
              {selected && (
                <motion.span
                  layoutId="client-tab"
                  className="absolute inset-0 rounded-md border border-line/[.14] bg-elevated/[.12]"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 420, damping: 34 }
                  }
                />
              )}
              <span className="relative">{entry.name}</span>
            </button>
          );
        })}
      </div>

      <div className="p-3.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={client.id}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <p className="font-mono text-[11px] text-muted">{client.where}</p>
            <CopyBlock code={client.code} />
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              {client.note}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Not a tab. Those name a client and a config file and are true wherever
          you are; this is a request handed to whatever you happen to be talking
          to, and only works if that thing can write to your machine.

          The card stays open and only the text is clipped — collapsing the
          whole thing put the copy button behind a click, which is the one
          control anyone came here to press. */}
      <div className="border-t border-line/[.08] p-3.5">
        <p className="text-xs text-muted">
          Or just say it — hand the whole setup to the assistant
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          For any assistant that can edit its own configuration. One paste
          covers the server, the global scope and the recall hook. If yours
          cannot write to your machine, use a tab above.
        </p>
        <CopyBlock code={SELF_SETUP_PROMPT} clamped />
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pl-11">
      {/* Sits on the rail and hides the line behind it, so the marker reads as
          a station on the sequence rather than a badge floating over it. */}
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-violet/40 bg-raised font-mono text-[10px] text-violet">
        {n}
      </span>
      <h3 className="pt-1 text-sm font-medium text-strong">{title}</h3>
      {children}
    </li>
  );
}

/**
 * Covers every state before there is a graph to look at.
 *
 * An empty canvas with no explanation is the worst possible first run, so this
 * distinguishes "still loading" from "daemon unreachable" from "connected but
 * empty" — and in the last case walks through connecting an agent, which is
 * the only thing standing between here and a graph.
 */
export function StatusOverlay({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
}) {
  const reduced = useReducedMotion();
  const [token, setToken] = useState("");

  // A locked daemon is not an unreachable one, and telling someone to go start
  // a daemon that is already running wastes their afternoon.
  const locked = error === "This daemon needs a token";

  if (!loading && !error && !empty) return null;

  // One orchestrated entrance rather than several things arriving separately:
  // the panel settles, then its contents follow it in reading order.
  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.055, delayChildren: 0.05 } },
  };
  const item = reduced
    ? { hidden: {}, show: {} }
    : {
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
      };

  return (
    // pt clears the control bar: this panel is taller than the viewport on a
    // laptop, so it starts at the top rather than centred, and centring padding
    // alone would slide it under the navigation.
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-y-auto px-6 pb-10 pt-24 sm:px-10 sm:pb-14 sm:pt-28">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="glass-panel pointer-events-auto relative my-auto w-full max-w-2xl overflow-hidden rounded-2xl p-8 sm:p-10"
      >
        {/* A single wash of brand colour bleeding in from the top corner, so
            the panel has a light source instead of being a flat rectangle. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-32 h-64 w-64 rounded-full bg-violet/10 blur-3xl"
        />

        <motion.div variants={item} className="relative">
          <Logo size={52} />
        </motion.div>

        {loading && (
          <motion.p
            variants={item}
            className="relative mt-8 flex items-center gap-2 font-mono text-xs text-muted"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
            Loading the graph…
          </motion.p>
        )}

        {!loading && locked && (
          <div className="relative">
            <motion.p variants={item} className="mt-8 text-2xl text-strong">
              This memory is locked.
            </motion.p>
            <motion.p
              variants={item}
              className="mt-2.5 max-w-prose text-sm leading-relaxed text-muted"
            >
              The daemon was started with a token, so it will not answer
              without one. Paste it here — it is kept in this browser only.
            </motion.p>
            <motion.form
              variants={item}
              className="mt-5 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setAuthToken(token.trim());
                window.location.reload();
              }}
            >
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="SYNAPSSE_AUTH_TOKEN"
                aria-label="Access token"
                className="min-w-0 flex-1 rounded-lg border border-line/[.14] bg-elevated/10 px-3 py-2 font-mono text-xs text-strong placeholder:text-faint/60 focus:border-cyan/40 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-strong px-4 py-2 text-sm font-medium text-canvas transition hover:opacity-90"
              >
                Unlock
              </button>
            </motion.form>
          </div>
        )}

        {!loading && error && !locked && (
          <div className="relative">
            <motion.p variants={item} className="mt-8 text-2xl text-strong">
              Cannot reach the daemon.
            </motion.p>
            <motion.p
              variants={item}
              className="mt-2 font-mono text-[11px] text-faint"
            >
              {error}
            </motion.p>
            <motion.p
              variants={item}
              className="mt-3 text-sm leading-relaxed text-muted"
            >
              Start it with{" "}
              <code className="font-mono text-cyan">
                uv run uvicorn app.main:app
              </code>{" "}
              from <code className="font-mono text-muted">backend/</code>, or
              bring up the Docker stack.
            </motion.p>
            <motion.div variants={item}>
              <button
                type="button"
                onClick={onRetry}
                className="mt-5 rounded-lg border border-line/20 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-muted transition hover:border-cyan/40 hover:text-strong"
              >
                Retry
              </button>
            </motion.div>
          </div>
        )}

        {!loading && !error && empty && (
          <div className="relative">
            <motion.p
              variants={item}
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[.07] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300/90"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Daemon up · canvas connected
            </motion.p>

            <motion.h2
              variants={item}
              className="mt-4 text-[1.65rem] leading-tight tracking-tight text-strong"
            >
              Nothing to show yet.
            </motion.h2>

            <motion.p
              variants={item}
              className="mt-2.5 max-w-prose text-sm leading-relaxed text-muted"
            >
              The graph is empty because nothing has written to it. Point an
              agent at the daemon and it will keep what it learns as it works —
              memories appear here the moment they are written, with no refresh.
            </motion.p>

            <motion.ol variants={item} className="relative mt-9 space-y-9">
              {/* The rail. It fades out below the last marker rather than
                  stopping flat, because the sequence does not end at step two
                  — that is where the ordinary work begins. */}
              <span
                aria-hidden
                className="absolute bottom-4 left-[13px] top-4 w-px bg-gradient-to-b from-violet/45 via-violet/20 to-transparent"
              />

              <Step n="1" title="Connect your agent">
                <ConnectPanel />
              </Step>

              <Step n="2" title="Then just work">
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  You should not have to ask. The daemon tells every agent that
                  connects to record as it goes, and to search here before
                  asking you something you have already answered.
                </p>

                <ul className="mt-3.5 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                  {TRIGGERS.map((trigger) => (
                    <li
                      key={trigger}
                      className="flex gap-2.5 text-[11px] leading-relaxed text-muted"
                    >
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-violet/70" />
                      {trigger}
                    </li>
                  ))}
                </ul>

                <p className="mt-4 text-[11px] leading-relaxed text-faint">
                  You can still say “remember this” to be certain of something.
                  The point is not having to.
                </p>
              </Step>
            </motion.ol>
          </div>
        )}
      </motion.div>
    </div>
  );
}
