package com.saastalend.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Locks in two fixes: (1) external-$ref SSRF / local-file-read — only internal
 * "#/…" refs are allowed; (2) Swagger 2.0 specs parse via the explicit v2->v3
 * converter (auto-detection fails inside the Spring Boot fat jar).
 */
class OpenApiParserServiceTest {

    @Test
    void parsesSwagger2Spec() {
        String v2 = "{\"swagger\":\"2.0\",\"info\":{\"title\":\"Mini\",\"version\":\"1\"},"
                + "\"host\":\"api.example.com\",\"basePath\":\"/v1\",\"paths\":{\"/users\":{\"get\":"
                + "{\"responses\":{\"200\":{\"description\":\"ok\",\"schema\":{\"type\":\"array\","
                + "\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"integer\"}}}}}}}}}}";
        OpenApiParserService.DiscoveryResult r = new OpenApiParserService().parseSpec(v2);
        assertFalse(r.getEndpoints().isEmpty(), "Swagger 2.0 should yield the GET /users endpoint");
    }

    @Test
    void parsesOpenApi3Spec() {
        String v3 = "{\"openapi\":\"3.0.0\",\"info\":{\"title\":\"M\",\"version\":\"1\"},"
                + "\"servers\":[{\"url\":\"https://api.example.com/v1\"}],\"paths\":{\"/widgets\":{\"get\":"
                + "{\"responses\":{\"200\":{\"description\":\"ok\",\"content\":{\"application/json\":"
                + "{\"schema\":{\"type\":\"array\",\"items\":{\"type\":\"object\","
                + "\"properties\":{\"id\":{\"type\":\"integer\"}}}}}}}}}}}}";
        OpenApiParserService.DiscoveryResult r = new OpenApiParserService().parseSpec(v3);
        assertFalse(r.getEndpoints().isEmpty());
    }

    @Test
    void detectsSwagger2Version() {
        assertTrue(OpenApiParserService.looksLikeSwagger2("{\"swagger\":\"2.0\"}"));
        assertTrue(OpenApiParserService.looksLikeSwagger2("swagger: '2.0'"));
        assertFalse(OpenApiParserService.looksLikeSwagger2("{\"openapi\":\"3.0.0\"}"));
    }

    @Test
    void allowsInternalRefs() {
        String spec = "{\"openapi\":\"3.0.0\",\"components\":{\"schemas\":{}},"
                + "\"paths\":{\"/x\":{\"get\":{\"responses\":{\"200\":"
                + "{\"content\":{\"application/json\":{\"schema\":{\"$ref\":\"#/components/schemas/X\"}}}}}}}}}";
        assertDoesNotThrow(() -> OpenApiParserService.assertNoExternalRefs(spec));
    }

    @Test
    void rejectsRemoteRef() {
        assertThrows(IllegalArgumentException.class,
                () -> OpenApiParserService.assertNoExternalRefs("{\"$ref\":\"https://attacker.example/x\"}"));
    }

    @Test
    void rejectsFileRef() {
        assertThrows(IllegalArgumentException.class,
                () -> OpenApiParserService.assertNoExternalRefs("$ref: 'file:///etc/passwd'"));
    }

    @Test
    void rejectsRelativeFileRef() {
        assertThrows(IllegalArgumentException.class,
                () -> OpenApiParserService.assertNoExternalRefs("{\"$ref\":\"./common.yaml#/X\"}"));
    }

    @Test
    void dropsSingleRecordMistypedAsArrayButKeepsRealList() {
        // Slack's pathology: objs_user is a bare {"items": {"anyOf": [...]}} with no type,
        // so swagger-parser coerces it to an array. The single-record lookup /users.info
        // (body {ok, user}) must be dropped, while the genuine list /users.list (members:
        // {type: array, items: ...}) is kept.
        String spec = "{\"openapi\":\"3.0.0\",\"info\":{\"title\":\"S\",\"version\":\"1\"},"
                + "\"paths\":{"
                + "\"/users.info\":{\"get\":{\"responses\":{\"200\":{\"content\":{\"application/json\":"
                + "{\"schema\":{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"},"
                + "\"user\":{\"$ref\":\"#/components/schemas/objs_user\"}}}}}}}}},"
                + "\"/users.list\":{\"get\":{\"responses\":{\"200\":{\"content\":{\"application/json\":"
                + "{\"schema\":{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"},"
                + "\"members\":{\"type\":\"array\",\"items\":{\"$ref\":\"#/components/schemas/objs_user\"}}}}}}}}}}"
                + "},"
                + "\"components\":{\"schemas\":{"
                + "\"objs_user\":{\"items\":{\"anyOf\":[{\"type\":\"string\"},"
                + "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}]}}"
                + "}}}";
        OpenApiParserService.DiscoveryResult r = new OpenApiParserService().parseSpec(spec);
        java.util.List<String> paths = r.getEndpoints().stream()
                .map(com.saastalend.model.DiscoveredEndpoint::getPath)
                .toList();
        assertTrue(paths.contains("/users.list"), "a genuine list (type: array) must be kept");
        assertFalse(paths.contains("/users.info"), "a single record mis-typed as an array must be dropped");
    }

    @Test
    void swagger2WithoutDefinitionsDoesNotCrash() {
        // Regression: a Swagger 2.0 spec with NO definitions block made
        // swagger-parser NPE inside resolveFully ("this.schemas is null"),
        // surfacing as a 500. The layered parse fallback must degrade instead.
        // Both ops are by-id lookups, so the (graceful) result is simply empty.
        String spec = "{\"swagger\":\"2.0\",\"info\":{\"title\":\"Syriac\",\"version\":\"1\"},"
                + "\"host\":\"api.example.com\",\"basePath\":\"/\",\"paths\":{"
                + "\"/lexeme/{id}\":{\"get\":{\"parameters\":[{\"name\":\"id\",\"in\":\"path\","
                + "\"required\":true,\"type\":\"string\"}],\"responses\":{\"200\":{\"description\":\"ok\","
                + "\"schema\":{\"type\":\"object\",\"properties\":{\"category\":{\"type\":\"string\"}}}}}}}}}";
        OpenApiParserService.DiscoveryResult r =
                assertDoesNotThrow(() -> new OpenApiParserService().parseSpec(spec));
        assertTrue(r.getEndpoints().isEmpty(), "by-id-only spec yields no list endpoints, gracefully");
    }

    @Test
    void allowsYamlFoldedScalarFalseMatch() {
        // A loose regex matches "$ref: >-" (a YAML folded scalar, as in the OpenAI
        // spec); it is not a real external ref and must not be rejected.
        assertDoesNotThrow(() -> OpenApiParserService.assertNoExternalRefs("summary:\n  $ref: >-\n    some text"));
        assertDoesNotThrow(() -> OpenApiParserService.assertNoExternalRefs("{\"$ref\":\"true\"}"));
    }
}
