import { readFileSync, writeFileSync } from "fs";

export type ThreadStatus = "active" | "waiting" | "blocked" | "done";

export interface ThreadMessage {
  role: "user" | "ed";
  content: string;
  timestamp: number;
}

export interface Thread {
  id: string;
  name: string;
  status: ThreadStatus;
  category: string;
  summary: string;
  history: ThreadMessage[];
  lastActivity: number;
  metadata?: Record<string, unknown>;
}

const THREADS_FILE = "/tmp/ed-threads.json";

const SEED_THREADS: Thread[] = [
  {
    id: "blog-tds-submission",
    name: "Blog TDS Submission",
    status: "waiting",
    category: "publishing",
    summary: "Draft ready. Pending opening paragraph choice (A or B). Cover note finalized.",
    history: [],
    lastActivity: Date.now() - 1000 * 60 * 30,
  },
  {
    id: "ed-mini-hackathon",
    name: "Ed Mini Hackathon",
    status: "active",
    category: "engineering",
    summary: "Voice agent deployed on Vercel. ThreadManager being built. Ship to Prod hackathon tomorrow.",
    history: [],
    lastActivity: Date.now() - 1000 * 60 * 5,
  },
  {
    id: "product-launch-planning",
    name: "Product Launch Planning",
    status: "waiting",
    category: "planning",
    summary: "Q3 product launch meeting scheduled for next week. Need to finalize feature list, prepare demo, and send stakeholder invites. Waiting on design team for final mockups.",
    history: [],
    lastActivity: Date.now() - 1000 * 60 * 60 * 2,
  },
];

let threads: Thread[] = [];
let initialized = false;

function load() {
  if (initialized) return;
  initialized = true;
  try {
    const data = readFileSync(THREADS_FILE, "utf-8");
    threads = JSON.parse(data) as Thread[];
  } catch {
    threads = SEED_THREADS.map((t) => ({ ...t }));
    save();
  }
}

function save() {
  try {
    writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2));
  } catch {
    // /tmp may not be available in all environments — in-memory fallback is fine
  }
}

export function getThreads(): Thread[] {
  load();
  return threads;
}

export function getThread(id: string): Thread | undefined {
  load();
  return threads.find((t) => t.id === id);
}

export function createThread(partial: Omit<Thread, "id" | "history" | "lastActivity"> & { id?: string }): Thread {
  load();
  const thread: Thread = {
    id: partial.id ?? `thread-${Date.now()}`,
    name: partial.name,
    status: partial.status,
    category: partial.category,
    summary: partial.summary,
    history: [],
    lastActivity: Date.now(),
    metadata: partial.metadata,
  };
  threads.push(thread);
  save();
  return thread;
}

export function updateThread(id: string, updates: Partial<Omit<Thread, "id" | "history">>): Thread | null {
  load();
  const idx = threads.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  threads[idx] = { ...threads[idx], ...updates, lastActivity: Date.now() };
  save();
  return threads[idx];
}

export function addMessage(id: string, role: "user" | "ed", content: string): Thread | null {
  load();
  const idx = threads.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  threads[idx].history.push({ role, content, timestamp: Date.now() });
  threads[idx].lastActivity = Date.now();
  save();
  return threads[idx];
}

export function getSystemPromptContext(): string {
  load();
  const lines = threads.map((t) => {
    const recent = t.history.slice(-3).map((m) => `  ${m.role}: ${m.content}`).join("\n");
    return [
      `[${t.id}] ${t.name} (${t.status}) — ${t.summary}`,
      recent ? `  Recent:\n${recent}` : "",
    ].filter(Boolean).join("\n");
  });
  return lines.join("\n\n");
}
