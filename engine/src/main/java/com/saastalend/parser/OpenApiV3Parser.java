package com.saastalend.parser;

import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.model.FieldInfo;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public class OpenApiV3Parser {

    /**
     * Parses an OpenAPI 3.x spec and returns a list of discovered GET list endpoints.
     */
    @SuppressWarnings("rawtypes")
    public List<DiscoveredEndpoint> parse(OpenAPI openAPI) {
        List<DiscoveredEndpoint> endpoints = new ArrayList<>();

        if (openAPI == null || openAPI.getPaths() == null) {
            return endpoints;
        }

        for (Map.Entry<String, PathItem> pathEntry : openAPI.getPaths().entrySet()) {
            String path = pathEntry.getKey();
            PathItem pathItem = pathEntry.getValue();

            Operation getOp = pathItem.getGet();
            if (getOp == null) {
                continue;
            }

            if (!EndpointFilter.isListEndpoint(path, "GET")) {
                continue;
            }

            String streamName = EndpointFilter.deriveStreamName(path);
            String description = getOp.getSummary();
            if (description == null) {
                description = getOp.getDescription();
            }

            // Detect pagination
            List<Parameter> queryParams = getOp.getParameters() != null
                    ? getOp.getParameters().stream()
                    .filter(p -> p != null && "query".equals(p.getIn()))
                    .collect(Collectors.toList())
                    : new ArrayList<>();

            Map<String, String> pagination = PaginationDetector.detect(queryParams);

            // Get response schema
            Schema<?> responseSchema = extractResponseSchema(getOp, openAPI);
            String recordsPath = SchemaInspector.inferRecordsPath(responseSchema, openAPI);
            List<String> primaryKeys = SchemaInspector.inferPrimaryKeys(getOp, openAPI);
            String replicationKey = SchemaInspector.detectReplicationKey(getOp);

            // Extract response fields
            List<FieldInfo> responseFields = new ArrayList<>();
            if (responseSchema != null) {
                responseFields = SchemaInspector.extractResponseFields(responseSchema, openAPI);
            }

            DiscoveredEndpoint endpoint = DiscoveredEndpoint.builder()
                    .id(UUID.randomUUID().toString())
                    .name(streamName)
                    .path(path)
                    .method("GET")
                    .description(description != null ? description : "")
                    .paginationStyle(pagination.get("style"))
                    .paginationParams(pagination)
                    .recordsPath(recordsPath)
                    .primaryKeys(primaryKeys)
                    .responseFields(responseFields)
                    .replicationMethod(replicationKey != null ? "INCREMENTAL" : "FULL_TABLE")
                    .replicationKey(replicationKey)
                    .selected(true)
                    .build();

            endpoints.add(endpoint);
        }

        return endpoints;
    }

    @SuppressWarnings("rawtypes")
    private Schema<?> extractResponseSchema(Operation operation, OpenAPI openAPI) {
        if (operation.getResponses() == null) {
            return null;
        }

        ApiResponse response = operation.getResponses().get("200");
        if (response == null) {
            response = operation.getResponses().get("default");
        }
        if (response == null || response.getContent() == null) {
            return null;
        }

        MediaType mediaType = response.getContent().get("application/json");
        if (mediaType == null && !response.getContent().isEmpty()) {
            mediaType = response.getContent().values().iterator().next();
        }
        if (mediaType == null) {
            return null;
        }

        return mediaType.getSchema();
    }
}
