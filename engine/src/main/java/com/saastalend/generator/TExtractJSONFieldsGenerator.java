package com.saastalend.generator;

import com.saastalend.model.*;

import java.util.ArrayList;
import java.util.List;

public final class TExtractJSONFieldsGenerator {

    private TExtractJSONFieldsGenerator() {
    }

    /**
     * Generates a tExtractJSONFields TalendNode for extracting fields from a JSON response.
     */
    public static TalendNode generate(DiscoveredEndpoint endpoint, int posX, int posY) {
        List<TalendElementParameter> params = new ArrayList<>();

        params.add(param("TEXT", "UNIQUE_NAME", "tExtractJSONFields_1"));
        params.add(param("TEXT", "JSONPATH",
                endpoint.getRecordsPath() != null ? "\"" + endpoint.getRecordsPath() + "\"" : "\"$[*]\""));
        params.add(param("CHECK", "USE_LOOP_AS_JSONPATH", "true"));

        // Build JSONPath expressions for each field
        if (endpoint.getResponseFields() != null && !endpoint.getResponseFields().isEmpty()) {
            StringBuilder jsonPaths = new StringBuilder("[");
            for (int i = 0; i < endpoint.getResponseFields().size(); i++) {
                FieldInfo field = endpoint.getResponseFields().get(i);
                if (i > 0) {
                    jsonPaths.append(",");
                }
                jsonPaths.append("\"$.").append(field.getName()).append("\"");
            }
            jsonPaths.append("]");
            params.add(param("TABLE", "MAPPING", jsonPaths.toString()));
        }

        // Generate metadata columns from response fields
        List<TalendMetadataColumn> columns = new ArrayList<>();
        if (endpoint.getResponseFields() != null) {
            for (FieldInfo field : endpoint.getResponseFields()) {
                columns.add(TalendMetadataColumn.builder()
                        .name(sanitizeColumnName(field.getName()))
                        .talendType(field.getType() != null ? field.getType() : "id_String")
                        .key(endpoint.getPrimaryKeys() != null && endpoint.getPrimaryKeys().contains(field.getName()))
                        .nullable(true)
                        .comment(field.getDescription())
                        .build());
            }
        }

        // If no fields discovered, add a default body column
        if (columns.isEmpty()) {
            columns.add(TalendMetadataColumn.builder()
                    .name("body")
                    .talendType("id_String")
                    .key(false)
                    .nullable(true)
                    .build());
        }

        TalendMetadata metadata = TalendMetadata.builder()
                .name("tExtractJSONFields_1")
                .connectorName("FLOW")
                .columns(columns)
                .build();

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName("tExtractJSONFields")
                .componentVersion("0.102")
                .posX(posX)
                .posY(posY)
                .parameters(params)
                .metadata(List.of(metadata))
                .build();
    }

    private static String sanitizeColumnName(String name) {
        if (name == null || name.isEmpty()) {
            return "column";
        }
        return name.replaceAll("[^a-zA-Z0-9_]", "_");
    }

    private static TalendElementParameter param(String field, String name, String value) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.valueOf(field))
                .name(name)
                .value(value)
                .show(true)
                .build();
    }
}
