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

const SEED_TOPICS: Topic[] = [
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
    summary: "Voice agent deployed on Vercel. TopicManager being built. Ship to Prod hackathon tomorrow.",
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
  {
    id: "general",
    name: "General",
    status: "active",
    category: "engineering",
    summary: "General conversations and unclassified messages.",
    history: [],
    lastActivity: Date.now() - 1000 * 60 * 60 * 24,
  },
];

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
