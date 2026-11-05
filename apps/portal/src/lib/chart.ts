const STEP_MULTIPLIERS = [1, 2, 2.5, 5];

// The smallest round step (1, 2, 2.5 or 5 times a power of ten) that reaches the maximum in
// at most `count` steps
function chooseAxisStep(maximum: number, count: number) {
	for (let power = 1; ; power *= 10) {
		for (const multiplier of STEP_MULTIPLIERS) {
			const step = multiplier * power;
			if (Math.ceil(maximum / step) <= count) return step;
		}
	}
}

// Tick values from zero up to the first multiple of the step at or above the maximum
export function chooseAxisTicks(maximum: number, count: number) {
	const ticks = [0];
	if (maximum <= 0) return ticks;
	const step = chooseAxisStep(maximum, count);
	const stepCount = Math.ceil(maximum / step);
	for (let index = 1; index <= stepCount; index++) {
		ticks.push(index * step);
	}
	return ticks;
}

// An axis for money in above zero and money out below it, with one step on both sides so the
// gridlines line up. Each side is rounded up to a whole number of steps.
export function buildSignedAxis(maxInMinor: number, maxOutMinor: number) {
	const larger = Math.max(maxInMinor, maxOutMinor);
	const sideTicks = chooseAxisTicks(larger, 2);
	const step = sideTicks[1] ?? 1;
	const top = Math.ceil(maxInMinor / step) * step;
	// Subtracting from zero keeps an empty side at 0 rather than -0
	const bottom = 0 - Math.ceil(maxOutMinor / step) * step;
	const ticks = [];
	for (let tick = bottom; tick <= top; tick += step) {
		ticks.push(tick);
	}
	return { step, top, bottom, ticks };
}
