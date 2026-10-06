import {
	type Span,
	type SpanOptions,
	SpanStatusCode,
	trace
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchSpanProcessor,
	NodeTracerProvider
} from "@opentelemetry/sdk-trace-node";

/**
 * Disabled (OTEL_SDK_DISABLED=true, the default outside the obs profile):
 * register nothing, so getTracer() hands out no-op spans and the hot path stays
 * clean. Enabled: export over OTLP/HTTP to the collector; the exporter and
 * sampler read OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_TRACES_SAMPLER themselves.
 */
export function startTracing(options: {
	enabled: boolean;
	serviceName: string;
}): NodeTracerProvider | undefined {
	if (!options.enabled) return undefined;

	const provider = new NodeTracerProvider({
		resource: resourceFromAttributes({ "service.name": options.serviceName }),
		spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())]
	});
	provider.register();

	return provider;
}

export const getTracer = () => trace.getTracer("consumer");

/**
 * Runs `work` inside a new span and makes it the active span, so spans
 * started inside become its children. A failure is recorded on the span and
 * rethrown unchanged.
 */
export function runInSpan<T>(
	name: string,
	options: SpanOptions,
	work: (span: Span) => T | Promise<T>
): Promise<T> {
	return getTracer().startActiveSpan(name, options, async (span) => {
		try {
			return await work(span);
		} catch (error) {
			span.recordException(error instanceof Error ? error : String(error));
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw error;
		} finally {
			span.end();
		}
	});
}
