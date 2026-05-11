package com.saastalend.controller;

import com.saastalend.model.FixtureDiff;
import com.saastalend.model.ProbeRequest;
import com.saastalend.model.ProbeResponse;
import com.saastalend.service.FixtureComparator;
import com.saastalend.service.ProbeService;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * REST surface for the probe + compare flow:
 *
 *   POST /api/engine/probe          — hit the endpoint, save fixture, return shape
 *   POST /api/engine/probe/compare  — diff two saved fixtures
 *
 * The probe is intentionally a single call: the goal is to capture an
 * actual sample for shape detection, not exhaustively page through the
 * whole resource. The Talend job we generate will do the paginated fetch.
 */
@RestController
@RequestMapping("/api/engine/probe")
@CrossOrigin(origins = "http://localhost:3000")
public class ProbeController {

    private final ProbeService probeService;
    private final FixtureComparator comparator;

    public ProbeController(ProbeService probeService, FixtureComparator comparator) {
        this.probeService = probeService;
        this.comparator = comparator;
    }

    @PostMapping
    public ResponseEntity<ProbeResponse> probe(@RequestBody ProbeRequest request) {
        return ResponseEntity.ok(probeService.probe(request));
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CompareRequest {
        private String fixtureAPath;
        private String fixtureBPath;
        private String recordsPath;
    }

    @PostMapping("/compare")
    public ResponseEntity<?> compare(@RequestBody CompareRequest req) {
        if (req.getFixtureAPath() == null || req.getFixtureBPath() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "fixtureAPath and fixtureBPath are required"));
        }
        try {
            FixtureDiff diff = comparator.compare(
                    req.getFixtureAPath(),
                    req.getFixtureBPath(),
                    req.getRecordsPath());
            return ResponseEntity.ok(diff);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Compare failed: " + e.getMessage()));
        }
    }
}
