/**
 * JSON 通用类型定义。
 *
 * 关键点（中文）
 * - 用于约束跨模块传递的可序列化数据结构。
 * - 避免在业务代码中使用宽泛断言，统一采用明确 JSON 类型。
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

