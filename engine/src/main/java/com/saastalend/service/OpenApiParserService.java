package com.saastalend.service;

import com.saastalend.model.AuthConfig;
import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.parser.AuthDetector;
import com.saastalend.parser.OpenApiV3Parser;
import com.saastalend.parser.RawSpecView;
import com.saastalend.parser.SwaggerV2Parser;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.servers.Server;
import io.swagger.v3.parser.OpenAPIV3Parser;
import io.swagger.v3.parser.converter.SwaggerConverter;
import io.swagger.v3.parser.core.models.ParseOptions;
import io.swagger.v3.parser.core.models.SwaggerParseResult;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class OpenApiParserService {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiscoveryResult {
        private String apiName;
        private String baseUrl;
        private AuthConfig auth;
        private List<DiscoveredEndpoint> endpoints;
        private List<String> warnings;
    }

    /**
     * Parses an OpenAPI/Swagger spec string and discovers endpoints.
     */
    public DiscoveryResult parseSpec(String specContent) {
        List<String> warnings = new ArrayList<>();

        // Block SSRF / local-file disclosure: a malicious spec can carry a
        // $ref pointing at a remote URL (e.g. cloud metadata) or a local file
        // (file:///…), which swagger-parser would dereference during
        // resolution. We accept only internal refs ("#/…") — multi-file specs
        // aren't supported here anyway since we parse a single spec string.
        assertNoExternalRefs(specContent);

        // Swagger 2.0 specs must be routed through the v2->v3 converter
        // explicitly. OpenAPIV3Parser is supposed to auto-detect 2.0 via a
        // ServiceLoader extension, but that lookup doesn't resolve inside the
        // Spring Boot fat jar, so a 2.0 doc would otherwise fail with the
        // misleading "attribute openapi is missing".
        boolean isSwagger2 = looksLikeSwagger2(specContent);
        SwaggerParseResult parseResult = parseWithFallback(specContent, isSwagger2, warnings);

        if (parseResult != null && parseResult.getMessages() != null) {
            warnings.addAll(parseResult.getMessages());
        }

        OpenAPI openAPI = parseResult != null ? parseResult.getOpenAPI() : null;
        if (openAPI == null) {
            throw new IllegalArgumentException(
                    "Failed to parse OpenAPI spec. Errors: " + String.join(", ", warnings));
        }

        // Extract API name
        String apiName = "Unknown API";
        Info info = openAPI.getInfo();
        if (info != null && info.getTitle() != null) {
            apiName = info.getTitle();
        }

        // Extract base URL
        String baseUrl = "";
        if (openAPI.getServers() != null && !openAPI.getServers().isEmpty()) {
            Server server = openAPI.getServers().get(0);
            baseUrl = server.getUrl();
            if (baseUrl != null && baseUrl.endsWith("/")) {
                baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
            }
        }

        // Detect auth
        AuthConfig auth = AuthDetector.detect(openAPI);

        // Parse endpoints with the version-appropriate extractor.
        List<DiscoveredEndpoint> endpoints;
        if (isSwagger2) {
            SwaggerV2Parser v2Parser = new SwaggerV2Parser();
            endpoints = v2Parser.parse(openAPI);
        } else {
            OpenApiV3Parser v3Parser = new OpenApiV3Parser();
            endpoints = v3Parser.parse(openAPI);
        }

        // Drop endpoints that swagger-parser classified as collections only because
        // resolveFully coerced a typeless-`items` schema into an array (e.g. Slack's
        // objs_user → a bogus "$.user[*]" on the single-record /users.info lookup).
        // The raw document keeps the signal resolveFully erases; see RawSpecView.
        RawSpecView rawView = new RawSpecView(specContent);
        endpoints.removeIf(e -> {
            if (rawView.isMistypedSingleRecord(e.getPath(), e.getRecordsPath())) {
                warnings.add("Skipped " + e.getPath()
                        + " — its response is a single record the spec mis-typed as an array.");
                return true;
            }
            return false;
        });

        if (endpoints.isEmpty()) {
            warnings.add("No GET list endpoints discovered. The spec may contain only detail or mutation endpoints.");
        }

        return DiscoveryResult.builder()
                .apiName(apiName)
                .baseUrl(baseUrl)
                .auth(auth)
                .endpoints(endpoints)
                .warnings(warnings)
                .build();
    }

    /**
     * Parse with graceful degradation. The richest mode (resolveFully) inlines
     * every $ref so the schema inspector sees concrete types — but swagger-parser
     * throws on some real specs during that step (e.g. a NullPointerException,
     * "this.schemas is null", on a Swagger 2.0 doc that declares no definitions).
     * Rather than 500, fall back to progressively less-aggressive resolution so
     * we still recover the spec's paths and auth. Each attempt is independent;
     * the SSRF $ref guard already ran before this.
     */
    private SwaggerParseResult parseWithFallback(String specContent, boolean isSwagger2, List<String> warnings) {
        ParseOptions[] modes = {
                buildOptions(true, true),   // resolve + resolveFully (best fidelity)
                buildOptions(true, false),  // resolve refs but don't inline
                buildOptions(false, false), // raw structure only
        };
        SwaggerParseResult last = null;
        for (int i = 0; i < modes.length; i++) {
            try {
                SwaggerParseResult r = isSwagger2
                        ? new SwaggerConverter().readContents(specContent, null, modes[i])
                        : new OpenAPIV3Parser().readContents(specContent, null, modes[i]);
                if (r != null && r.getOpenAPI() != null) {
                    if (i > 0) {
                        warnings.add("Spec parsed with reduced $ref resolution after the parser "
                                + "could not fully resolve it; some response schemas may be incomplete.");
                    }
                    return r;
                }
                last = r;
            } catch (RuntimeException ex) {
                // swagger-parser blew up in this mode — try a gentler one.
                last = null;
            }
        }
        return last;
    }

    private static ParseOptions buildOptions(boolean resolve, boolean resolveFully) {
        ParseOptions o = new ParseOptions();
        o.setResolve(resolve);
        o.setResolveFully(resolveFully);
        return o;
    }

    private static final java.util.regex.Pattern REF_RE =
            java.util.regex.Pattern.compile("\\$ref\\s*['\"]?\\s*:\\s*['\"]?([^'\"\\s,}\\]]+)");

    /**
     * Rejects any spec that references an external document. A $ref whose
     * target does not begin with '#' points outside the spec (a remote URL or
     * a local file path) and would cause swagger-parser to fetch it — an SSRF
     * and local-file-read vector when the spec is attacker-supplied.
     */
    static void assertNoExternalRefs(String specContent) {
        if (specContent == null) return;
        java.util.regex.Matcher m = REF_RE.matcher(specContent);
        while (m.find()) {
            String ref = m.group(1);
            if (isExternalRef(ref)) {
                throw new IllegalArgumentException(
                        "This spec uses an external / multi-file $ref (\"" + ref
                        + "\"), which isn't supported (resolving it would fetch other files and"
                        + " is a security risk for untrusted specs). Bundle the spec into a single"
                        + " self-contained file first — e.g. `npx @redocly/cli bundle spec.yaml -o"
                        + " bundled.json` or `swagger-cli bundle` — then retry with that file.");
            }
        }
    }

    /**
     * True only for $ref values that actually point outside the document — a URL
     * or a file path (optionally with a #fragment). Internal pointers ("#/…") and
     * loose-regex false matches (e.g. a YAML "$ref: >-" folded scalar, seen in the
     * OpenAI spec) are not external refs and must not be rejected.
     */
    private static boolean isExternalRef(String ref) {
        if (ref == null || ref.isEmpty() || ref.startsWith("#")) return false;
        return ref.contains("://")
                || ref.contains("/") || ref.contains("\\")
                || ref.matches("(?i).*\\.(ya?ml|json)(#.*)?$");
    }

    private static final java.util.regex.Pattern SWAGGER2_RE =
            java.util.regex.Pattern.compile("[\"']?swagger[\"']?\\s*:\\s*[\"']?2\\.");

    /** True if the spec declares Swagger/OpenAPI 2.0 (vs OpenAPI 3.x). */
    static boolean looksLikeSwagger2(String spec) {
        return spec != null && SWAGGER2_RE.matcher(spec).find();
    }
}
