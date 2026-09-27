import { relations } from "drizzle-orm/relations";
import { transactions, userTransactionOverrides } from "./partitioned.ts";
import {
	categories,
	categorizationRules,
	ruleSets,
	userCategoryOverrides
} from "./schema.ts";

export const categorizationRulesRelations = relations(
	categorizationRules,
	({ one, many }) => ({
		category: one(categories, {
			fields: [categorizationRules.categoryId],
			references: [categories.categoryId]
		}),
		ruleSet: one(ruleSets, {
			fields: [categorizationRules.rulesetVersion],
			references: [ruleSets.version]
		}),
		transactions: many(transactions)
	})
);

export const categoriesRelations = relations(categories, ({ many }) => ({
	categorizationRules: many(categorizationRules),
	userCategoryOverrides_fromCategoryId: many(userCategoryOverrides, {
		relationName: "userCategoryOverrides_fromCategoryId_categories_categoryId"
	}),
	userCategoryOverrides_toCategoryId: many(userCategoryOverrides, {
		relationName: "userCategoryOverrides_toCategoryId_categories_categoryId"
	}),
	transactions: many(transactions),
	userTransactionOverrides: many(userTransactionOverrides)
}));

export const ruleSetsRelations = relations(ruleSets, ({ many }) => ({
	categorizationRules: many(categorizationRules),
	transactions: many(transactions)
}));

export const userCategoryOverridesRelations = relations(
	userCategoryOverrides,
	({ one }) => ({
		category_fromCategoryId: one(categories, {
			fields: [userCategoryOverrides.fromCategoryId],
			references: [categories.categoryId],
			relationName: "userCategoryOverrides_fromCategoryId_categories_categoryId"
		}),
		category_toCategoryId: one(categories, {
			fields: [userCategoryOverrides.toCategoryId],
			references: [categories.categoryId],
			relationName: "userCategoryOverrides_toCategoryId_categories_categoryId"
		})
	})
);

export const transactionsRelations = relations(transactions, ({ one }) => ({
	category: one(categories, {
		fields: [transactions.categoryId],
		references: [categories.categoryId]
	}),
	ruleSet: one(ruleSets, {
		fields: [transactions.ruleVersion],
		references: [ruleSets.version]
	}),
	categorizationRule: one(categorizationRules, {
		fields: [transactions.ruleVersion],
		references: [categorizationRules.rulesetVersion]
	})
}));

export const userTransactionOverridesRelations = relations(
	userTransactionOverrides,
	({ one }) => ({
		category: one(categories, {
			fields: [userTransactionOverrides.categoryId],
			references: [categories.categoryId]
		})
	})
);
