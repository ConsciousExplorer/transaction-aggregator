import { useId, useState } from "react";
import { convertRandToMinor, readRandAmount } from "@/lib/amounts.ts";

type AmountRangeProblem = "unreadable" | "reversed";

type AmountRangeReading =
	| { isValid: true; amountMin: string; amountMax: string }
	| { isValid: false; problem: AmountRangeProblem };

const PROBLEM_MESSAGES: Record<AmountRangeProblem, string> = {
	unreadable: "Enter an amount in rand, like 250 or 99,50",
	reversed: "The from amount must not be more than the to amount"
};

// An empty box is no bound; anything else has to read as rand, and comes back without its spaces
function readAmountBound(value: string) {
	if (value.trim() === "") return "";
	return readRandAmount(value);
}

// Both bounds cleaned, or why they cannot be applied: a box that does not read as rand, or a
// from amount above the to amount, which no transaction could match. An empty bound is open,
// so it is never above or below the other.
function readAmountRange(
	amountMin: string,
	amountMax: string
): AmountRangeReading {
	const cleanedMin = readAmountBound(amountMin);
	const cleanedMax = readAmountBound(amountMax);
	if (cleanedMin === undefined || cleanedMax === undefined)
		return { isValid: false, problem: "unreadable" };
	const hasBothBounds = cleanedMin !== "" && cleanedMax !== "";
	if (
		hasBothBounds &&
		convertRandToMinor(cleanedMin) > convertRandToMinor(cleanedMax)
	)
		return { isValid: false, problem: "reversed" };
	return { isValid: true, amountMin: cleanedMin, amountMax: cleanedMax };
}

type AmountFieldProps = {
	label: string;
	accessibleName?: string;
	value: string;
	isInvalid: boolean;
	messageId: string;
	onChange: (value: string) => void;
};

// A box that does not read as rand is marked invalid and points at the message that says why.
// A short visible label that does not name the box on its own takes a fuller accessible name.
function AmountField({
	label,
	accessibleName,
	value,
	isInvalid,
	messageId,
	onChange
}: AmountFieldProps) {
	return (
		<label className="pill-input">
			<span className="pill-input-label">{label}</span>
			<input
				className="input"
				inputMode="decimal"
				placeholder="R"
				value={value}
				aria-label={accessibleName}
				aria-invalid={isInvalid}
				aria-describedby={isInvalid ? messageId : undefined}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	);
}

// The amount filter: two boxes and Apply. A value that does not read as rand, or a from amount
// above the to amount, shows a message and goes nowhere. The boxes start from the URL's values,
// and the view keys the form on the URL, so a new URL replaces whatever was typed.
export function AmountRangeForm({
	initialMin,
	initialMax,
	onApply
}: {
	initialMin: string;
	initialMax: string;
	onApply: (amountMin: string, amountMax: string) => void;
}) {
	const messageId = useId();
	const [amountMin, setAmountMin] = useState(initialMin);
	const [amountMax, setAmountMax] = useState(initialMax);
	// The last submit's problem picks the message, which shows while there is one. The message
	// is keyed on the count of invalid submits, so each new one puts a fresh alert in the page
	// and a screen reader reads it again.
	const [problem, setProblem] = useState<AmountRangeProblem | undefined>(
		undefined
	);
	const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);

	// A reversed range marks both boxes; otherwise a box is marked when it does not read as rand
	const isShowingMessage = problem !== undefined;
	const isRangeReversed = problem === "reversed";
	const isMinInvalid =
		isRangeReversed ||
		(isShowingMessage && readAmountBound(amountMin) === undefined);
	const isMaxInvalid =
		isRangeReversed ||
		(isShowingMessage && readAmountBound(amountMax) === undefined);

	return (
		<form
			className="amount-range"
			onSubmit={(event) => {
				event.preventDefault();
				const range = readAmountRange(amountMin, amountMax);
				if (!range.isValid) {
					setProblem(range.problem);
					setInvalidSubmitCount((count) => count + 1);
					return;
				}
				setProblem(undefined);
				onApply(range.amountMin, range.amountMax);
			}}
		>
			<AmountField
				label="Amount from"
				value={amountMin}
				isInvalid={isMinInvalid}
				messageId={messageId}
				onChange={setAmountMin}
			/>
			<AmountField
				label="to"
				accessibleName="Amount to"
				value={amountMax}
				isInvalid={isMaxInvalid}
				messageId={messageId}
				onChange={setAmountMax}
			/>
			<button type="submit" className="button">
				Apply
			</button>
			{isShowingMessage ? (
				<p
					key={invalidSubmitCount}
					id={messageId}
					className="amount-range-message"
					role="alert"
				>
					{PROBLEM_MESSAGES[problem]}
				</p>
			) : null}
		</form>
	);
}
