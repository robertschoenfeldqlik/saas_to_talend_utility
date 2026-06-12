package com.saastalend.parser;

import com.saastalend.model.FieldInfo;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SchemaInspector {

    private static final Set<String> WRAPPER_PROPERTIES = Set.of(
            "data", "results", "items", "records", "value", "entries",
            "rows", "objects", "list", "content", "hits"
    );

    private static final Set<String> REPLICATION_PARAMS = Set.of(
            "updated_since", "modified_since", "since", "updated_after",
            "modified_after", "changed_since", "min_updated_at"
    );

    private SchemaInspector() {
    }

    /**
     * Infers the JSON path to the array of records in a response schema.
     */
    @SuppressWarnings("rawtypes")
    public static String inferRecordsPath(Schema<?> responseSchema, OpenAPI spec) {
        if (responseSchema == null) {
            return "$[*]";
        }

        Schema<?> resolved = resolveSchema(responseSchema, spec);

        // If the response itself is an array, records are at root
        if (resolved instanceof ArraySchema || "array".equals(resolved.getType())) {
            return "$[*]";
        }

        Map<String, Schema> properties = resolved.getProperties();
        if (properties == null || properties.isEmpty()) {
            return "$[*]";
        }

        // Check for known wrapper properties that contain arrays
        for (String wrapper : WRAPPER_PROPERTIES) {
            if (properties.containsKey(wrapper)) {
                Schema<?> prop = properties.get(wrapper);
                Schema<?> resolvedProp = resolveSchema(prop, spec);
                if (resolvedProp instanceof ArraySchema || "array".equals(resolvedProp.getType())) {
                    return "$." + wrapper + "[*]";
                }
            }
        }

        // If exactly one array property exists, use it
        String singleArrayProp = null;
        int arrayCount = 0;
        for (Map.Entry<String, Schema> entry : properties.entrySet()) {
            Schema<?> prop = resolveSchema(entry.getValue(), spec);
            if (prop instanceof ArraySchema || "array".equals(prop.getType())) {
                singleArrayProp = entry.getKey();
                arrayCount++;
            }
        }

        if (arrayCount == 1 && singleArrayProp != null) {
            return "$." + singleArrayProp + "[*]";
        }

        return "$[*]";
    }

    /**
     * True if the response represents a collection (bulk-loadable list): the body
     * is an array, or an object with at least one array property (e.g. an OData
     * {"value":[...]} or REST {"data":[...]} wrapper). Returns true for an
     * unknown/opaque schema (benefit of the doubt) and false only when the
     * response is positively a single object — e.g. a 1:1 sub-resource like a
     * picture or a singleton entity — which isn't a bulk-load endpoint.
     */
    @SuppressWarnings("rawtypes")
    public static boolean isCollectionResponse(Schema<?> responseSchema, OpenAPI spec) {
        if (responseSchema == null) {
            return true;
        }
        Schema<?> resolved = resolveSchema(responseSchema, spec);
        if (resolved == null) {
            return true;
        }
        if (resolved instanceof ArraySchema || "array".equals(resolved.getType())) {
            return true;
        }
        Map<String, Schema> properties = resolved.getProperties();
        if (properties == null || properties.isEmpty()) {
            return true; // opaque object (e.g. a map) — don't over-filter
        }
        for (Schema<?> prop : properties.values()) {
            Schema<?> resolvedProp = resolveSchema(prop, spec);
            if (resolvedProp instanceof ArraySchema
                    || (resolvedProp != null && "array".equals(resolvedProp.getType()))) {
                return true;
            }
        }
        return false; // object with defined scalar/ref properties, no array → single record
    }

    /**
     * Infers primary key fields from the items schema of a response.
     */
    @SuppressWarnings("rawtypes")
    public static List<String> inferPrimaryKeys(Operation getOp, OpenAPI spec) {
        List<String> keys = new ArrayList<>();

        Schema<?> itemsSchema = getItemsSchema(getOp, spec);
        if (itemsSchema == null) {
            return keys;
        }

        Schema<?> resolved = resolveSchema(itemsSchema, spec);
        Map<String, Schema> properties = resolved.getProperties();
        if (properties == null) {
            return keys;
        }

        Set<String> keyNames = Set.of("id", "uuid", "key", "_id", "ID");
        for (String keyName : keyNames) {
            if (properties.containsKey(keyName)) {
                keys.add(keyName);
            }
        }

        return keys;
    }

    /**
     * Detects a replication key from query parameters (e.g., updated_since, modified_since).
     */
    public static String detectReplicationKey(Operation getOp) {
        if (getOp == null || getOp.getParameters() == null) {
            return null;
        }

        for (Parameter param : getOp.getParameters()) {
            if (param != null && param.getName() != null) {
                if (REPLICATION_PARAMS.contains(param.getName().toLowerCase())) {
                    return param.getName();
                }
            }
        }
        return null;
    }

    /**
     * Extracts response fields from a schema for metadata generation.
     */
    @SuppressWarnings("rawtypes")
    public static List<FieldInfo> extractResponseFields(Schema<?> schema, OpenAPI spec) {
        List<FieldInfo> fields = new ArrayList<>();
        if (schema == null) {
            return fields;
        }

        Schema<?> resolved = resolveSchema(schema, spec);
        Schema<?> itemsSchema = getArrayItemsSchema(resolved, spec);
        if (itemsSchema != null) {
            resolved = resolveSchema(itemsSchema, spec);
        }

        Map<String, Schema> properties = resolved.getProperties();
        if (properties == null) {
            return fields;
        }

        for (Map.Entry<String, Schema> entry : properties.entrySet()) {
            String name = entry.getKey();
            Schema<?> propSchema = entry.getValue();
            String type = mapSchemaTypeToTalend(propSchema);
            String description = propSchema.getDescription();

            fields.add(FieldInfo.builder()
                    .name(name)
                    .type(type)
                    .description(description)
                    .build());
        }

        return fields;
    }

    @SuppressWarnings("rawtypes")
    private static Schema<?> getItemsSchema(Operation op, OpenAPI spec) {
        if (op == null || op.getResponses() == null) {
            return null;
        }

        var response = op.getResponses().get("200");
        if (response == null) {
            response = op.getResponses().get("default");
        }
        if (response == null || response.getContent() == null) {
            return null;
        }

        var mediaType = response.getContent().get("application/json");
        if (mediaType == null && !response.getContent().isEmpty()) {
            mediaType = response.getContent().values().iterator().next();
        }
        if (mediaType == null || mediaType.getSchema() == null) {
            return null;
        }

        Schema<?> responseSchema = resolveSchema(mediaType.getSchema(), spec);

        // If response is an array, get items
        Schema<?> arrayItems = getArrayItemsSchema(responseSchema, spec);
        if (arrayItems != null) {
            return arrayItems;
        }

        // Check wrapper properties for arrays
        Map<String, Schema> properties = responseSchema.getProperties();
        if (properties != null) {
            for (String wrapper : WRAPPER_PROPERTIES) {
                if (properties.containsKey(wrapper)) {
                    Schema<?> wrapperSchema = resolveSchema(properties.get(wrapper), spec);
                    Schema<?> items = getArrayItemsSchema(wrapperSchema, spec);
                    if (items != null) {
                        return items;
                    }
                }
            }
        }

        return responseSchema;
    }

    @SuppressWarnings("rawtypes")
    private static Schema<?> getArrayItemsSchema(Schema<?> schema, OpenAPI spec) {
        if (schema instanceof ArraySchema arraySchema) {
            Schema<?> items = arraySchema.getItems();
            return items != null ? resolveSchema(items, spec) : null;
        }
        if ("array".equals(schema.getType()) && schema.getItems() != null) {
            return resolveSchema((Schema<?>) schema.getItems(), spec);
        }
        return null;
    }

    @SuppressWarnings("rawtypes")
    static Schema<?> resolveSchema(Schema<?> schema, OpenAPI spec) {
        if (schema == null) {
            return schema;
        }
        String ref = schema.get$ref();
        if (ref != null && spec != null && spec.getComponents() != null && spec.getComponents().getSchemas() != null) {
            String schemaName = ref.substring(ref.lastIndexOf('/') + 1);
            Schema<?> resolved = spec.getComponents().getSchemas().get(schemaName);
            if (resolved != null) {
                return resolved;
            }
        }
        return schema;
    }

    private static String mapSchemaTypeToTalend(Schema<?> schema) {
        if (schema == null || schema.getType() == null) {
            return "id_String";
        }
        return switch (schema.getType()) {
            case "integer" -> {
                if ("int64".equals(schema.getFormat())) {
                    yield "id_Long";
                }
                yield "id_Integer";
            }
            case "number" -> {
                if ("float".equals(schema.getFormat())) {
                    yield "id_Float";
                }
                yield "id_Double";
            }
            case "boolean" -> "id_Boolean";
            case "string" -> {
                if ("date".equals(schema.getFormat())) {
                    yield "id_Date";
                } else if ("date-time".equals(schema.getFormat())) {
                    yield "id_Date";
                }
                yield "id_String";
            }
            case "array" -> "id_String";
            case "object" -> "id_Document";
            default -> "id_String";
        };
    }
}
