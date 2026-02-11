/**
 * Infra CLI 输出工具。
 *
 * 关键点（中文）
 * - 统一支持 JSON / 文本输出
 * - 保持 shell 调用与 AI 调用都可稳定解析
 */

export function printResult(params: {
  asJson?: boolean;
  success: boolean;
  title: string;
  payload: Record<string, unknown>;
}): void {
  const asJson = params.asJson !== false;
  const payload = {
    success: params.success,
    ...params.payload,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(params.success ? `✅ ${params.title}` : `❌ ${params.title}`);
  for (const [key, value] of Object.entries(payload)) {
    if (key === "success") continue;
    console.log(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
}

