package com.saastalend.controller;

import com.saastalend.model.TalendJob;
import com.saastalend.service.WorkspaceExporterService;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/engine")
@CrossOrigin(origins = "http://localhost:3000")
public class ExportController {

    private final WorkspaceExporterService exporterService;
    private final GeneratorController generatorController;

    public ExportController(WorkspaceExporterService exporterService,
                            GeneratorController generatorController) {
        this.exporterService = exporterService;
        this.generatorController = generatorController;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExportRequest {
        private String projectName;
        private List<String> jobIds;
        private List<DbtFile> dbtFiles;
        /** "tar.gz" (default) for Talend Studio "Import existing project",
         *  or "zip" for the legacy items archive. */
        private String format;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DbtFile {
        private String path;
        private String content;
    }

    @PostMapping("/export")
    public ResponseEntity<?> export(@RequestBody ExportRequest request) {
        if (request.getProjectName() == null || request.getProjectName().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Missing required field: projectName"
            ));
        }

        boolean hasJobIds = request.getJobIds() != null && !request.getJobIds().isEmpty();
        boolean hasDbtFiles = request.getDbtFiles() != null && !request.getDbtFiles().isEmpty();

        if (!hasJobIds && !hasDbtFiles) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "No job IDs or dbt files provided for export"
            ));
        }

        try {
            List<TalendJob> jobs = new ArrayList<>();
            List<String> notFound = new ArrayList<>();

            if (hasJobIds) {
                for (String jobId : request.getJobIds()) {
                    TalendJob job = generatorController.getJob(jobId);
                    if (job != null) {
                        jobs.add(job);
                    } else {
                        notFound.add(jobId);
                    }
                }

                if (jobs.isEmpty() && !hasDbtFiles) {
                    return ResponseEntity.badRequest().body(Map.of(
                            "error", "No valid jobs found for the provided IDs",
                            "notFound", notFound
                    ));
                }
            }

            Map<String, String> extraFiles = null;
            if (hasDbtFiles) {
                extraFiles = new LinkedHashMap<>();
                for (DbtFile f : request.getDbtFiles()) {
                    if (f == null || f.getPath() == null) continue;
                    extraFiles.put(f.getPath(), f.getContent());
                }
            }

            // Default to tar.gz — that's what Talend Studio 8.0.1's
            // "Import existing project" wizard accepts. ZIP remains
            // available as an opt-in for the legacy items wizard.
            String fmt = request.getFormat();
            boolean wantTarGz = fmt == null || fmt.isBlank()
                    || fmt.equalsIgnoreCase("tar.gz")
                    || fmt.equalsIgnoreCase("targz")
                    || fmt.equalsIgnoreCase("tgz");

            byte[] body;
            String extension;
            if (wantTarGz) {
                body = exporterService.exportWorkspaceTarGz(
                        request.getProjectName(), jobs, extraFiles);
                extension = ".tar.gz";
            } else {
                body = exporterService.exportWorkspace(
                        request.getProjectName(), jobs, extraFiles);
                extension = ".zip";
            }

            String filename = request.getProjectName()
                    .replaceAll("[^a-zA-Z0-9_-]", "_") + "_workspace" + extension;

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.setContentDispositionFormData("attachment", filename);
            headers.setContentLength(body.length);

            return ResponseEntity.ok()
                    .headers(headers)
                    .body(body);

        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Failed to export workspace: " + e.getMessage()
            ));
        }
    }
}
