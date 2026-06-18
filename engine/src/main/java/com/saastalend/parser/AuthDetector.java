package com.saastalend.parser;

import com.saastalend.model.AuthConfig;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.security.OAuthFlow;
import io.swagger.v3.oas.models.security.OAuthFlows;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Detects authentication configuration from an OpenAPI/Swagger spec.
 *
 * The hard part is multi-scheme specs. A spec frequently DECLARES several
 * security schemes (e.g. both Basic and OAuth2) but only REQUIRES one of them
 * on its actual operations. Picking the first declared scheme — as this class
 * used to — silently emits the wrong auth for those APIs; an empirical
 * head-to-head over real specs found auth detection to be the single weakest
 * dimension, with exactly this root cause.
 *
 * So {@link #detect(OpenAPI)} weights each declared scheme by how many
 * operations actually require it (a per-operation {@code security} block
 * overrides the global {@code security} default). The scheme required by the
 * most operations wins; ties — and schemes no operation references — fall back
 * to a fixed PRIORITY order ({@code bearer_token > api_key > oauth2 > basic}).
 */
public final class AuthDetector {

    private AuthDetector() {
    }

    /**
     * Detects authentication from a full spec, weighting declared schemes by
     * actual per-operation usage.
     */
    public static AuthConfig detect(OpenAPI spec) {
        if (spec == null || spec.getComponents() == null
                || spec.getComponents().getSecuritySchemes() == null) {
            return noAuth();
        }

        // Map every declared scheme to our AuthConfig, preserving insertion
        // order; unmappable schemes (e.g. mutualTLS) are skipped.
        Map<String, AuthConfig> mapped = new LinkedHashMap<>();
        for (Map.Entry<String, SecurityScheme> e : spec.getComponents().getSecuritySchemes().entrySet()) {
            AuthConfig cfg = mapScheme(e.getValue());
            if (cfg != null) {
                mapped.put(e.getKey(), cfg);
            }
        }
        if (mapped.isEmpty()) {
            return noAuth();
        }

        // How many operations require each scheme? When no operation references
        // any scheme, every count stays 0 and the tie-break below picks by
        // priority — i.e. "declared but unused" degrades gracefully.
        Map<String, Integer> usage = countSchemeUsage(spec, mapped.keySet());

        String best = null;
        for (String name : mapped.keySet()) {
            if (best == null) {
                best = name;
                continue;
            }
            int cmp = Integer.compare(usage.getOrDefault(name, 0), usage.getOrDefault(best, 0));
            if (cmp > 0) {
                best = name;
            } else if (cmp == 0
                    && priority(mapped.get(name).getType()) < priority(mapped.get(best).getType())) {
                best = name;
            }
        }
        return mapped.get(best);
    }

    /**
     * Detects authentication from a bare security-schemes map (no usage
     * information available). Picks the highest-PRIORITY mappable scheme rather
     * than the first one declared.
     */
    public static AuthConfig detect(Map<String, SecurityScheme> securitySchemes) {
        if (securitySchemes == null || securitySchemes.isEmpty()) {
            return noAuth();
        }
        AuthConfig best = null;
        for (SecurityScheme scheme : securitySchemes.values()) {
            AuthConfig cfg = mapScheme(scheme);
            if (cfg == null) {
                continue;
            }
            if (best == null || priority(cfg.getType()) < priority(best.getType())) {
                best = cfg;
            }
        }
        return best != null ? best : noAuth();
    }

    /** Maps one security scheme to an AuthConfig, or null if we can't drive it. */
    private static AuthConfig mapScheme(SecurityScheme scheme) {
        if (scheme == null || scheme.getType() == null) {
            return null;
        }
        switch (scheme.getType()) {
            case APIKEY:
                return AuthConfig.builder()
                        .type(AuthConfig.AuthType.API_KEY)
                        .apiKeyName(scheme.getName())
                        .apiKeyLocation(scheme.getIn() != null ? scheme.getIn().toString() : "header")
                        .build();

            case HTTP:
                if ("bearer".equalsIgnoreCase(scheme.getScheme())) {
                    return AuthConfig.builder().type(AuthConfig.AuthType.BEARER_TOKEN).build();
                } else if ("basic".equalsIgnoreCase(scheme.getScheme())) {
                    return AuthConfig.builder().type(AuthConfig.AuthType.BASIC).build();
                }
                return null;

            case OAUTH2: {
                AuthConfig.AuthConfigBuilder builder = AuthConfig.builder()
                        .type(AuthConfig.AuthType.OAUTH2);

                OAuthFlows flows = scheme.getFlows();
                if (flows != null) {
                    OAuthFlow flow = null;
                    String grantType = "client_credentials";

                    if (flows.getClientCredentials() != null) {
                        flow = flows.getClientCredentials();
                        grantType = "client_credentials";
                    } else if (flows.getAuthorizationCode() != null) {
                        flow = flows.getAuthorizationCode();
                        grantType = "authorization_code";
                    } else if (flows.getImplicit() != null) {
                        flow = flows.getImplicit();
                        grantType = "implicit";
                    } else if (flows.getPassword() != null) {
                        flow = flows.getPassword();
                        grantType = "password";
                    }

                    if (flow != null && flow.getTokenUrl() != null) {
                        builder.oauth2TokenUrl(flow.getTokenUrl());
                    }
                    builder.oauth2GrantType(grantType);
                }
                return builder.build();
            }

            case OPENIDCONNECT:
                // OIDC is OAuth2 under the hood; we drive it as OAuth2.
                return AuthConfig.builder()
                        .type(AuthConfig.AuthType.OAUTH2)
                        .oauth2GrantType("authorization_code")
                        .build();

            default:
                return null;
        }
    }

    /**
     * Counts, for each known scheme name, how many operations require it. A
     * per-operation {@code security} list overrides the global default; an
     * explicit empty list ({@code security: []}) opts the operation out of auth
     * and therefore counts toward nothing.
     */
    private static Map<String, Integer> countSchemeUsage(OpenAPI spec, Set<String> known) {
        Map<String, Integer> usage = new HashMap<>();
        for (String k : known) {
            usage.put(k, 0);
        }
        if (spec.getPaths() == null) {
            return usage;
        }
        java.util.List<SecurityRequirement> global = spec.getSecurity();
        for (PathItem item : spec.getPaths().values()) {
            if (item == null) {
                continue;
            }
            for (Operation op : item.readOperations()) {
                if (op == null) {
                    continue;
                }
                java.util.List<SecurityRequirement> effective =
                        op.getSecurity() != null ? op.getSecurity() : global;
                if (effective == null) {
                    continue;
                }
                // A scheme referenced by an operation counts once for that
                // operation, regardless of how many requirement alternatives
                // list it.
                Set<String> namesForOp = new HashSet<>();
                for (SecurityRequirement req : effective) {
                    if (req != null) {
                        namesForOp.addAll(req.keySet());
                    }
                }
                for (String name : namesForOp) {
                    if (usage.containsKey(name)) {
                        usage.put(name, usage.get(name) + 1);
                    }
                }
            }
        }
        return usage;
    }

    /** Lower number = higher priority. Used to break usage ties deterministically. */
    private static int priority(AuthConfig.AuthType type) {
        switch (type) {
            case BEARER_TOKEN: return 0;
            case API_KEY:      return 1;
            case OAUTH2:       return 2;
            case BASIC:        return 3;
            default:           return 99;
        }
    }

    private static AuthConfig noAuth() {
        return AuthConfig.builder().type(AuthConfig.AuthType.NO_AUTH).build();
    }
}
