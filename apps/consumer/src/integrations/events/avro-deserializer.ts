import { UserError } from "@platformatic/kafka";
import avsc from "avsc";
import { fileLogger } from "../../runtime.ts";
import { getSubjectVersion, getSubjectVersions } from "./schema-registry.ts";

const logger = fileLogger(import.meta.url);

const MAGIC_BYTE = 0;
const WIRE_HEADER_BYTES = 5; // magic byte + int32 schema id

export async function createAvroDeserializer<T>(
	registryUrl: string,
	subjects: string[]
): Promise<(data?: Buffer) => T | undefined> {
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

	return function deserialize(data?: Buffer): T | undefined {
		if (!data?.length) return undefined;

		if (data.length < WIRE_HEADER_BYTES || data.readUInt8(0) !== MAGIC_BYTE) {
			throw new UserError(`Not Confluent wire format (${data.length} bytes)`);
		}

		const schemaId = data.readInt32BE(1);
		const type = types.get(schemaId);

		if (!type) {
			throw new UserError(
				`Unknown schema id ${schemaId}; primed: ${[...types.keys()].join(", ")}`
			);
		}

		return type.fromBuffer(data.subarray(WIRE_HEADER_BYTES)) as T;
	};
}
