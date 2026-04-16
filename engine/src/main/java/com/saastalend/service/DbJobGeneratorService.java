package com.saastalend.service;

import com.saastalend.generator.ConnectionGenerator;
import com.saastalend.generator.TDBInputGenerator;
import com.saastalend.generator.TDBOutputGenerator;
import com.saastalend.generator.TFileOutputJSONGenerator;
import com.saastalend.generator.TLogRowGenerator;
import com.saastalend.model.DbOutputConfig;
import com.saastalend.model.DbSourceConfig;
import com.saastalend.model.DiscoveredTable;
import com.saastalend.model.TalendConnection;
import com.saastalend.model.TalendElementParameter;
import com.saastalend.model.TalendJob;
import com.saastalend.model.TalendNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Builds TalendJobs from discovered database tables. One job is produced per
 * selected table, wiring a source tXxxInput component to the configured
 * output destination (another database, JSON file, or tLogRow console).
 */
@Service
public class DbJobGeneratorService {

    private static final Logger log = LoggerFactory.getLogger(DbJobGeneratorService.class);

    public List<TalendJob> generateJobs(DbSourceConfig source,
                                         List<DiscoveredTable> tables,
                                         DbOutputConfig output) {
        List<TalendJob> jobs = new ArrayList<>();
        if (tables == null || tables.isEmpty()) {
            return jobs;
        }
        String outputType = output != null && output.getOutputType() != null
                ? output.getOutputType().toLowerCase()
                : "log";

        // dbt output is file-only — no Talend jobs needed
        if ("dbt".equals(outputType)) {
            log.info("dbt output type selected — returning empty jobs list");
            return jobs;
        }

        for (DiscoveredTable table : tables) {
            if (!table.isSelected()) continue;
            try {
                jobs.add(buildJob(source, table, output, outputType));
            } catch (Exception e) {
                log.warn("Failed to build job for table {}: {}",
                        table.getTableName(), e.getMessage());
            }
        }
        return jobs;
    }

    private TalendJob buildJob(DbSourceConfig source, DiscoveredTable table,
                                DbOutputConfig output, String outputType) {
        String jobName = sanitizeJobName(table.getTableName());
        String jobId = UUID.randomUUID().toString();

        List<TalendNode> nodes = new ArrayList<>();
        List<TalendConnection> connections = new ArrayList<>();

        // Source DB input node
        TalendNode input = TDBInputGenerator.generate(table, source, 100, 100);
        nodes.add(input);
        String inputName = getUniqueName(input);

        switch (outputType) {
            case "database": {
                TalendNode dbOut = TDBOutputGenerator.generate(table, output, 400, 100);
                nodes.add(dbOut);
                connections.add(ConnectionGenerator.generate(
                        inputName, getUniqueName(dbOut), "FLOW", "row1"));
                break;
            }
            case "json": {
                String dir = output != null && output.getOutputDir() != null && !output.getOutputDir().isBlank()
                        ? output.getOutputDir()
                        : "context.OUTPUT_DIR";
                // If the user supplied a literal path, wrap in quotes; otherwise treat as Talend expression
                String pathExpr;
                if (dir.startsWith("context.") || dir.startsWith("\"")) {
                    pathExpr = dir + " + \"/" + jobName + ".json\"";
                } else {
                    pathExpr = "\"" + dir + "/" + jobName + ".json\"";
                }
                TalendNode fileOut = TFileOutputJSONGenerator.generate(pathExpr, 400, 100);
                nodes.add(fileOut);
                connections.add(ConnectionGenerator.generate(
                        inputName, getUniqueName(fileOut), "FLOW", "row1"));
                break;
            }
            case "log":
            default: {
                TalendNode log = TLogRowGenerator.generate(400, 100);
                nodes.add(log);
                connections.add(ConnectionGenerator.generate(
                        inputName, getUniqueName(log), "FLOW", "row1"));
                break;
            }
        }

        return TalendJob.builder()
                .id(jobId)
                .name(jobName)
                .description("Extract " + table.getTableName() + " from " + source.getDialect()
                        + " database via JDBC")
                .nodes(nodes)
                .connections(connections)
                .outputType(outputType.toUpperCase())
                .status("GENERATED")
                .build();
    }

    private String sanitizeJobName(String name) {
        if (name == null || name.isEmpty()) return "unnamed_table";
        String sanitized = name.replaceAll("[^a-zA-Z0-9_]", "_");
        if (!Character.isLetter(sanitized.charAt(0))) {
            sanitized = "tbl_" + sanitized;
        }
        return sanitized;
    }

    private String getUniqueName(TalendNode node) {
        return node.getParameters().stream()
                .filter(p -> "UNIQUE_NAME".equals(p.getName()))
                .map(TalendElementParameter::getValue)
                .findFirst()
                .orElse(node.getComponentName() + "_1");
    }
}
