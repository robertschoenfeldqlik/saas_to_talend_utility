package com.saastalend.parser;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Bulk-load detection: only array / array-wrapped responses count as collections. */
class SchemaInspectorTest {

    private final OpenAPI spec = new OpenAPI();

    @Test
    void topLevelArrayIsCollection() {
        ArraySchema arr = new ArraySchema();
        arr.setItems(new ObjectSchema());
        assertTrue(SchemaInspector.isCollectionResponse(arr, spec));
    }

    @Test
    void objectWithArrayPropertyIsCollection() {
        ArraySchema valueArr = new ArraySchema();
        valueArr.setItems(new ObjectSchema());
        Map<String, Schema> props = new HashMap<>();
        props.put("value", valueArr);
        ObjectSchema wrapper = new ObjectSchema();
        wrapper.setProperties(props);
        assertTrue(SchemaInspector.isCollectionResponse(wrapper, spec));
    }

    @Test
    void singleObjectIsNotCollection() {
        Map<String, Schema> props = new HashMap<>();
        props.put("id", new StringSchema());
        props.put("content", new StringSchema());
        ObjectSchema picture = new ObjectSchema();
        picture.setProperties(props);
        assertFalse(SchemaInspector.isCollectionResponse(picture, spec));
    }

    @Test
    void unknownOrOpaqueSchemaIsKept() {
        assertTrue(SchemaInspector.isCollectionResponse(null, spec));
        assertTrue(SchemaInspector.isCollectionResponse(new ObjectSchema(), spec)); // no properties
    }

    @Test
    void recognizesOpenApi31ArrayViaTypesSet() {
        // OpenAPI 3.1: schema type is a Set (getTypes()), and getType() is null —
        // as in OpenAI's {object, data:[...]} list envelopes.
        Schema<Object> dataArr = new Schema<>();
        dataArr.setTypes(new java.util.HashSet<>(java.util.Arrays.asList("array")));
        dataArr.setItems(new ObjectSchema());
        Map<String, Schema> props = new HashMap<>();
        props.put("object", new StringSchema());
        props.put("data", dataArr);
        ObjectSchema envelope = new ObjectSchema();
        envelope.setProperties(props);
        assertTrue(SchemaInspector.isCollectionResponse(envelope, spec));
    }
}
