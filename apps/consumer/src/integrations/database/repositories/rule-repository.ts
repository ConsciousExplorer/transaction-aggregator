import type { Pool } from "pg";
import z from "zod";
import type { Rule } from "#src/domain/categorisation/rule-categorizer.ts";

const ruleSchema = z.object({
	categorization_rule_id: z.string(),
	ruleset_version: z.number(),
	priority: z.number(),
	matcher_type: z.string(),
	pattern: z.string(),
	category_id: z.number()
});

const categorySchema = z.object({
	category_id: z.number()
});

export async function loadActiveRules(pool: Pool): Promise<Rule[]> {
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
				categoryId: r.category_id,
				version: r.ruleset_version
			}) as Rule
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
