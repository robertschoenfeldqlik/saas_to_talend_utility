package com.saastalend.model;

import java.util.Map;

/**
 * Database dialects supported for source discovery and Talend component generation.
 * Mirrors the DB_DIALECTS object in the client OutputConfig.jsx so that front-end
 * selections map directly to backend enum values.
 */
public enum DbDialect {

    POSTGRESQL("PostgreSQL", "5432",
            "org.postgresql.Driver",
            "tPostgresqlInput", "tPostgresqlOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            StringBuilder url = new StringBuilder("jdbc:postgresql://")
                    .append(host).append(":").append(port != null ? port : getDefaultPort())
                    .append("/").append(database != null ? database : "");
            if (ssl) {
                url.append("?sslmode=require");
            }
            return url.toString();
        }
    },

    MYSQL("MySQL", "3306",
            "com.mysql.cj.jdbc.Driver",
            "tMysqlInput", "tMysqlOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            StringBuilder url = new StringBuilder("jdbc:mysql://")
                    .append(host).append(":").append(port != null ? port : getDefaultPort())
                    .append("/").append(database != null ? database : "");
            url.append(ssl ? "?useSSL=true&requireSSL=true" : "?useSSL=false");
            url.append("&allowPublicKeyRetrieval=true");
            return url.toString();
        }
    },

    MSSQL("SQL Server", "1433",
            "com.microsoft.sqlserver.jdbc.SQLServerDriver",
            "tMSSqlInput", "tMSSqlOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            StringBuilder url = new StringBuilder("jdbc:sqlserver://")
                    .append(host).append(":").append(port != null ? port : getDefaultPort())
                    .append(";databaseName=").append(database != null ? database : "");
            if (ssl) {
                url.append(";encrypt=true");
            } else {
                url.append(";encrypt=false");
            }
            url.append(";trustServerCertificate=true");
            return url.toString();
        }
    },

    ORACLE("Oracle", "1521",
            "oracle.jdbc.OracleDriver",
            "tOracleInput", "tOracleOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            return "jdbc:oracle:thin:@" + host + ":"
                    + (port != null ? port : getDefaultPort())
                    + ":" + (database != null ? database : "");
        }
    },

    SNOWFLAKE("Snowflake", "443",
            "net.snowflake.client.jdbc.SnowflakeDriver",
            "tSnowflakeInput", "tSnowflakeOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            StringBuilder url = new StringBuilder("jdbc:snowflake://")
                    .append(host).append("/?db=").append(database != null ? database : "")
                    .append("&schema=").append(schema != null ? schema : "PUBLIC");
            if (extras != null) {
                String warehouse = extras.get("warehouse");
                String role = extras.get("role");
                if (warehouse != null) url.append("&warehouse=").append(warehouse);
                if (role != null) url.append("&role=").append(role);
            }
            return url.toString();
        }
    },

    REDSHIFT("Redshift", "5439",
            "com.amazon.redshift.jdbc42.Driver",
            "tRedshiftInput", "tRedshiftOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            StringBuilder url = new StringBuilder("jdbc:redshift://")
                    .append(host).append(":").append(port != null ? port : getDefaultPort())
                    .append("/").append(database != null ? database : "");
            if (ssl) {
                url.append("?ssl=true");
            }
            return url.toString();
        }
    },

    BIGQUERY("BigQuery", "443",
            "com.simba.googlebigquery.jdbc42.Driver",
            "tBigQueryInput", "tBigQueryOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            String projectId = extras != null && extras.get("projectId") != null
                    ? extras.get("projectId")
                    : database;
            return "jdbc:bigquery://https://www.googleapis.com/bigquery/v2;ProjectId="
                    + (projectId != null ? projectId : "");
        }
    },

    SQLITE("SQLite", "",
            "org.sqlite.JDBC",
            "tSqliteInput", "tSqliteOutput") {
        @Override
        public String buildJdbcUrl(String host, String port, String database, String schema,
                                    boolean ssl, Map<String, String> extras) {
            String filePath = extras != null && extras.get("filePath") != null
                    ? extras.get("filePath")
                    : database;
            return "jdbc:sqlite:" + (filePath != null ? filePath : "");
        }
    };

    private final String label;
    private final String defaultPort;
    private final String driverClass;
    private final String talendInputComponent;
    private final String talendOutputComponent;

    DbDialect(String label, String defaultPort, String driverClass,
              String talendInputComponent, String talendOutputComponent) {
        this.label = label;
        this.defaultPort = defaultPort;
        this.driverClass = driverClass;
        this.talendInputComponent = talendInputComponent;
        this.talendOutputComponent = talendOutputComponent;
    }

    public String getLabel() { return label; }
    public String getDefaultPort() { return defaultPort; }
    public String getDriverClass() { return driverClass; }
    public String getTalendInputComponent() { return talendInputComponent; }
    public String getTalendOutputComponent() { return talendOutputComponent; }

    /**
     * Returns the dialect-specific tXxxRow component name used for execute-only SQL
     * (no output rowset) — mirrors the tXxxInput / tXxxOutput naming convention.
     */
    public String getTalendRowComponent() {
        switch (this) {
            case POSTGRESQL: return "tPostgresqlRow";
            case MYSQL:      return "tMysqlRow";
            case MSSQL:      return "tMSSqlRow";
            case ORACLE:     return "tOracleRow";
            case SNOWFLAKE:  return "tSnowflakeRow";
            case REDSHIFT:   return "tRedshiftRow";
            case BIGQUERY:   return "tBigQueryRow";
            case SQLITE:     return "tSqliteRow";
            default:         return "tJDBCRow";
        }
    }

    public abstract String buildJdbcUrl(String host, String port, String database, String schema,
                                         boolean ssl, Map<String, String> extras);

    /**
     * Case-insensitive lookup. Returns null if no matching dialect is found.
     */
    public static DbDialect fromString(String name) {
        if (name == null) return null;
        String normalized = name.trim().toUpperCase().replace("-", "_");
        for (DbDialect d : values()) {
            if (d.name().equals(normalized)) return d;
        }
        return null;
    }
}
