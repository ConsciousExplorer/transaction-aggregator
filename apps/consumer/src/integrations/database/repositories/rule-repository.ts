import type { Pool } from "pg";
import z from "zod";
import type { RuleRow } from "#src/domain/categorisation/categoriser.ts";

const ruleSchema = z.object({
	categorization_rule_id: z.string(),
	version: z.number(),
	priority: z.number(),
	matcher_type: z.string(),
	pattern: z.string(),
	category_id: z.number()
});

const categorySchema = z.object({
	category_id: z.number()
});

export async function loadActiveRules(pool: Pool): Promise<RuleRow[]> {
	const { rows } = await pool.query<z.infer<typeof ruleSchema>>(
		`
		SELECT 	r.priority, r.matcher_type, r.pattern, r.category_id,
				r.ruleset_version
		FROM   	categorization_rules r
		WHERE  	r.ruleset_version = (SELECT max(version) FROM rule_sets)
		ORDER  	BY r.priority
		`
	);
	return rows.map(
		(r) =>
			({
				priority: r.priority,
				matcherType: r.matcher_type,
				pattern: r.pattern,
				categoryId: r.category_id
			}) as RuleRow
	);
}

export async function loadUncategorizedId(pool: Pool): Promise<number> {
	const { rows } = await pool.query<z.infer<typeof categorySchema>>(
		`
		SELECT 	category_id
		FROM 	categories
		WHERE 	name = $1
		`,
		["uncategorized"]
	);

	const category = rows[0];
	if (!category) {
		throw new Error('Category "uncategorized" not found in categories table');
	}

	return category.category_id;
}
