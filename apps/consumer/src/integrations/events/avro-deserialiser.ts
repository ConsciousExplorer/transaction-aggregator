import { type BeforeHookPayloadType, UserError } from "@platformatic/kafka";
import avsc from "avsc";
import { createFileLogger } from "#src/logger.ts";
import {
	getSchemaById,
	getSubjectVersion,
	getSubjectVersions
} from "./schema-registry.ts";

const logger = createFileLogger(import.meta.url);

const MAGIC_BYTE = 0;
const WIRE_HEADER_BYTES = 5; // magic byte + int32 schema id

export type FetchSchemaText = (schemaId: number) => Promise<string>;

export type FetchOnMiss = (
	payload: Buffer | null,
	type: BeforeHookPayloadType
) => Promise<void>;

/** The bytes as they arrived travel with the decoded value, for the DLQ. */
export interface DecodedValue<T> {
	raw: Buffer;
	value: T;
}

export interface AvroDeserialiser<T> {
	deserialise: (data?: Buffer) => DecodedValue<T> | undefined;
	fetchOnMiss: FetchOnMiss;
}

function isConfluentFramed(payload: Buffer): boolean {
	return (
		payload.length >= WIRE_HEADER_BYTES && payload.readUInt8(0) === MAGIC_BYTE
	);
}

/**
 * Runs before each message is deserialised (the library's deserialisers are
 * synchronous, so the registry read has to happen here). A schema id the boot
 * priming did not see is read from the registry and kept. A failed read
 * propagates to the deserialisation error handler.
 */
export function createFetchOnMiss(
	types: Map<number, avsc.Type>,
	fetchSchemaText: FetchSchemaText
): FetchOnMiss {
	return async function fetchOnMiss(payload, type) {
		if (type !== "value" || payload === null || !isConfluentFramed(payload)) {
			return;
		}

		const schemaId = payload.readInt32BE(1);
		if (types.has(schemaId)) return;

		const schema = await fetchSchemaText(schemaId);
		types.set(schemaId, avsc.Type.forSchema(JSON.parse(schema)));
		logger.info({ schemaId }, "Loaded Avro schema on first use");
	};
}

export function deserialise<T>(
	types: Map<number, avsc.Type>,
	data?: Buffer
): DecodedValue<T> | undefined {
	if (!data?.length) return undefined;

	if (!isConfluentFramed(data)) {
		throw new UserError(`Not Confluent wire format (${data.length} bytes)`);
	}

	const schemaId = data.readInt32BE(1);
	const type = types.get(schemaId);

	if (!type) {
		throw new UserError(
			`Unknown schema id ${schemaId}; loaded: ${[...types.keys()].join(", ")}`
		);
	}

	return {
		raw: data,
		value: type.fromBuffer(data.subarray(WIRE_HEADER_BYTES)) as T
	};
}

export async function createAvroDeserialiser<T>(
	registryUrl: string,
	subjects: string[]
): Promise<AvroDeserialiser<T>> {
	const types = new Map<number, avsc.Type>();

	await Promise.all(
		subjects.map(async (subject) => {
			const versions = await getSubjectVersions(registryUrl, subject);
			await Promise.all(
				versions.map(async (version) => {
					const { id, schema } = await getSubjectVersion(
						registryUrl,
						subject,
						version
					);
					types.set(id, avsc.Type.forSchema(JSON.parse(schema)));
				})
			);
		})
	);

	logger.info(
		{ subjects, schemaIds: [...types.keys()] },
		`Loaded ${types.size} Avro schema(s)`
	);

	async function fetchSchemaText(schemaId: number) {
		const { schema } = await getSchemaById(registryUrl, schemaId);
		return schema;
	}

	return {
		deserialise: (data?: Buffer) => deserialise<T>(types, data),
		fetchOnMiss: createFetchOnMiss(types, fetchSchemaText)
	};
}
