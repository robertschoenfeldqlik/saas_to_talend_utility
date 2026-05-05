package com.saastalend.generator;

import com.saastalend.model.*;
import com.saastalend.model.TalendElementParameter.TableEntry;

import java.util.ArrayList;
import java.util.List;

/**
 * Generates an HTTPClient (TaCoKit) component node — the modern Talend Studio 8.0.1
 * REST client, replacing the deprecated tRESTClient.
 *
 * Schema decompiled from Talend's own JARs:
 *   org.talend.components/http-common/1.2603.1/http-common-1.2603.1.jar
 *
 * Authentication.AuthorizationType enum:
 *   NoAuth, Basic, Digest, Bearer, NTLM, APIKey, OAuth20
 *
 * Authentication wrapper exposes:
 *   - type:        AuthorizationType
 *   - basic:       Basic { username, password }
 *   - ntlm:        Ntlm  { ... }
 *   - bearerToken: String                     ← top-level for Bearer
 *   - apiKey:      APIKey { destination, headerName, queryName, prefix, token }
 *   - oauth20:     OAuth20 { flow, authenticationType, tokenEndpoint,
 *                            clientId, clientSecret, params, customizeHeaderName,
 *                            customHeaderName, customizeTokenPrefix, customTokenPrefix }
 *
 * Pagination.Strategy enum (only 3 values; NO PAGE_NUMBER / CURSOR):
 *   OFFSET_LIMIT  — offset+limit query params
 *   MARKER        — cursor or page-token (covers both)
 *   NEXT_LINK     — next URL in response body or Link header
 *
 * Each strategy has its own *StrategyConfig sub-object with exact field paths
 * verified against the decompiled schema.
 */
public final class TRESTClientGenerator {

    /** base64("http-studio#HTTP#Client") — TaCoKit family identifier. */
    private static final String HTTPCLIENT_TACOKIT_ID = "aHR0cC1zdHVkaW8jSFRUUCNDbGllbnQ";

    private TRESTClientGenerator() {
    }

    public static TalendNode generate(DiscoveredEndpoint endpoint, AuthConfig auth,
                                       String baseUrl, int posX, int posY) {
        List<TalendElementParameter> params = new ArrayList<>();

        // ── Component identity ─────────────────────────────────────────────
        params.add(hidden("TEXT",      "UNIQUE_NAME",          "tHTTPClient_1"));
        params.add(hidden("TECHNICAL", "TACOKIT_COMPONENT_ID", HTTPCLIENT_TACOKIT_ID));
        params.add(visible("TEXT",     "LABEL",                deriveLabel(endpoint)));

        // ── Datastore (the connection) ─────────────────────────────────────
        params.add(visible("TEXT", "configuration.dataset.datastore.base",
                "context.API_BASE_URL"));
        params.add(visible("TEXT", "configuration.dataset.datastore.connectionTimeout", "30000"));
        params.add(visible("TEXT", "configuration.dataset.datastore.receiveTimeout",    "300000"));
        params.add(visible("CHECK", "configuration.dataset.datastore.bypassCertificateValidation", "false"));
        params.add(visible("CHECK", "configuration.dataset.datastore.useProxy",         "false"));
        params.add(hidden("CLOSED_LIST", "configuration.dataset.datastore.proxyConfiguration.proxyType", "HTTP"));
        params.add(hidden("TEXT", "configuration.dataset.datastore.proxyConfiguration.proxyPort", "443"));
        params.add(hidden("CHECK", "configuration.dataset.datastore.hasRetry", "false"));

        // ── Authentication — full schema, all sub-params emitted ───────────
        appendAuth(params, auth);

        // ── Method + Path ─────────────────────────────────────────────────
        params.add(visible("TACOKIT_VALUE_SELECTION", "configuration.dataset.methodType", "GET"));
        params.add(visible("TEXT", "configuration.dataset.resource",
                "\"" + safePath(endpoint.getPath()) + "\""));

        // ── Path / query / header / body tables ───────────────────────────
        params.add(visible("CHECK", "configuration.dataset.hasPathParams", "false"));
        params.add(hiddenTable("configuration.dataset.pathParams"));

        // Query params: emit pagination defaults if endpoint advertises them
        boolean hasQp = endpoint.getPaginationStyle() != null
                && !"none".equalsIgnoreCase(endpoint.getPaginationStyle())
                && !"link_header".equalsIgnoreCase(endpoint.getPaginationStyle());
        params.add(visible("CHECK", "configuration.dataset.hasQueryParams", String.valueOf(hasQp)));
        if (hasQp) {
            params.add(buildPaginationQueryParams(endpoint));
        } else {
            params.add(visibleTable("configuration.dataset.queryParams"));
        }

        params.add(visible("CHECK", "configuration.dataset.hasHeaders", "false"));
        params.add(hiddenTable("configuration.dataset.headers"));

        params.add(visible("CHECK", "configuration.dataset.hasBody", "false"));
        params.add(hidden("CLOSED_LIST", "configuration.dataset.body.type", "TEXT"));
        params.add(hiddenTable("configuration.dataset.body.params"));

        // ── Response ──────────────────────────────────────────────────────
        params.add(visible("CLOSED_LIST", "configuration.dataset.format", "RAW_TEXT"));
        params.add(hidden("TEXT", "configuration.dataset.dssl", ""));
        params.add(visible("CLOSED_LIST", "configuration.dataset.returnedContent", "BODY_ONLY"));
        params.add(visible("CHECK", "configuration.dataset.outputKeyValuePairs", "false"));
        params.add(hidden("CHECK", "configuration.dataset.forwardInput", "false"));
        params.add(hiddenTable("configuration.dataset.keyValuePairs"));

        // ── Misc connection options ───────────────────────────────────────
        params.add(visible("CHECK", "configuration.downloadFile", "false"));
        params.add(visible("CHECK", "configuration.dataset.acceptRedirections", "true"));
        params.add(visible("TEXT",  "configuration.dataset.maxRedirectOnSameURL", "3"));
        params.add(visible("CHECK", "configuration.dataset.onlySameHost", "false"));

        // ── Pagination — full schema, mapped to detected style ────────────
        appendPagination(params, endpoint);

        // ── Hidden technical/version fields ───────────────────────────────
        params.add(hidden("CHECK", "configuration.dataset.jsonForceDouble", "true"));
        params.add(hidden("CHECK", "configuration.dataset.enforceNumberAsString", "true"));
        params.add(visible("CHECK", "configuration.uploadFiles", "false"));
        params.add(hiddenTable("configuration.uploadFileTable"));
        params.add(visible("CHECK", "configuration.dieOnError", "true"));
        params.add(visible("CLOSED_LIST", "configuration.httpVersion", "HTTP_1_1"));
        params.add(hidden("TECHNICAL", "configuration.dataset.__version", "5"));
        params.add(hidden("TECHNICAL", "configuration.dataset.datastore.__version", "5"));

        // ── Metadata (LOOKUP, MERGE, REJECT, FLOW) ────────────────────────
        List<TalendMetadata> metadataList = new ArrayList<>();
        metadataList.add(emptyConnector("LOOKUP"));
        metadataList.add(emptyConnector("MERGE"));
        metadataList.add(emptyConnector("REJECT"));
        metadataList.add(TalendMetadata.builder()
                .name("tHTTPClient_1")
                .connectorName("FLOW")
                .columns(List.of(TalendMetadataColumn.builder()
                        .name("body").talendType("id_String")
                        .key(false).nullable(true).build()))
                .build());

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName("HTTPClient")
                .componentVersion("5")
                .posX(posX).posY(posY)
                .parameters(params)
                .metadata(metadataList)
                .build();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Authentication — emits the full Authentication wrapper schema regardless
    // of which auth type is active. Inactive sub-params are emitted hidden so
    // the import path can read them and the Studio UI doesn't choke on missing
    // fields when the user toggles auth type after import.
    // ═══════════════════════════════════════════════════════════════════════
    private static void appendAuth(List<TalendElementParameter> params, AuthConfig auth) {
        AuthConfig.AuthType type = (auth != null) ? auth.getType() : AuthConfig.AuthType.NO_AUTH;

        // Map our internal AuthType → Talend AuthorizationType enum value
        String selector;
        switch (type) {
            case BEARER_TOKEN: selector = "Bearer";  break;
            case API_KEY:      selector = "APIKey";  break;
            case BASIC:        selector = "Basic";   break;
            case OAUTH2:       selector = "OAuth20"; break;
            case NO_AUTH:
            default:           selector = "NoAuth";  break;
        }
        params.add(visible("CLOSED_LIST",
                "configuration.dataset.datastore.authentication.type", selector));

        // Bearer — single string field directly on Authentication
        boolean isBearer = type == AuthConfig.AuthType.BEARER_TOKEN;
        params.add(showWhen("PASSWORD",
                "configuration.dataset.datastore.authentication.bearerToken",
                "context.API_BEARER_TOKEN", isBearer));

        // Basic — username + password
        boolean isBasic = type == AuthConfig.AuthType.BASIC;
        params.add(showWhen("TEXT",
                "configuration.dataset.datastore.authentication.basic.username",
                "context.API_USERNAME", isBasic));
        params.add(showWhen("PASSWORD",
                "configuration.dataset.datastore.authentication.basic.password",
                "context.API_PASSWORD", isBasic));

        // APIKey — destination, headerName, queryName, prefix, TOKEN (the value)
        boolean isApiKey = type == AuthConfig.AuthType.API_KEY;
        params.add(showWhen("CLOSED_LIST",
                "configuration.dataset.datastore.authentication.apiKey.destination",
                "HEADERS", isApiKey));
        params.add(showWhen("TEXT",
                "configuration.dataset.datastore.authentication.apiKey.headerName",
                auth != null && auth.getApiKeyName() != null
                        ? "\"" + auth.getApiKeyName() + "\""
                        : "\"X-API-Key\"", isApiKey));
        params.add(showWhen("TEXT",
                "configuration.dataset.datastore.authentication.apiKey.queryName",
                "\"apikey\"", isApiKey));
        params.add(showWhen("TEXT",
                "configuration.dataset.datastore.authentication.apiKey.prefix",
                "\"\"", isApiKey));
        // ★ "token" — the actual key value field (NOT "key" as previously coded)
        params.add(showWhen("PASSWORD",
                "configuration.dataset.datastore.authentication.apiKey.token",
                "context.API_KEY", isApiKey));

        // OAuth20 — flow + authenticationType + endpoints + clientId/secret + custom-header opts
        boolean isOAuth = type == AuthConfig.AuthType.OAUTH2;
        params.add(showWhen("CLOSED_LIST",
                "configuration.dataset.datastore.authentication.oauth20.flow",
                "CLIENT_CREDENTIAL", isOAuth));
        params.add(showWhen("CLOSED_LIST",
                "configuration.dataset.datastore.authentication.oauth20.authenticationType",
                "FORM", isOAuth));
        params.add(showWhen("TEXT",
                "configuration.dataset.datastore.authentication.oauth20.tokenEndpoint",
                "context.OAUTH2_TOKEN_URL", isOAuth));
        params.add(showWhen("TEXT",
                "configuration.dataset.datastore.authentication.oauth20.clientId",
                "context.OAUTH2_CLIENT_ID", isOAuth));
        params.add(showWhen("PASSWORD",
                "configuration.dataset.datastore.authentication.oauth20.clientSecret",
                "context.OAUTH2_CLIENT_SECRET", isOAuth));
        // Empty params table for additional OAuth scope/audience pairs
        params.add(showTableWhen(
                "configuration.dataset.datastore.authentication.oauth20.params", isOAuth));
        params.add(hidden("CHECK",
                "configuration.dataset.datastore.authentication.oauth20.customizeHeaderName", "false"));
        params.add(hidden("TEXT",
                "configuration.dataset.datastore.authentication.oauth20.customHeaderName", "Authorization"));
        params.add(hidden("CHECK",
                "configuration.dataset.datastore.authentication.oauth20.customizeTokenPrefix", "false"));
        params.add(hidden("TEXT",
                "configuration.dataset.datastore.authentication.oauth20.customTokenPrefix", "Bearer"));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Pagination — only 3 strategies in Talend: OFFSET_LIMIT, MARKER, NEXT_LINK.
    // The decompiled schema provides exact field names; mapping our paginationStyle:
    //   "page"   → MARKER (markerParameterName=page, limitParamName=per_page)
    //   "offset" → OFFSET_LIMIT (offset/limit)
    //   "cursor" → MARKER (markerParameterName=after, markerElementPath=$.next_cursor)
    //   "link_header" → NEXT_LINK (Link header parsed by Talend automatically)
    //   "jsonpath"    → NEXT_LINK (nextLinkPath = $.next or $.links.next)
    //   "odata"       → NEXT_LINK (nextLinkPath = $.@odata.nextLink)
    //   "none"        → no pagination
    // ═══════════════════════════════════════════════════════════════════════
    private static void appendPagination(List<TalendElementParameter> params, DiscoveredEndpoint endpoint) {
        String style = endpoint != null && endpoint.getPaginationStyle() != null
                ? endpoint.getPaginationStyle().toLowerCase() : "none";
        boolean hasPagination = !"none".equals(style);

        // Pick strategy + decide which sub-config is "active" (shown vs hidden)
        String strategy;
        switch (style) {
            case "offset":      strategy = "OFFSET_LIMIT"; break;
            case "page":
            case "cursor":      strategy = "MARKER";       break;
            case "link_header":
            case "jsonpath":
            case "odata":       strategy = "NEXT_LINK";    break;
            default:            strategy = "OFFSET_LIMIT"; break;
        }

        params.add(visible("CHECK", "configuration.dataset.hasPagination",
                String.valueOf(hasPagination)));
        params.add(showWhen("TEXT",        "configuration.dataset.pagination.preset",   "", hasPagination));
        params.add(showWhen("CLOSED_LIST", "configuration.dataset.pagination.strategy", strategy, hasPagination));

        boolean isOffset = "OFFSET_LIMIT".equals(strategy) && hasPagination;
        boolean isMarker = "MARKER".equals(strategy)       && hasPagination;
        boolean isNext   = "NEXT_LINK".equals(strategy)    && hasPagination;

        // OFFSET_LIMIT sub-config
        params.add(showWhen("CLOSED_LIST",
                "configuration.dataset.pagination.offsetLimitStrategyConfig.location",
                "QUERY_PARAMETERS", isOffset));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.offsetLimitStrategyConfig.offsetParamName",
                "\"offset\"", isOffset));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.offsetLimitStrategyConfig.offsetValue",
                "\"0\"", isOffset));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.offsetLimitStrategyConfig.limitParamName",
                "\"limit\"", isOffset));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.offsetLimitStrategyConfig.limitValue",
                "\"100\"", isOffset));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.offsetLimitStrategyConfig.elementsPath",
                quoteElementsPath(endpoint), isOffset));

        // MARKER sub-config (cursor / page-marker)
        boolean isPageMarker = "page".equals(style);
        params.add(showWhen("CLOSED_LIST",
                "configuration.dataset.pagination.markerStrategyConfig.location",
                "QUERY_PARAMETERS", isMarker));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.markerStrategyConfig.useMarkerKey",
                "\"\"", isMarker));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.markerStrategyConfig.useMarkerValue",
                "\"\"", isMarker));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.markerStrategyConfig.markerParameterName",
                isPageMarker ? "\"page\"" : "\"cursor\"", isMarker));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.markerStrategyConfig.markerElementPath",
                isPageMarker ? "\"\"" : "\"$.next_cursor\"", isMarker));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.markerStrategyConfig.limitParamName",
                isPageMarker ? "\"per_page\"" : "\"limit\"", isMarker));
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.markerStrategyConfig.limitValue",
                "100", isMarker));

        // NEXT_LINK sub-config
        String nextLinkPath;
        switch (style) {
            case "odata":       nextLinkPath = "\"$.@odata.nextLink\"";  break;
            case "jsonpath":    nextLinkPath = "\"$.next\"";              break;
            case "link_header": nextLinkPath = "";                        break; // Talend reads Link header
            default:            nextLinkPath = "";                        break;
        }
        params.add(showWhen("TEXT",
                "configuration.dataset.pagination.nextLinkStrategyConfig.nextLinkPath",
                nextLinkPath, isNext));
    }

    /** elementsPath is the JSONPath to the records array — same as records_path. */
    private static String quoteElementsPath(DiscoveredEndpoint ep) {
        String p = (ep != null && ep.getRecordsPath() != null) ? ep.getRecordsPath() : "$[*]";
        return "\"" + p + "\"";
    }

    /**
     * For OFFSET / MARKER pagination we still want to seed the query-params
     * table with the right key names so the user sees them on import. This is
     * complementary to the pagination config; the runtime uses the pagination
     * settings, but exposing the params in queryParams makes the request
     * inspectable in the canvas.
     */
    private static TalendElementParameter buildPaginationQueryParams(DiscoveredEndpoint endpoint) {
        TalendElementParameter p = visibleTable("configuration.dataset.queryParams");
        String style = endpoint.getPaginationStyle() == null ? "" : endpoint.getPaginationStyle().toLowerCase();
        List<TableEntry> rows = new ArrayList<>();
        switch (style) {
            case "page":
                addQueryParam(rows, "page", "\"1\"");
                addQueryParam(rows, "per_page", "\"100\"");
                break;
            case "offset":
                addQueryParam(rows, "offset", "\"0\"");
                addQueryParam(rows, "limit",  "\"100\"");
                break;
            case "cursor":
                addQueryParam(rows, "limit", "\"100\"");
                break;
            case "odata":
                addQueryParam(rows, "$top", "\"1000\"");
                break;
            default:
                addQueryParam(rows, "limit", "\"100\"");
                break;
        }
        p.setTableEntries(rows);
        return p;
    }

    private static void addQueryParam(List<TableEntry> rows, String key, String value) {
        rows.add(TableEntry.builder()
                .elementRef("configuration.dataset.queryParams[].key")
                .value("\"" + key + "\"").build());
        rows.add(TableEntry.builder()
                .elementRef("configuration.dataset.queryParams[].value")
                .value(value).build());
        rows.add(TableEntry.builder()
                .elementRef("configuration.dataset.queryParams[].query")
                .value("MAIN").build());
    }

    private static String deriveLabel(DiscoveredEndpoint ep) {
        String name = ep != null ? ep.getName() : null;
        if (name == null || name.isBlank()) return "HTTP_GET";
        return "HTTP_GET_" + name;
    }

    private static String safePath(String path) {
        if (path == null) return "/";
        return path.replace("\"", "\\\"");
    }

    // ── small param factory helpers ───────────────────────────────────────

    private static TalendElementParameter visible(String field, String name, String value) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.valueOf(field))
                .name(name).value(value).show(true).build();
    }

    private static TalendElementParameter hidden(String field, String name, String value) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.valueOf(field))
                .name(name).value(value).show(false).build();
    }

    /** Visible if cond is true, hidden if false — but the param ALWAYS exists.
     *  This matches real Talend behaviour: every auth/pagination sub-param is
     *  emitted, only the visibility flag changes by active type. */
    private static TalendElementParameter showWhen(String field, String name, String value, boolean visible) {
        return visible ? visible(field, name, value) : hidden(field, name, value);
    }

    private static TalendElementParameter visibleTable(String name) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.TABLE)
                .name(name).show(true).build();
    }

    private static TalendElementParameter hiddenTable(String name) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.TABLE)
                .name(name).show(false).build();
    }

    private static TalendElementParameter showTableWhen(String name, boolean visible) {
        return visible ? visibleTable(name) : hiddenTable(name);
    }

    private static TalendMetadata emptyConnector(String connector) {
        return TalendMetadata.builder()
                .name(connector)
                .connectorName(connector)
                .columns(new ArrayList<>())
                .build();
    }
}
