package com.saastalend.service;

import com.saastalend.model.DbOutputConfig;
import com.saastalend.model.DbSourceConfig;
import com.saastalend.model.DiscoveredColumn;
import com.saastalend.model.DiscoveredTable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds a minimal dbt project (dbt_project.yml, models/sources.yml, and a
 * staging model per table) from discovered database tables.
 */
@Service
public class DbtModelGeneratorService {

    private static final Logger log = LoggerFactory.getLogger(DbtModelGeneratorService.class);

    public Map<String, String> generateDbtProject(DbSourceConfig source,
                                                    List<DiscoveredTable> tables,
                                                    DbOutputConfig output,
                                                    String projectName) {
        Map<String, String> files = new LinkedHashMap<>();
        if (tables == null) tables = List.of();

        String safeProjectName = sanitizeName(projectName != null ? projectName : "dbt_project");
        String profile = output != null && output.getProfileName() != null
                ? sanitizeName(output.getProfileName())
                : safeProjectName;
        String materialization = output != null && output.getMaterialization() != null
                ? output.getMaterialization()
                : "view";

        files.put("dbt/dbt_project.yml", buildProjectYml(safeProjectName, profile));
        files.put("dbt/models/sources.yml", buildSourcesYml(source, tables));

        for (DiscoveredTable table : tables) {
            if (!table.isSelected()) continue;
            String sqlName = sanitizeName(table.getTableName());
            String path = "dbt/models/staging/stg_" + sqlName + ".sql";
            files.put(path, buildStagingModel(source, table, materialization));
        }

        log.info("Generated {} dbt files for project {}", files.size(), safeProjectName);
        return files;
    }

    private String buildProjectYml(String projectName, String profile) {
        StringBuilder sb = new StringBuilder();
        sb.append("name: '").append(projectName).append("'\n");
        sb.append("version: '1.0.0'\n");
        sb.append("config-version: 2\n");
        sb.append("profile: '").append(profile).append("'\n");
        sb.append("model-paths: ['models']\n");
        sb.append("seed-paths: ['seeds']\n");
        sb.append("test-paths: ['tests']\n");
        sb.append("macro-paths: ['macros']\n");
        sb.append("target-path: 'target'\n");
        sb.append("clean-targets:\n");
        sb.append("  - 'target'\n");
        sb.append("  - 'dbt_packages'\n");
        sb.append("\n");
        sb.append("models:\n");
        sb.append("  ").append(projectName).append(":\n");
        sb.append("    staging:\n");
        sb.append("      +materialized: view\n");
        return sb.toString();
    }

    private String buildSourcesYml(DbSourceConfig source, List<DiscoveredTable> tables) {
        String dialect = source != null && source.getDialect() != null
                ? source.getDialect().toLowerCase()
                : "db";
        String schema = source != null && source.getSchema() != null && !source.getSchema().isBlank()
                ? source.getSchema()
                : "public";
        String sourceName = sanitizeName(dialect + "_" + schema);
        String database = source != null && source.getDatabase() != null ? source.getDatabase() : "";

        StringBuilder sb = new StringBuilder();
        sb.append("version: 2\n\n");
        sb.append("sources:\n");
        sb.append("  - name: ").append(sourceName).append("\n");
        if (!database.isEmpty()) {
            sb.append("    database: ").append(yamlQuote(database)).append("\n");
        }
        sb.append("    schema: ").append(yamlQuote(schema)).append("\n");
        sb.append("    tables:\n");
        for (DiscoveredTable table : tables) {
            if (!table.isSelected()) continue;
            sb.append("      - name: ").append(yamlQuote(table.getTableName())).append("\n");
        }
        return sb.toString();
    }

    private String buildStagingModel(DbSourceConfig source, DiscoveredTable table,
                                      String materialization) {
        String dialect = source != null && source.getDialect() != null
                ? source.getDialect().toLowerCase()
                : "db";
        String schema = source != null && source.getSchema() != null && !source.getSchema().isBlank()
                ? source.getSchema()
                : "public";
        String sourceName = sanitizeName(dialect + "_" + schema);

        StringBuilder sb = new StringBuilder();
        sb.append("{{ config(materialized='").append(materialization).append("') }}\n\n");
        sb.append("select\n");

        List<DiscoveredColumn> cols = table.getColumns();
        if (cols == null || cols.isEmpty()) {
            sb.append("  *\n");
        } else {
            for (int i = 0; i < cols.size(); i++) {
                DiscoveredColumn col = cols.get(i);
                String name = col.getName();
                sb.append("  ").append(name).append(" as ").append(name);
                if (i < cols.size() - 1) sb.append(",");
                sb.append("\n");
            }
        }
        sb.append("from {{ source('").append(sourceName).append("', '")
                .append(table.getTableName()).append("') }}\n");
        return sb.toString();
    }

    private String sanitizeName(String s) {
        if (s == null || s.isEmpty()) return "unnamed";
        return s.replaceAll("[^a-zA-Z0-9_]", "_").toLowerCase();
    }

    /**
     * Quote a YAML scalar if it contains special characters; otherwise leave bare.
     * This is a minimal implementation — for full safety use a YAML library.
     */
    private String yamlQuote(String s) {
        if (s == null) return "''";
        if (s.matches("[a-zA-Z0-9_\\-./]+")) return s;
        return "'" + s.replace("'", "''") + "'";
    }
}
