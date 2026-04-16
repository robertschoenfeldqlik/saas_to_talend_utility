package com.saastalend.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.saastalend.model.AuthConfig;
import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.model.FieldMapping;
import com.saastalend.model.TalendJob;
import com.saastalend.service.TalendJobGeneratorService;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/engine")
@CrossOrigin(origins = "http://localhost:3000")
public class GeneratorController {

    private final TalendJobGeneratorService generatorService;

    // In-memory store for generated jobs (keyed by job ID)
    private final ConcurrentHashMap<String, TalendJob> jobStore = new ConcurrentHashMap<>();

    public GeneratorController(TalendJobGeneratorService generatorService) {
        this.generatorService = generatorService;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GenerateRequest {
        private String apiName;
        private String baseUrl;
        private AuthConfig auth;
        private List<DiscoveredEndpoint> endpoints;
        private String outputType;
        private List<FieldMapping> fieldMappings;
    }

    @PostMapping("/generate")
    public ResponseEntity<?> generate(@RequestBody GenerateRequest request) {
        if (request.getEndpoints() == null || request.getEndpoints().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "No endpoints provided for generation"
            ));
        }

        try {
            List<Map<String, Object>> jobSummaries = new ArrayList<>();

            for (DiscoveredEndpoint endpoint : request.getEndpoints()) {
                if (!endpoint.isSelected()) {
                    continue;
                }

                TalendJob job = generatorService.generateJob(
                        endpoint,
                        request.getAuth(),
                        request.getBaseUrl(),
                        request.getOutputType()
                );

                jobStore.put(job.getId(), job);

                Map<String, Object> summary = new HashMap<>();
                summary.put("id", job.getId());
                summary.put("name", job.getName());
                summary.put("endpoint", endpoint.getPath());
                summary.put("components", job.getNodes().size());
                summary.put("status", job.getStatus());
                jobSummaries.add(summary);
            }

            Map<String, Object> response = new HashMap<>();
            response.put("jobs", jobSummaries);
            response.put("workspaceReady", !jobSummaries.isEmpty());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Failed to generate jobs: " + e.getMessage()
            ));
        }
    }

    /**
     * Returns the in-memory job store for use by the export controller.
     */
    public TalendJob getJob(String jobId) {
        return jobStore.get(jobId);
    }

    public ConcurrentHashMap<String, TalendJob> getJobStore() {
        return jobStore;
    }
}
