package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.HashMap;
import java.util.Map;

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
}
