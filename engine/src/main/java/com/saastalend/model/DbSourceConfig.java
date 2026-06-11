package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Connection configuration for a database source. Dialect names accept any case
 * and are resolved to {@link DbDialect} via {@link DbDialect#fromString(String)}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DbSourceConfig {

    private String dialect;
    private String host;
    private String port;
    private String database;
    private String schema;
    private String username;
    private String password;
    private boolean ssl;

    // Optional dialect-specific fields
    private String warehouse;   // Snowflake
    private String role;        // Snowflake
    private String projectId;   // BigQuery
    private String filePath;    // SQLite

    private Map<String, String> extras = new HashMap<>();

    /**
     * Consolidates dialect-specific optional fields into a single extras map so the
     * DbDialect.buildJdbcUrl method receives everything in one place.
     */
    public Map<String, String> buildExtras() {
        Map<String, String> combined = new HashMap<>();
        if (extras != null) combined.putAll(extras);
        if (warehouse != null) combined.put("warehouse", warehouse);
        if (role != null) combined.put("role", role);
        if (projectId != null) combined.put("projectId", projectId);
        if (filePath != null) combined.put("filePath", filePath);
        return combined;
    }

    // Hostnames / IPv4, or a bracketed IPv6 literal. No '/', '?', '&', ';', etc.
    private static final Pattern HOST_RE =
            Pattern.compile("^[A-Za-z0-9._\\-]+$|^\\[[0-9A-Fa-f:]+]$");
    // database / schema and dialect identifiers: forbid the characters that have
    // structural meaning in a JDBC URL across every supported dialect
    // ('?', '&', ';' start a property; '/', '\\', '#', quotes, '=', '<', '>'),
    // plus whitespace and control characters.
    private static final Pattern UNSAFE_NAME_RE =
            Pattern.compile("[?&;#/\\\\\"'=<>\\s\\x00-\\x1f]");

    /**
     * Validates every value that will be concatenated into the JDBC URL,
     * blocking JDBC connection-property injection (e.g. PostgreSQL
     * {@code socketFactory}/{@code loggerFile}, MySQL {@code allowLoadLocalInfile})
     * and URL-structure breakouts. Throws {@link IllegalArgumentException} on the
     * first offending field. This is a security boundary, not just input cleanup:
     * the scanner opens a live JDBC connection from these values.
     *
     * <p>Note: private/loopback hosts are intentionally permitted — pointing the
     * tool at an internal database is a supported use case. We block only the
     * injection of extra connection properties, not the destination host.
     */
    public void validate() {
        if (host != null && !host.isBlank() && !HOST_RE.matcher(host).matches()) {
            throw new IllegalArgumentException("Invalid database host: " + host);
        }
        if (port != null && !port.isBlank() && !port.matches("\\d{1,5}")) {
            throw new IllegalArgumentException("Invalid database port: " + port);
        }
        rejectUnsafe("database", database);
        rejectUnsafe("schema", schema);
        rejectUnsafe("warehouse", warehouse);
        rejectUnsafe("role", role);
        rejectUnsafe("projectId", projectId);
        if (extras != null) {
            extras.forEach((k, v) -> {
                // filePath is a filesystem path (validated separately below)
                if (!"filePath".equals(k)) rejectUnsafe("extras." + k, v);
            });
        }
        // SQLite filePath is a filesystem path — allow path separators but block
        // URI-parameter injection ('?') and control characters.
        if (filePath != null && (filePath.indexOf('?') >= 0
                || Pattern.compile("[\\x00-\\x1f]").matcher(filePath).find())) {
            throw new IllegalArgumentException("Invalid SQLite file path");
        }
    }

    private static void rejectUnsafe(String field, String value) {
        if (value != null && UNSAFE_NAME_RE.matcher(value).find()) {
            throw new IllegalArgumentException("Invalid characters in database " + field);
        }
    }
}
