import type { Logger as DrizzleLogger } from "drizzle-orm";
import type { Pool } from "pg";
import type { Logger } from "pino";

export type QueryLogMode = "sql" | "plan";

// TODO: review this logger

/**
 * Logs every statement drizzle sends, with its values filled in so it can be
 * pasted into psql or DBeaver as it stands. In plan mode the entry also holds
 * the statement's plan: EXPLAIN (ANALYZE, BUFFERS) for a read, which runs the
 * read a second time, and plain EXPLAIN for a write, which does not run it.
 */
export class QueryPlanLogger implements DrizzleLogger {
	pool: Pool;
	logger: Logger;
	mode: QueryLogMode;

	constructor(pool: Pool, logger: Logger, mode: QueryLogMode) {
		this.pool = pool;
		this.logger = logger;
		this.mode = mode;
	}

	logQuery(query: string, params: unknown[]): void {
		if (this.mode === "plan") {
			void this.logPlan(query, params);
			return;
		}

		this.logger.info({ params }, `${inlineParams(query, params)};`);
	}

	async logPlan(query: string, params: unknown[]): Promise<void> {
		const statement = `${inlineParams(query, params)};`;
		const explainStatement = toExplainStatement(query);

		if (explainStatement === undefined) {
			this.logger.info({ params }, statement);
			return;
		}

		try {
			// Straight to the pool: sent through drizzle, the EXPLAIN would be logged too
			const result = await this.pool.query<{ "QUERY PLAN": string }>(
				explainStatement,
				params
			);

			const planLines: string[] = [];
			for (const row of result.rows) {
				planLines.push(row["QUERY PLAN"]);
			}

			this.logger.info({ params }, `${statement}\n\n${planLines.join("\n")}`);
		} catch (err) {
			this.logger.warn(
				{ err, params },
				`${statement}\n\nNo plan: the EXPLAIN failed.`
			);
		}
	}
}

/**
 * The query with each $n replaced by its value as a SQL literal. One pass, so
 * a value that itself contains "$1" is left as it is.
 */
export function inlineParams(query: string, params: unknown[]): string {
	return query.replace(/\$(\d+)/g, (_placeholder, position: string) =>
		toSqlLiteral(params[Number(position) - 1])
	);
}

function toSqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" || typeof value === "bigint") {
		return String(value);
	}
	if (value instanceof Date) return quote(value.toISOString());
	if (typeof value === "object") return quote(JSON.stringify(value));
	return quote(String(value));
}

function quote(text: string): string {
	return `'${text.replaceAll("'", "''")}'`;
}

/**
 * The EXPLAIN for a statement, or undefined when it has no plan (begin,
 * commit, savepoint and the like). A read gets ANALYZE, which runs it; a write
 * gets plain EXPLAIN, so it is never run a second time. A with-query may hide a
 * write, so it is only planned too.
 */
export function toExplainStatement(query: string): string | undefined {
	if (/^select\b/i.test(query)) return `EXPLAIN (ANALYZE, BUFFERS) ${query}`;
	if (/^(insert|update|delete|with)\b/i.test(query)) return `EXPLAIN ${query}`;
	return undefined;
}
