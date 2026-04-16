package com.saastalend.generator;

import com.saastalend.model.DbDialect;
import com.saastalend.model.DbOutputConfig;
import com.saastalend.model.DiscoveredColumn;
import com.saastalend.model.DiscoveredTable;
import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendMetadata;
import com.saastalend.model.TalendMetadataColumn;
import com.saastalend.model.TalendNode;

import java.util.ArrayList;
import java.util.List;

/**
 * Generates a dialect-specific tXxxOutput TalendNode for writing rows to a
 * target database table. All credentials use Talend context variables prefixed
 * with TARGET_DB_ so they can coexist with a source tXxxInput in the same job.
 */
public final class TDBOutputGenerator {

    private TDBOutputGenerator() {
    }

    public static TalendNode generate(DiscoveredTable sourceTable, DbOutputConfig output,
                                       int posX, int posY) {
        DbDialect dialect = DbDialect.fromString(output.getTargetDialect());
        String componentName = dialect != null
                ? dialect.getTalendOutputComponent()
                : "tJDBCOutput";

        String uniqueName = componentName + "_1";
        String targetTable = output.getTable() != null && !output.getTable().isBlank()
                ? output.getTable()
                : sourceTable.getTableName();

        List<TalendElementParameter> params = new ArrayList<>();
        params.add(param("TEXT", "UNIQUE_NAME", uniqueName));
        params.add(param("TEXT", "HOST", "context.TARGET_DB_HOST"));
        params.add(param("TEXT", "PORT", "context.TARGET_DB_PORT"));
        params.add(param("TEXT", "DBNAME", "context.TARGET_DB_NAME"));

        if (supportsSchema(dialect)) {
            params.add(param("TEXT", "SCHEMA_DB", "context.TARGET_DB_SCHEMA"));
        }

        params.add(param("TEXT", "USER", "context.TARGET_DB_USERNAME"));
        params.add(param("TEXT", "PASS", "context.TARGET_DB_PASSWORD"));
        params.add(param("TEXT", "TABLE", "\"" + targetTable + "\""));

        params.add(param("CLOSED_LIST", "DATA_ACTION",
                mapWriteMode(output.getWriteMode())));

        // Create mode + clear data
        String createMode = output.isCreateTable() ? "CREATE_IF_NOT_EXISTS" : "NONE";
        params.add(param("CLOSED_LIST", "CREATE_IF_NOT_EXISTS", createMode));
        params.add(param("CHECK", "CLEAR_DATA", String.valueOf(output.isTruncateBeforeLoad())));
        params.add(param("CHECK", "DIE_ON_ERROR", "false"));

        // Metadata mirrors source columns so Talend can map straight through
        List<TalendMetadataColumn> columns = new ArrayList<>();
        for (DiscoveredColumn col : sourceTable.getColumns()) {
            columns.add(TalendMetadataColumn.builder()
                    .name(col.getName())
                    .talendType(col.getTalendType() != null ? col.getTalendType() : "id_String")
                    .key(col.isPrimaryKey())
                    .nullable(col.isNullable())
                    .length(col.getSize())
                    .build());
        }
        if (columns.isEmpty()) {
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

    private static String mapWriteMode(String mode) {
        if (mode == null) return "INSERT";
        switch (mode.toUpperCase()) {
            case "UPDATE":
                return "UPDATE";
            case "INSERT_OR_UPDATE":
            case "UPSERT":
                return "INSERT_OR_UPDATE";
            case "DELETE":
                return "DELETE";
            case "INSERT_IF_NOT_EXISTS":
                return "INSERT_IF_NOT_EXISTS";
            case "INSERT":
            default:
                return "INSERT";
        }
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
