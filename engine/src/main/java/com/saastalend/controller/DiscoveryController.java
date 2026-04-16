package com.saastalend.controller;

import com.saastalend.service.OpenApiParserService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/engine")
@CrossOrigin(origins = "http://localhost:3000")
public class DiscoveryController {

    private final OpenApiParserService parserService;

    public DiscoveryController(OpenApiParserService parserService) {
        this.parserService = parserService;
    }

    @PostMapping("/discover")
    public ResponseEntity<?> discover(@RequestBody Map<String, String> request) {
        String spec = request.get("spec");
        if (spec == null || spec.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Missing required field: spec"
            ));
        }

        try {
            OpenApiParserService.DiscoveryResult result = parserService.parseSpec(spec);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Failed to parse spec: " + e.getMessage()
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Internal error during discovery: " + e.getMessage()
            ));
        }
    }
}
