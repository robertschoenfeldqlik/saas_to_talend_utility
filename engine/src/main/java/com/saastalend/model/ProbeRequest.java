package com.saastalend.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request body for POST /api/engine/probe — execute one real HTTP call
 * against a discovered endpoint with the provided auth, and (optionally)
 * persist the response payload as a fixture for later regression diffing.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProbeRequest {

    private DiscoveredEndpoint endpoint;
    private AuthConfig auth;
    private String baseUrl;

    /** When true, the JSON response is written to disk as a fixture. */
    @Builder.Default
    private boolean saveFixture = true;

    /**
     * Logical key under which fixtures are grouped on disk. The store
     * appends /<endpointName>/<timestamp>.json to this. Use something
     * stable per project so re-probes accumulate alongside earlier runs.
     */
    private String fixtureKey;

    /** Soft cap so a probe of a huge endpoint can't fill the volume. */
    @Builder.Default
    private long maxBytes = 2_000_000L; // 2 MB

    /** HTTP timeout in milliseconds for the probe call. */
    @Builder.Default
    private int timeoutMs = 30_000;
}
