package com.saastalend.generator;

import com.saastalend.model.DbDialect;
import com.saastalend.model.DbSourceConfig;
import com.saastalend.model.DiscoveredColumn;
import com.saastalend.model.DiscoveredTable;
import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendMetadata;
import com.saastalend.model.TalendMetadataColumn;
import com.saastalend.model.TalendNode;

import java.util.ArrayList;
import java.util.List;

/**
 * Generates a dialect-specific tXxxInput TalendNode (tPostgresqlInput, tMysqlInput, ...)
 * that reads all rows from a discovered table. Credentials use Talend context variables.
 */
public final class TDBInputGenerator {

    private TDBInputGenerator() {
    }

    public static TalendNode generate(DiscoveredTable table, DbSourceConfig source,
                                       int posX, int posY) {
        DbDialect dialect = DbDialect.fromString(source.getDialect());
        String componentName = dialect != null
                ? dialect.getTalendInputComponent()
                : "tJDBCInput";

        String uniqueName = componentName + "_1";

        List<TalendElementParameter> params = new ArrayList<>();
        params.add(param("TEXT", "UNIQUE_NAME", uniqueName));
        params.add(param("TEXT", "HOST", "context.DB_HOST"));
        params.add(param("TEXT", "PORT", "context.DB_PORT"));
        params.add(param("TEXT", "DBNAME", "context.DB_NAME"));

        if (supportsSchema(dialect)) {
            params.add(param("TEXT", "SCHEMA_DB", "context.DB_SCHEMA"));
        }

        params.add(param("TEXT", "USER", "context.DB_USERNAME"));
        params.add(param("TEXT", "PASS", "context.DB_PASSWORD"));

        // SELECT * FROM [schema.]table
        String schema = table.getSchema();
        String qualifiedName = (schema != null && !schema.isEmpty())
                ? schema + "." + table.getTableName()
                : table.getTableName();
        params.add(param("MEMO", "QUERY",
                "\"SELECT * FROM " + qualifiedName + "\""));

        params.add(param("CHECK", "USE_EXISTING_CONNECTION", "false"));
        params.add(param("CHECK", "DIE_ON_ERROR", "false"));

        // Metadata built from discovered columns
        List<TalendMetadataColumn> columns = new ArrayList<>();
        for (DiscoveredColumn col : table.getColumns()) {
            columns.add(TalendMetadataColumn.builder()
                    .name(col.getName())
                    .talendType(col.getTalendType() != null ? col.getTalendType() : "id_String")
                    .key(col.isPrimaryKey())
                    .nullable(col.isNullable())
                    .length(col.getSize())
                    .build());
        }
        if (columns.isEmpty()) {
            // fallback — empty tables still need a placeholder column for Talend
            columns.add(TalendMetadataColumn.builder()
                    .name("record")
                    .talendType("id_String")
                    .nullable(true)
                    .build());
        }

        TalendMetadata metadata = TalendMetadata.builder()
                .name(uniqueName)
                .connectorName("FLOW")
                .columns(columns)
                .build();

        return TalendNode.builder()
                .xmiId(XmiIdGenerator.generate())
                .componentName(componentName)
                .componentVersion("0.102")
                .posX(posX)
                .posY(posY)
                .parameters(params)
                .metadata(List.of(metadata))
                .build();
    }

    private static boolean supportsSchema(DbDialect dialect) {
        if (dialect == null) return false;
        switch (dialect) {
            case POSTGRESQL:
            case MSSQL:
            case SNOWFLAKE:
            case REDSHIFT:
            case ORACLE:
                return true;
            default:
                return false;
        }
    }

    private static TalendElementParameter param(String field, String name, String value) {
        return TalendElementParameter.builder()
                .field(TalendElementParameter.FieldType.valueOf(field))
                .name(name)
                .value(value)
                .show(true)
                .build();
    }
}
