export interface ConversationMessage {
  role: "user" | "ed";
  content: string;
  timestamp: number;
}

let log: ConversationMessage[] = [];

export function getConversationLog(): ConversationMessage[] {
  return log;
}

export function appendConversationMessage(msg: ConversationMessage): void {
  log.push(msg);
  log.sort((a, b) => a.timestamp - b.timestamp);
}

export function clearConversationLog(): void {
  log = [];
}
