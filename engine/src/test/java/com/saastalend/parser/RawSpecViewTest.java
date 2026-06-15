package com.saastalend.parser;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Raw-spec guard: drops only single records that swagger-parser mis-typed as arrays. */
class RawSpecViewTest {

    // /users.info: a single {ok, user} body where user -> objs_user is a bare
    //   {"items": {"anyOf": [...]}} (Slack's pathology — typeless items, union, no object).
    // /users.list: a genuine list under members: {type: array, items: $ref}.
    // /tasks/stories: Asana's shape — typeless items, but items -> an object ($ref StoryCompact).
    private static final String SPEC_V3 = """
        {
          "openapi": "3.0.0",
          "info": {"title": "t", "version": "1"},
          "paths": {
            "/users.info": {"get": {"responses": {"200": {"content": {"application/json": {"schema":
              {"type": "object", "properties": {"ok": {"type": "boolean"}, "user": {"$ref": "#/components/schemas/objs_user"}}}}}}}}},
            "/users.list": {"get": {"responses": {"200": {"content": {"application/json": {"schema":
              {"type": "object", "properties": {"ok": {"type": "boolean"}, "members": {"type": "array", "items": {"$ref": "#/components/schemas/objs_user"}}}}}}}}}},
            "/tasks/stories": {"get": {"responses": {"200": {"content": {"application/json": {"schema":
              {"type": "object", "properties": {"data": {"items": {"$ref": "#/components/schemas/StoryCompact"}}}}}}}}}}
          },
          "components": {"schemas": {
            "objs_user": {"items": {"anyOf": [{"type": "string"}, {"type": "integer"}]}},
            "StoryCompact": {"type": "object", "properties": {"gid": {"type": "string"}}}
          }}
        }
        """;

    private static final String SPEC_V2 = """
        {
          "swagger": "2.0",
          "info": {"title": "t", "version": "1"},
          "paths": {
            "/u.info": {"get": {"responses": {"200": {"schema": {"$ref": "#/definitions/UserInfoResp"}}}}}
          },
          "definitions": {
            "UserInfoResp": {"type": "object", "properties": {"ok": {"type": "boolean"}, "user": {"$ref": "#/definitions/objs_user"}}},
            "objs_user": {"items": {"anyOf": [{"type": "string"}]}}
          }
        }
        """;

    @Test
    void flagsSingleRecordMistypedAsArray() {
        RawSpecView v = new RawSpecView(SPEC_V3);
        assertTrue(v.isMistypedSingleRecord("/users.info", "$.user[*]"));
    }

    @Test
    void keepsExplicitTypeArrayList() {
        RawSpecView v = new RawSpecView(SPEC_V3);
        assertFalse(v.isMistypedSingleRecord("/users.list", "$.members[*]"));
    }

    @Test
    void keepsTypelessArrayWithObjectItems() {
        // Asana: data has no explicit type but its items resolve to an object — a real list.
        RawSpecView v = new RawSpecView(SPEC_V3);
        assertFalse(v.isMistypedSingleRecord("/tasks/stories", "$.data[*]"));
    }

    @Test
    void ignoresRootAndWrapperRecordsPaths() {
        RawSpecView v = new RawSpecView(SPEC_V3);
        assertFalse(v.isMistypedSingleRecord("/users.info", "$[*]"));
    }

    @Test
    void ignoresUnknownPath() {
        RawSpecView v = new RawSpecView(SPEC_V3);
        assertFalse(v.isMistypedSingleRecord("/does-not-exist", "$.user[*]"));
    }

    @Test
    void flagsSwagger2SingleRecord() {
        RawSpecView v = new RawSpecView(SPEC_V2);
        assertTrue(v.isMistypedSingleRecord("/u.info", "$.user[*]"));
    }

    @Test
    void unparseableSpecIsInert() {
        RawSpecView v = new RawSpecView("");
        assertFalse(v.isMistypedSingleRecord("/users.info", "$.user[*]"));
    }
}
