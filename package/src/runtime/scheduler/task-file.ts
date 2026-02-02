import type { TaskDefinition } from "./types.js";

export function parseTaskFile(id: string, content: string): TaskDefinition | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    return { id, name: id, cron: "0 9 * * *", enabled: true };
  }

  try {
    const frontmatter = frontmatterMatch[1];
    const metadata: Record<string, string> = {};

    for (const line of frontmatter.split("\n")) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) metadata[match[1]] = match[2].trim();
    }

    return {
      id: metadata["id"] || id,
      name: metadata["name"] || id,
      cron: metadata["cron"] || "0 9 * * *",
      notify: metadata["notify"],
      source:
        metadata["source"] === "telegram"
          ? "telegram"
          : metadata["source"] === "feishu"
            ? "feishu"
            : undefined,
      chatId: metadata["chatId"] || metadata["chat_id"],
      description: content.replace(/^---\n[\s\S]*?\n---/, "").trim(),
      enabled: metadata["enabled"] !== "false",
    };
  } catch {
    return null;
  }
}

