package com.saastalend.parser;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.core.util.Yaml;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A read-only view over the <em>raw</em> OpenAPI/Swagger document (the text the
 * user supplied), used to second-guess swagger-parser on one specific point.
 *
 * <p>swagger-parser's {@code resolveFully} coerces a schema that has an
 * {@code items} key but no {@code type} into an array — reasonable for valid
 * specs, but it mis-classifies malformed ones. Slack's spec, for example,
 * declares every object type as a bare {@code {"items": {"anyOf": [...]}}}; the
 * parser then reports a single-record lookup such as {@code /users.info} (whose
 * body is {@code {ok, user}}) as a collection, with a bogus {@code $.user[*]}
 * records-path that would drive a broken extraction job.
 *
 * <p>The raw document still carries the distinguishing signal that
 * {@code resolveFully} erases: a genuine list property is either explicitly
 * {@code type: array} (Slack's real {@code conversations.list} → {@code channels})
 * or its items resolve to a record-like object (Asana's {@code /stories} →
 * {@code data: {items: {$ref: StoryCompact}}}). Only a typeless-items array whose
 * items are <em>not</em> object-like (a union / scalar / empty) is a single
 * record mis-typed as an array.
 *
 * <p>This view flags <em>only</em> that case and nothing else. Anything it
 * cannot positively identify (parse failure, unresolvable $ref, non
 * {@code $.prop[*]} records-path) is left untouched, so it can only ever drop a
 * clearly-mistyped endpoint — never reduce coverage of legitimate ones.
 */
public final class RawSpecView {

    private static final Pattern PROP_RECORDS_PATH = Pattern.compile("^\\$\\.([^.\\[]+)\\[\\*]$");
    private static final int MAX_REF_DEPTH = 20;

    private final JsonNode root;
    private final boolean swagger2;

    public RawSpecView(String specContent) {
        JsonNode parsed = null;
        try {
            // Yaml.mapper() reads both YAML and JSON (JSON is valid YAML).
            parsed = Yaml.mapper().readTree(specContent);
        } catch (Exception e) {
            parsed = null; // inert view — never flags anything
        }
        this.root = parsed;
        this.swagger2 = parsed != null && parsed.path("swagger").asText("").startsWith("2");
    }

    /**
     * True only when {@code recordsPath} is {@code $.<prop>[*]} and, in the raw
     * spec, {@code <prop>} of the GET response for {@code path} is a typeless-items
     * array whose items are not object-like — i.e. a single record that
     * swagger-parser mis-typed as a collection.
     */
    public boolean isMistypedSingleRecord(String path, String recordsPath) {
        if (root == null || path == null || recordsPath == null) {
            return false;
        }
        Matcher m = PROP_RECORDS_PATH.matcher(recordsPath);
        if (!m.matches()) {
            return false; // $[*] (top-level / opaque) or a wrapper we don't second-guess
        }
        String prop = m.group(1);

        JsonNode getOp = root.path("paths").path(path).path("get");
        if (getOp.isMissingNode()) {
            return false;
        }
        JsonNode response = getOp.path("responses").path("200");
        if (response.isMissingNode()) {
            response = getOp.path("responses").path("default");
        }
        response = resolveRef(response);
        if (response.isMissingNode()) {
            return false;
        }

        JsonNode bodySchema = responseSchema(response);
        JsonNode propSchema = property(bodySchema, prop);
        return isMistypedArray(propSchema);
    }

    /** The body schema of a response object (2.0: {@code schema}; 3.x: {@code content.*.schema}). */
    private JsonNode responseSchema(JsonNode response) {
        if (swagger2) {
            return response.path("schema");
        }
        JsonNode content = response.path("content");
        if (content.isMissingNode() || !content.fieldNames().hasNext()) {
            return missing();
        }
        JsonNode json = content.path("application/json");
        if (!json.isMissingNode()) {
            return json.path("schema");
        }
        return content.elements().next().path("schema"); // first media type
    }

    /** Resolves {@code schema} (following a top-level $ref + merging allOf) and returns property {@code prop}. */
    private JsonNode property(JsonNode schema, String prop) {
        JsonNode resolved = resolveSchemaRef(schema);
        JsonNode direct = resolved.path("properties").path(prop);
        if (!direct.isMissingNode()) {
            return direct;
        }
        JsonNode allOf = resolved.path("allOf");
        if (allOf.isArray()) {
            for (JsonNode part : allOf) {
                JsonNode p = resolveSchemaRef(part).path("properties").path(prop);
                if (!p.isMissingNode()) {
                    return p;
                }
            }
        }
        return missing();
    }

    /** A typeless-items array whose items are not object-like → a single record mis-typed as an array. */
    private boolean isMistypedArray(JsonNode propSchema) {
        if (propSchema.isMissingNode()) {
            return false;
        }
        JsonNode resolved = resolveSchemaRef(propSchema);
        if (hasExplicitArrayType(resolved)) {
            return false; // genuine list (e.g. Slack's channels: {type: array, ...})
        }
        JsonNode items = resolved.path("items");
        if (items.isMissingNode()) {
            return false; // not array-shaped in the raw spec — don't second-guess
        }
        return !isObjectLike(resolveSchemaRef(items)); // object items → real list (Asana data → StoryCompact)
    }

    private boolean hasExplicitArrayType(JsonNode schema) {
        JsonNode type = schema.path("type");
        if (type.isTextual()) {
            return "array".equals(type.asText());
        }
        if (type.isArray()) {
            for (JsonNode t : type) {
                if ("array".equals(t.asText())) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean isObjectLike(JsonNode schema) {
        JsonNode type = schema.path("type");
        if (type.isTextual() && "object".equals(type.asText())) {
            return true;
        }
        if (type.isArray()) {
            for (JsonNode t : type) {
                if ("object".equals(t.asText())) {
                    return true;
                }
            }
        }
        JsonNode props = schema.path("properties");
        if (props.isObject() && props.size() > 0) {
            return true;
        }
        return schema.path("allOf").isArray(); // object composition counts as a record
    }

    /** Follows a top-level {@code $ref} to its target schema definition (bounded depth). */
    private JsonNode resolveSchemaRef(JsonNode node) {
        JsonNode current = node;
        for (int i = 0; i < MAX_REF_DEPTH; i++) {
            JsonNode ref = current.path("$ref");
            if (!ref.isTextual()) {
                return current;
            }
            JsonNode target = lookupRef(ref.asText());
            if (target.isMissingNode()) {
                return current;
            }
            current = target;
        }
        return current;
    }

    private JsonNode resolveRef(JsonNode node) {
        JsonNode ref = node.path("$ref");
        if (ref.isTextual()) {
            JsonNode target = lookupRef(ref.asText());
            return target.isMissingNode() ? node : target;
        }
        return node;
    }

    /** Resolves an internal pointer like {@code #/components/schemas/Foo} against the raw root. */
    private JsonNode lookupRef(String ref) {
        if (ref == null || !ref.startsWith("#/")) {
            return missing();
        }
        JsonNode current = root;
        for (String part : ref.substring(2).split("/")) {
            String token = part.replace("~1", "/").replace("~0", "~"); // JSON-pointer unescape
            current = current.path(token);
            if (current.isMissingNode()) {
                return missing();
            }
        }
        return current;
    }

    private JsonNode missing() {
        return root.path("__definitely_absent_key__");
    }
}
