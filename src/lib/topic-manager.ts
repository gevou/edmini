import { readFileSync, writeFileSync } from "fs";

export type TopicStatus = "active" | "waiting" | "blocked" | "done";

export interface TopicMessage {
  role: "user" | "ed";
  content: string;
  timestamp: number;
}

export interface Topic {
  id: string;
  name: string;
  status: TopicStatus;
  category: string;
  summary: string;
  history: TopicMessage[];
  lastActivity: number;
  metadata?: Record<string, unknown>;
}

const TOPICS_FILE = "/tmp/ed-topics.json";

// No seed topics. The bus (Hermes/Discord) is live, so Ed's context comes from real runs/threads
// (the ledger — see edmini-iee) rather than mock projects. Topics are created on demand; an empty
// list means classifyTopic returns "general" (the hardcoded fallback) and nothing fake is surfaced.
const SEED_TOPICS: Topic[] = [];

let topics: Topic[] = [];
let initialized = false;

function load() {
  if (initialized) return;
  initialized = true;
  try {
    const data = readFileSync(TOPICS_FILE, "utf-8");
    topics = JSON.parse(data) as Topic[];
  } catch {
    topics = SEED_TOPICS.map((t) => ({ ...t }));
    save();
  }
}

function save() {
  try {
    writeFileSync(TOPICS_FILE, JSON.stringify(topics, null, 2));
  } catch {
    // /tmp may not be available in all environments — in-memory fallback is fine
  }
}

export function getTopics(): Topic[] {
  load();
  return topics;
}

export function getTopic(id: string): Topic | undefined {
  load();
  return topics.find((t) => t.id === id);
}

export function createTopic(partial: Omit<Topic, "id" | "history" | "lastActivity"> & { id?: string }): Topic {
  load();
  const topic: Topic = {
    id: partial.id ?? `topic-${Date.now()}`,
    name: partial.name,
    status: partial.status,
    category: partial.category,
    summary: partial.summary,
    history: [],
    lastActivity: Date.now(),
    metadata: partial.metadata,
  };
  topics.push(topic);
  save();
  return topic;
}

export function updateTopic(id: string, updates: Partial<Omit<Topic, "id" | "history">>): Topic | null {
  load();
  const idx = topics.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  topics[idx] = { ...topics[idx], ...updates, lastActivity: Date.now() };
  save();
  return topics[idx];
}

export function addMessage(id: string, role: "user" | "ed", content: string): Topic | null {
  load();
  const idx = topics.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  topics[idx].history.push({ role, content, timestamp: Date.now() });
  topics[idx].lastActivity = Date.now();
  save();
  return topics[idx];
}

export function resetTopics(): void {
  topics = SEED_TOPICS.map((t) => ({ ...t }));
  save();
}

export function getSystemPromptContext(): string {
  load();
  const lines = topics.map((t) => {
    const recent = t.history.slice(-3).map((m) => `  ${m.role}: ${m.content}`).join("\n");
    return [
      `[${t.id}] ${t.name} (${t.status}) — ${t.summary}`,
      recent ? `  Recent:\n${recent}` : "",
    ].filter(Boolean).join("\n");
  });
  return lines.join("\n\n");
}
