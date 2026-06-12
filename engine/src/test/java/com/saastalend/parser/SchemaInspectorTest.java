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
}
