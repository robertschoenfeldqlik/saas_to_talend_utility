package com.saastalend.service;

import com.saastalend.model.DbDialect;
import com.saastalend.model.DbSourceConfig;
import com.saastalend.model.DiscoveredColumn;
import com.saastalend.model.DiscoveredTable;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Opens a JDBC connection to a source database, walks the catalog via
 * {@link DatabaseMetaData}, and returns a list of discovered tables with
 * columns and primary keys. Column SQL types are translated to Talend types
 * via {@link TalendTypeMapper}.
 */
@Service
public class DbSchemaScannerService {

    private static final Logger log = LoggerFactory.getLogger(DbSchemaScannerService.class);

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ScanResult {
        private String connectionId;
        private List<DiscoveredTable> tables;
    }

    public ScanResult scan(DbSourceConfig cfg) throws SQLException {
        if (cfg == null) {
            throw new IllegalArgumentException("Source config is required");
        }
        // Block JDBC connection-property injection (socketFactory,
        // allowLoadLocalInfile, …) before any value reaches the URL builder.
        cfg.validate();

        DbDialect dialect = DbDialect.fromString(cfg.getDialect());
        if (dialect == null) {
            throw new IllegalArgumentException("Unknown or unsupported dialect: " + cfg.getDialect());
        }

        // Load the JDBC driver
        try {
            Class.forName(dialect.getDriverClass());
        } catch (ClassNotFoundException e) {
            throw new SQLException("JDBC driver not on classpath for "
                    + dialect.name() + ": " + dialect.getDriverClass(), e);
        }

        String url = dialect.buildJdbcUrl(
                cfg.getHost(),
                cfg.getPort(),
                cfg.getDatabase(),
                cfg.getSchema(),
                cfg.isSsl(),
                cfg.buildExtras()
        );

        log.info("Scanning database via {} (url masked host={}, db={})",
                dialect.name(), cfg.getHost(), cfg.getDatabase());

        List<DiscoveredTable> tables = new ArrayList<>();

        try (Connection conn = openConnection(url, cfg)) {
            DatabaseMetaData md = conn.getMetaData();

            String catalog = null;
            String schemaFilter = cfg.getSchema();

            // SQLite does not expose catalogs or schemas — pass null filters
            if (dialect == DbDialect.SQLITE) {
                catalog = null;
                schemaFilter = null;
            } else if (dialect == DbDialect.MYSQL) {
                // MySQL uses catalog == database, schema is unused
                catalog = cfg.getDatabase();
                schemaFilter = null;
            }

            Map<String, DiscoveredTable> tableMap = new LinkedHashMap<>();

            try (ResultSet rs = md.getTables(catalog, schemaFilter, "%",
                    new String[]{"TABLE", "VIEW"})) {
                while (rs.next()) {
                    String tableCatalog = rs.getString("TABLE_CAT");
                    String tableSchema = rs.getString("TABLE_SCHEM");
                    String tableName = rs.getString("TABLE_NAME");
                    String tableType = rs.getString("TABLE_TYPE");

                    if (tableName == null) continue;
                    // Skip system tables (heuristic — common system schemas)
                    if (isSystemSchema(tableSchema)) continue;

                    String key = (tableSchema != null ? tableSchema : "") + "." + tableName;
                    tableMap.put(key, DiscoveredTable.builder()
                            .catalog(tableCatalog)
                            .schema(tableSchema)
                            .tableName(tableName)
                            .tableType(tableType != null ? tableType : "TABLE")
                            .columns(new ArrayList<>())
                            .primaryKeys(new ArrayList<>())
                            .selected(true)
                            .build());
                }
            }

            for (DiscoveredTable table : tableMap.values()) {
                // Collect primary keys
                List<String> pks = new ArrayList<>();
                try (ResultSet pkRs = md.getPrimaryKeys(
                        table.getCatalog(), table.getSchema(), table.getTableName())) {
                    while (pkRs.next()) {
                        pks.add(pkRs.getString("COLUMN_NAME"));
                    }
                } catch (SQLException e) {
                    log.warn("Failed to read primary keys for {}: {}",
                            table.getTableName(), e.getMessage());
                }
                table.setPrimaryKeys(pks);

                // Collect columns
                List<DiscoveredColumn> columns = new ArrayList<>();
                try (ResultSet colRs = md.getColumns(
                        table.getCatalog(), table.getSchema(), table.getTableName(), "%")) {
                    while (colRs.next()) {
                        String colName = colRs.getString("COLUMN_NAME");
                        int dataType = colRs.getInt("DATA_TYPE");
                        String typeName = colRs.getString("TYPE_NAME");
                        int size = colRs.getInt("COLUMN_SIZE");
                        int nullableFlag = colRs.getInt("NULLABLE");
                        int ordinal = colRs.getInt("ORDINAL_POSITION");

                        boolean isNullable = nullableFlag == DatabaseMetaData.columnNullable;
                        boolean isPk = pks.contains(colName);
                        String talendType = TalendTypeMapper.map(dataType);

                        columns.add(DiscoveredColumn.builder()
                                .name(colName)
                                .sqlType(typeName)
                                .talendType(talendType)
                                .size(size)
                                .nullable(isNullable)
                                .primaryKey(isPk)
                                .ordinalPosition(ordinal)
                                .build());
                    }
                }
                table.setColumns(columns);
                tables.add(table);
            }
        }

        return new ScanResult(UUID.randomUUID().toString(), tables);
    }

    private Connection openConnection(String url, DbSourceConfig cfg) throws SQLException {
        String user = cfg.getUsername();
        String pass = cfg.getPassword();
        if (user == null || user.isEmpty()) {
            // SQLite and some passwordless setups
            return DriverManager.getConnection(url);
        }
        return DriverManager.getConnection(url, user, pass != null ? pass : "");
    }

    private static boolean isSystemSchema(String schema) {
        if (schema == null) return false;
        String s = schema.toLowerCase();
        return s.equals("information_schema")
                || s.equals("pg_catalog")
                || s.equals("sys")
                || s.equals("mysql")
                || s.equals("performance_schema")
                || s.equals("sqlite_schema")
                || s.startsWith("pg_toast");
    }

    /**
     * Static helper translating java.sql.Types codes to Talend id_* type IDs.
     */
    public static final class TalendTypeMapper {
        private TalendTypeMapper() {}

        public static String map(int sqlType) {
            switch (sqlType) {
                case Types.INTEGER:
                case Types.BIGINT:
                case Types.SMALLINT:
                case Types.TINYINT:
                    return "id_Long";
                case Types.CHAR:
                case Types.VARCHAR:
                case Types.LONGVARCHAR:
                case Types.NCHAR:
                case Types.NVARCHAR:
                case Types.LONGNVARCHAR:
                case Types.CLOB:
                case Types.NCLOB:
                case Types.SQLXML:
                    return "id_String";
                case Types.TIMESTAMP:
                case Types.TIMESTAMP_WITH_TIMEZONE:
                case Types.DATE:
                case Types.TIME:
                case Types.TIME_WITH_TIMEZONE:
                    return "id_Date";
                case Types.DECIMAL:
                case Types.NUMERIC:
                    return "id_BigDecimal";
                case Types.REAL:
                case Types.FLOAT:
                    return "id_Float";
                case Types.DOUBLE:
                    return "id_Double";
                case Types.BOOLEAN:
                case Types.BIT:
                    return "id_Boolean";
                case Types.BLOB:
                case Types.BINARY:
                case Types.VARBINARY:
                case Types.LONGVARBINARY:
                    return "id_byte[]";
                default:
                    return "id_String";
            }
        }
    }
}
