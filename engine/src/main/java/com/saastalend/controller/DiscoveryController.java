package com.saastalend.controller;

import com.saastalend.service.OpenApiParserService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/engine")
@CrossOrigin(origins = "http://localhost:3000")
public class DiscoveryController {

    /** Hard cap on accepted OpenAPI/Swagger spec body size, in characters.
     *  At ~2 bytes/char average this is ~10 MB on the wire, ~5 MB of UTF-8 text.
     *  Larger specs almost always indicate a denial-of-service attempt or a
     *  spec we couldn't handle in 8k context anyway. */
    private static final int MAX_SPEC_CHARS = 5_000_000;

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
        if (spec.length() > MAX_SPEC_CHARS) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Spec too large (" + spec.length() + " chars). "
                            + "Maximum allowed is " + MAX_SPEC_CHARS + " chars (~5 MB)."
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
            // Don't leak internal stack details to the client
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Internal error during discovery"
            ));
        }
    }
}
