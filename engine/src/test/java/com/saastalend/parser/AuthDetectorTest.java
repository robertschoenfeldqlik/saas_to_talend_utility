package com.saastalend.parser;

import com.saastalend.model.AuthConfig;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Auth detection must be grounded in what operations actually REQUIRE, not in
 * which scheme happens to be declared first. These tests pin the usage-weighted
 * tie-break (the fix for the "first declared scheme wins" bug).
 */
class AuthDetectorTest {

    private static SecurityScheme apiKey(String name) {
        return new SecurityScheme()
                .type(SecurityScheme.Type.APIKEY)
                .name(name)
                .in(SecurityScheme.In.HEADER);
    }

    private static SecurityScheme http(String scheme) {
        return new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme(scheme);
    }

    private static SecurityScheme oauth2() {
        return new SecurityScheme().type(SecurityScheme.Type.OAUTH2);
    }

    private static Operation getOp(String... requiredSchemes) {
        Operation op = new Operation();
        if (requiredSchemes.length > 0) {
            SecurityRequirement req = new SecurityRequirement();
            for (String s : requiredSchemes) {
                req.addList(s);
            }
            op.addSecurityItem(req);
        }
        return op;
    }

    @Test
    void noSchemesIsNoAuth() {
        assertEquals(AuthConfig.AuthType.NO_AUTH, AuthDetector.detect(new OpenAPI()).getType());
    }

    @Test
    void singleApiKeyCarriesNameAndLocation() {
        OpenAPI spec = new OpenAPI().components(
                new Components().addSecuritySchemes("k", apiKey("X-API-Key")));
        AuthConfig auth = AuthDetector.detect(spec);
        assertEquals(AuthConfig.AuthType.API_KEY, auth.getType());
        assertEquals("X-API-Key", auth.getApiKeyName());
        assertEquals("header", auth.getApiKeyLocation());
    }

    @Test
    void singleBearerScheme() {
        OpenAPI spec = new OpenAPI().components(
                new Components().addSecuritySchemes("b", http("bearer")));
        assertEquals(AuthConfig.AuthType.BEARER_TOKEN, AuthDetector.detect(spec).getType());
    }

    @Test
    void globalRequirementWinsOverFirstDeclared() {
        // Declares basic FIRST, then bearer — but global security requires
        // bearer on every operation. The old first-match logic returned basic;
        // usage-weighting must return bearer.
        OpenAPI spec = new OpenAPI()
                .components(new Components()
                        .addSecuritySchemes("basicAuth", http("basic"))
                        .addSecuritySchemes("bearerAuth", http("bearer")))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"));
        Paths paths = new Paths();
        paths.addPathItem("/users", new PathItem().get(getOp()));     // inherits global
        paths.addPathItem("/orders", new PathItem().get(getOp()));    // inherits global
        spec.setPaths(paths);

        assertEquals(AuthConfig.AuthType.BEARER_TOKEN, AuthDetector.detect(spec).getType());
    }

    @Test
    void mostRequiredSchemeWinsViaPerOperationSecurity() {
        // oauth2 required by 3 ops, apiKey by 1 → oauth2 wins even though apiKey
        // is declared first.
        OpenAPI spec = new OpenAPI().components(new Components()
                .addSecuritySchemes("key", apiKey("X-Key"))
                .addSecuritySchemes("oauth", oauth2()));
        Paths paths = new Paths();
        paths.addPathItem("/a", new PathItem().get(getOp("oauth")));
        paths.addPathItem("/b", new PathItem().get(getOp("oauth")));
        paths.addPathItem("/c", new PathItem().get(getOp("oauth")));
        paths.addPathItem("/d", new PathItem().get(getOp("key")));
        spec.setPaths(paths);

        assertEquals(AuthConfig.AuthType.OAUTH2, AuthDetector.detect(spec).getType());
    }

    @Test
    void declaredButUnusedFallsBackToPriorityOrder() {
        // Both declared, neither required by any operation, no global security.
        // Priority order is bearer > basic, so bearer wins regardless of the
        // (basic-first) declaration order.
        OpenAPI spec = new OpenAPI().components(new Components()
                .addSecuritySchemes("basicAuth", http("basic"))
                .addSecuritySchemes("bearerAuth", http("bearer")));
        spec.setPaths(new Paths().addPathItem("/x", new PathItem().get(getOp())));

        assertEquals(AuthConfig.AuthType.BEARER_TOKEN, AuthDetector.detect(spec).getType());
    }

    @Test
    void openIdConnectIsTreatedAsOauth2() {
        OpenAPI spec = new OpenAPI().components(new Components().addSecuritySchemes(
                "oidc", new SecurityScheme().type(SecurityScheme.Type.OPENIDCONNECT)
                        .openIdConnectUrl("https://issuer/.well-known/openid-configuration")));
        assertEquals(AuthConfig.AuthType.OAUTH2, AuthDetector.detect(spec).getType());
    }
}
