package com.saastalend.controller;

import com.saastalend.model.DbOutputConfig;
import com.saastalend.model.DbSourceConfig;
import com.saastalend.model.DiscoveredTable;
import com.saastalend.model.TalendJob;
import com.saastalend.service.DbJobGeneratorService;
import com.saastalend.service.DbtModelGeneratorService;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/engine/db")
@CrossOrigin(origins = "http://localhost:3000")
public class DbGeneratorController {

    private static final Logger log = LoggerFactory.getLogger(DbGeneratorController.class);

    private final DbJobGeneratorService jobService;
    private final DbtModelGeneratorService dbtService;
    private final GeneratorController generatorController;

    public DbGeneratorController(DbJobGeneratorService jobService,
                                  DbtModelGeneratorService dbtService,
                                  GeneratorController generatorController) {
        this.jobService = jobService;
        this.dbtService = dbtService;
        this.generatorController = generatorController;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GenerateRequest {
        private DbSourceConfig sourceConfig;
        private List<DiscoveredTable> selectedTables;
        private DbOutputConfig outputConfig;
        private String projectName;
    }

    @PostMapping("/generate")
    public ResponseEntity<?> generate(@RequestBody GenerateRequest req) {
        if (req == null || req.getSourceConfig() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "sourceConfig is required"));
        }
        if (req.getSelectedTables() == null || req.getSelectedTables().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "No tables selected for generation"));
        }

        try {
            Map<String, Object> response = new HashMap<>();

            // Build Talend jobs
            List<TalendJob> jobs = jobService.generateJobs(
                    req.getSourceConfig(), req.getSelectedTables(), req.getOutputConfig());

            List<Map<String, Object>> jobSummaries = new ArrayList<>();
            for (TalendJob job : jobs) {
                generatorController.getJobStore().put(job.getId(), job);

                String schema = null;
                // Find endpoint (schema.table) from the matching discovered table
                for (DiscoveredTable t : req.getSelectedTables()) {
                    if (t.getTableName() != null
                            && job.getName() != null
                            && job.getName().equals(sanitize(t.getTableName()))) {
                        schema = t.getSchema();
                        break;
                    }
                }
                String endpoint = (schema != null && !schema.isBlank() ? schema + "." : "") + job.getName();

                Map<String, Object> summary = new HashMap<>();
                summary.put("id", job.getId());
                summary.put("name", job.getName());
                summary.put("endpoint", endpoint);
                summary.put("components", job.getNodes().size());
                summary.put("status", job.getStatus());
                jobSummaries.add(summary);
            }
            response.put("jobs", jobSummaries);

            // If dbt output type requested, also build dbt project files
            String outputType = req.getOutputConfig() != null
                    ? (req.getOutputConfig().getOutputType() != null
                        ? req.getOutputConfig().getOutputType().toLowerCase() : "")
                    : "";

            if ("dbt".equals(outputType)) {
                Map<String, String> dbtFiles = dbtService.generateDbtProject(
                        req.getSourceConfig(), req.getSelectedTables(),
                        req.getOutputConfig(), req.getProjectName());
                List<Map<String, String>> filesList = new ArrayList<>();
                for (Map.Entry<String, String> e : dbtFiles.entrySet()) {
                    Map<String, String> m = new HashMap<>();
                    m.put("path", e.getKey());
                    m.put("content", e.getValue());
                    filesList.add(m);
                }
                response.put("dbtFiles", filesList);
            }

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("DB generate failed", e);
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Generation failed: " + e.getMessage()));
        }
    }

    private String sanitize(String name) {
        if (name == null || name.isEmpty()) return "unnamed_table";
        String s = name.replaceAll("[^a-zA-Z0-9_]", "_");
        if (!Character.isLetter(s.charAt(0))) s = "tbl_" + s;
        return s;
    }
}
