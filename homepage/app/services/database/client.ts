// 重新导出 DatabaseManager 的数据库实例
// 这样可以保持向后兼容性，现有代码无需修改
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/postgres";
const client = postgres(databaseUrl);
const db = drizzle(client, { schema });

// 导出默认数据库实例
export { db };
