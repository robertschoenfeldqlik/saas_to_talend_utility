package com.saastalend.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * Disk-backed store for probe fixtures. Lives on the same volume as the
 * SQLite DB so fixtures survive container restarts.
 *
 * Layout:
 *   {root}/{fixtureKey}/{endpointName}/{utcTimestamp}.json
 *
 * Filenames use a portable ISO-8601-ish UTC timestamp (no colons) so they
 * sort lexicographically by capture order and don't break on Windows.
 */
@Service
public class FixtureStore {

    private static final DateTimeFormatter FILE_TS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH-mm-ss'Z'").withZone(ZoneOffset.UTC);

    private final Path root;

    public FixtureStore(@Value("${saastalend.fixtures.dir:/opt/app/server/data/fixtures}") String dir) {
        this.root = Path.of(dir);
    }

    /**
     * Persist a JSON body to disk.
     *
     * @param fixtureKey   logical grouping key (e.g. "project17")
     * @param endpointName endpoint identifier (e.g. "customers")
     * @param jsonBody     raw JSON to write
     * @return             absolute path to the written file
     */
    public Path save(String fixtureKey, String endpointName, String jsonBody) throws IOException {
        String safeKey      = sanitize(fixtureKey, "default");
        String safeEndpoint = sanitize(endpointName, "endpoint");
        Path dir = root.resolve(safeKey).resolve(safeEndpoint);
        Files.createDirectories(dir);

        String fileName = FILE_TS.format(Instant.now()) + ".json";
        Path target = dir.resolve(fileName);
        Files.writeString(target, jsonBody, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW);
        return target;
    }

    public String read(Path file) throws IOException {
        return Files.readString(file, StandardCharsets.UTF_8);
    }

    /** Defensive: filter path traversal + odd chars from user-provided keys. */
    private static String sanitize(String in, String fallback) {
        if (in == null || in.isBlank()) return fallback;
        String cleaned = in.replaceAll("[^a-zA-Z0-9._-]", "_");
        return cleaned.isBlank() ? fallback : cleaned;
    }
}
