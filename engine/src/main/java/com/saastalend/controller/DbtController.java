package com.saastalend.controller;

import com.saastalend.model.DbtConversionRequest;
import com.saastalend.model.DbtModel;
import com.saastalend.model.TalendJob;
import com.saastalend.service.DbtToTalendJobService;
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
@RequestMapping("/api/engine/dbt")
@CrossOrigin(origins = "http://localhost:3000")
public class DbtController {

    private final DbtToTalendJobService jobService;
    private final GeneratorController generatorController;

    public DbtController(DbtToTalendJobService jobService,
                         GeneratorController generatorController) {
        this.jobService = jobService;
        this.generatorController = generatorController;
    }

    @PostMapping("/generate")
    public ResponseEntity<?> generate(@RequestBody DbtConversionRequest req) {
        if (req.getModels() == null || req.getModels().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No models provided"));
        }
        try {
            List<TalendJob> jobs = jobService.generateJobs(req);
            List<Map<String, Object>> summaries = new ArrayList<>();
            for (TalendJob job : jobs) {
                generatorController.getJobStore().put(job.getId(), job);

                DbtModel matched = req.getModels().stream()
                        .filter(m -> sanitize(m.getName()).equals(job.getName()))
                        .findFirst().orElse(null);

                Map<String, Object> s = new HashMap<>();
                s.put("id", job.getId());
                s.put("name", job.getName());
                s.put("endpoint", matched != null ? matched.getPath() : job.getName());
                s.put("components", job.getNodes().size());
                s.put("status", job.getStatus());
                s.put("layer", matched != null ? matched.getLayer() : null);
                summaries.add(s);
            }
            Map<String, Object> response = new HashMap<>();
            response.put("jobs", summaries);
            response.put("workspaceReady", !summaries.isEmpty());
            response.put("targetDialect", req.getTargetDialect());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Failed to generate dbt jobs: " + e.getMessage()));
        }
    }

    private String sanitize(String s) {
        if (s == null || s.isEmpty()) return "unnamed_model";
        String x = s.replaceAll("[^a-zA-Z0-9_]", "_");
        if (x.isEmpty()) return "unnamed_model";
        if (!Character.isLetter(x.charAt(0))) x = "model_" + x;
        return x;
    }
}
