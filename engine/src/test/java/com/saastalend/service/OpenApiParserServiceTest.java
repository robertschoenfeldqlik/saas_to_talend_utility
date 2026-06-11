package com.saastalend.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Locks in the external-$ref SSRF / local-file-read fix: only internal "#/…"
 * refs are allowed; any ref pointing at a remote URL or a local file is rejected
 * before swagger-parser would dereference it.
 */
class OpenApiParserServiceTest {

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
}
