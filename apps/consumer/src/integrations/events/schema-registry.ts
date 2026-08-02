// Native schema registry

export async function fetchSchema(schemaId: number): Promise<void> {
	const response = await fetch(`${registryUrl}/schemas/ids/${schemaId}`);

	if (!response.ok) {
		throw new UserError(`Failed to fetch schema: [HTTP ${response.status}]`, {
			cause: await response.json()
		});
	}

	const schemaData = await response.json();

	debug("RECEIVED SCHEMA", schemaId);
	localSchemas[schemaId] = avro.Type.forSchema(JSON.parse(schemaData.schema));
}
