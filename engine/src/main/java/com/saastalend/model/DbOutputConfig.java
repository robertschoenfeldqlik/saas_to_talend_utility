package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Output configuration for a database-sourced generation request. Fields are a
 * flat union of all supported output types; only the fields relevant to the
 * chosen outputType are read.
 *
 * Supported outputType values: "database", "json", "log", "dbt".
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DbOutputConfig {

    private String outputType;

    // --- database ---
    private String targetDialect;
    private String host;
    private String port;
    private String database;
    private String schema;
    private String username;
    private String password;
    private boolean ssl;
    private String table;
    private String writeMode;
    private boolean createTable;
    private boolean truncateBeforeLoad;

    // --- json ---
    private String outputDir;
    private String encoding;

    // --- dbt ---
    private String profileName;
    private String materialization;
    private boolean useRef;
}
