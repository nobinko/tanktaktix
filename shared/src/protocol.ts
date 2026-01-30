export type ServerMessageType = "welcome" | "echo";

export interface ServerMessage {
  type: ServerMessageType;
  message: string;
}

export const serverMessageTypes: ReadonlySet<ServerMessageType> = new Set(["welcome", "echo"]);

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    serverMessageTypes.has(record.type as ServerMessageType) &&
    typeof record.message === "string"
  );
}

export function parseServerMessage(payload: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return isServerMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function formatServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
