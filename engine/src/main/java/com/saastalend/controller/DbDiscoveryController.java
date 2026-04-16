package com.saastalend.controller;

import com.saastalend.model.DbSourceConfig;
import com.saastalend.service.DbSchemaScannerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;
import java.util.Map;

@RestController
@RequestMapping("/api/engine/db")
@CrossOrigin(origins = "http://localhost:3000")
public class DbDiscoveryController {

    private static final Logger log = LoggerFactory.getLogger(DbDiscoveryController.class);

    private final DbSchemaScannerService scanner;

    public DbDiscoveryController(DbSchemaScannerService scanner) {
        this.scanner = scanner;
    }

    @PostMapping("/discover")
    public ResponseEntity<?> discover(@RequestBody DbSourceConfig cfg) {
        try {
            DbSchemaScannerService.ScanResult result = scanner.scan(cfg);
            return ResponseEntity.ok(result);
        } catch (SQLException e) {
            log.warn("DB discovery failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Unexpected DB discovery error", e);
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Discovery failed: " + e.getMessage()));
        }
    }
}
