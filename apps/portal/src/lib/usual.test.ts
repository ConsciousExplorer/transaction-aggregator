import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUsualDeltas, describeUsualDelta, isUsualShown } from "./usual.ts";

// Intl separates groups with non-breaking spaces; compare with ordinary ones
function normaliseSpaces(text: string) {
	return text.replace(/\s/g, " ");
}

// Only money out counts towards the usual month; the other figures are filler
function buildMoneyOutFigures(moneyOutMinor: number) {
	return { moneyInMinor: 0, moneyOutMinor, count: 1, moneyOutCount: 1 };
}

test("only a category above its usual month gets a delta", () => {
	const periodFigures = {
		// 17863 over 3 months is 5954 a month, the same as 71452 over 12
		transport: buildMoneyOutFigures(17863),
		// 30000 over 3 months is 10000 a month, 4046 above 5954
		groceries: buildMoneyOutFigures(30000),
		// 6000 over 3 months is 2000 a month, under the usual 5954
		retail: buildMoneyOutFigures(6000)
	};
	const yearFigures = {
		transport: buildMoneyOutFigures(71452),
		groceries: buildMoneyOutFigures(71452),
		retail: buildMoneyOutFigures(71452)
	};
	assert.deepEqual(buildUsualDeltas(periodFigures, yearFigures, 3), {
		groceries: 4046
	});
});

test("a rise under one rand is left out, since whole rand would print it as R 0 or R 1", () => {
	// Over 1 month, against 120000 over the year, the usual month is 10000
	const periodFigures = {
		// 99 above the usual
		groceries: buildMoneyOutFigures(10099),
		// 100 above the usual
		dining: buildMoneyOutFigures(10100)
	};
	const yearFigures = {
		groceries: buildMoneyOutFigures(120000),
		dining: buildMoneyOutFigures(120000)
	};
	assert.deepEqual(buildUsualDeltas(periodFigures, yearFigures, 1), {
		dining: 100
	});
});

test("a category missing from the year's figures has a usual month of 0", () => {
	const periodFigures = { fitness: buildMoneyOutFigures(30000) };
	assert.deepEqual(buildUsualDeltas(periodFigures, {}, 3), { fitness: 10000 });
});

test("the usual month is shown only over a shorter period with no bucket picked", () => {
	const cases = [
		{ months: 12, selectedBucket: undefined, expected: false },
		{ months: 1, selectedBucket: "2026-10", expected: false },
		{ months: 3, selectedBucket: "2026-W33", expected: false },
		{ months: 1, selectedBucket: undefined, expected: true },
		{ months: 3, selectedBucket: undefined, expected: true }
	];
	for (const shownCase of cases) {
		assert.equal(
			isUsualShown(shownCase.months, shownCase.selectedBucket),
			shownCase.expected,
			`${shownCase.months} months, bucket ${shownCase.selectedBucket}`
		);
	}
});

test("a delta reads in whole rand after an ASCII plus", () => {
	assert.equal(
		normaliseSpaces(describeUsualDelta(621000, "ZAR")),
		"+R 6 210 vs your usual month"
	);
});
