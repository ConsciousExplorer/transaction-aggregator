import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { buildExplainStatement, inlineParameters } from "./query-logger.ts";

suite("inlineParameters", () => {
	test("fills each placeholder with its own value, $10 not read as $1", () => {
		const params = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

		assert.equal(
			inlineParameters("select $1, $10, $2", params),
			"select 'a', 'j', 'b'"
		);
	});

	test("writes numbers bare and null as NULL", () => {
		assert.equal(
			inlineParameters("limit $1 offset $2 where x = $3", [51, 0, null]),
			"limit 51 offset 0 where x = NULL"
		);
	});

	test("doubles quotes inside a string", () => {
		assert.equal(
			inlineParameters("where reference = $1", ["the tenant's rent"]),
			"where reference = 'the tenant''s rent'"
		);
	});

	test("leaves a value that contains $1 as it is", () => {
		assert.equal(
			inlineParameters("where a = $1 and b = $2", ["costs $1", "x"]),
			"where a = 'costs $1' and b = 'x'"
		);
	});
});

suite("buildExplainStatement", () => {
	test("a read is explained with ANALYZE, which runs it", () => {
		assert.equal(
			buildExplainStatement("select 1"),
			"EXPLAIN (ANALYZE, BUFFERS) select 1"
		);
	});

	test("a write is only planned, so it is not run a second time", () => {
		assert.equal(
			buildExplainStatement("insert into t values (1)"),
			"EXPLAIN insert into t values (1)"
		);
		assert.equal(
			buildExplainStatement("update t set a = 1"),
			"EXPLAIN update t set a = 1"
		);
		assert.equal(
			buildExplainStatement("delete from t"),
			"EXPLAIN delete from t"
		);
		assert.equal(
			buildExplainStatement("with x as (delete from t returning 1) select 1"),
			"EXPLAIN with x as (delete from t returning 1) select 1"
		);
	});

	test("transaction control has no plan", () => {
		assert.equal(buildExplainStatement("begin"), undefined);
		assert.equal(buildExplainStatement("commit"), undefined);
		assert.equal(buildExplainStatement("rollback"), undefined);
		assert.equal(buildExplainStatement("savepoint sp1"), undefined);
	});
});
