import { UserError } from "@platformatic/kafka";
import avsc from "avsc";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
import { createFileLogger } from "#src/logger.ts";
import { getSubjectVersion, getSubjectVersions } from "./schema-registry.ts";

const logger = createFileLogger(import.meta.url);

const MAGIC_BYTE = 0;
const WIRE_HEADER_BYTES = 5; // magic byte + int32 schema id

/** The bytes as they arrived travel with the decoded value, for the DLQ. */
export interface DecodedValue<T> {
	raw: Buffer;
	value: T;
}

function isConfluentFramed(payload: Buffer) {
	return (
		payload.length >= WIRE_HEADER_BYTES && payload.readUInt8(0) === MAGIC_BYTE
	);
}

export function deserialise<T>(types: Map<number, avsc.Type>, data?: Buffer) {
	if (!data?.length) return undefined;

	if (!isConfluentFramed(data)) {
		throw new UserError(`Not Confluent wire format (${data.length} bytes)`);
	}

	const schemaId = data.readInt32BE(1);
	const type = types.get(schemaId);

	if (!type) {
		throw new UnknownSchemaIdError(
			`Unknown schema id ${schemaId}; loaded: ${[...types.keys()].join(", ")}`
		);
	}

	return {
		raw: data,
		value: type.fromBuffer(data.subarray(WIRE_HEADER_BYTES)) as T
	};
}

/**
 * Loads every registered version of each subject, once, at startup. The
 * library's deserialisers are synchronous, so a schema cannot be fetched while
 * a message is being read: an id that is not here stops the consumer, and the
 * restart loads it.
 */
export async function createAvroDeserialiser<T>(
	registryUrl: string,
	subjects: string[]
) {
	const types = new Map<number, avsc.Type>();

	for (const subject of subjects) {
		const versions = await getSubjectVersions(registryUrl, subject);
		for (const version of versions) {
			const { id, schema } = await getSubjectVersion(
				registryUrl,
				subject,
				version
			);
			types.set(id, avsc.Type.forSchema(JSON.parse(schema)));
		}
	}

	logger.info(
		{ subjects, schemaIds: [...types.keys()] },
		`Loaded ${types.size} Avro schema(s)`
	);

	return function deserialiseValue(data?: Buffer) {
		return deserialise<T>(types, data);
	};
}
