package com.saastalend.parser;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Bulk-load filter: only collection GETs are kept; by-id / by-key endpoints
 * (REST /{id} and OData ({key})) and non-GET / singleton paths are dropped.
 */
class EndpointFilterTest {

    @Test
    void includesCollectionEndpoints() {
        assertTrue(EndpointFilter.isListEndpoint("/companies", "GET"));
        assertTrue(EndpointFilter.isListEndpoint("/companies({company_id})/items", "GET"));
        assertTrue(EndpointFilter.isListEndpoint(
                "/companies({company_id})/customers({customer_id})/customerFinancialDetails", "GET"));
        assertTrue(EndpointFilter.isListEndpoint("/users", "GET"));
    }

    @Test
    void excludesByKeyEndpoints() {
        assertFalse(EndpointFilter.isListEndpoint("/users/{id}", "GET"));
        assertFalse(EndpointFilter.isListEndpoint("/companies({company_id})", "GET"));
        assertFalse(EndpointFilter.isListEndpoint("/companies({company_id})/items({item_id})", "GET"));
        assertFalse(EndpointFilter.isListEndpoint(
                "/companies({company_id})/items({item_id})/defaultDimensions({defaultDimensions_parentId},{defaultDimensions_dimensionId})", "GET"));
        assertFalse(EndpointFilter.isListEndpoint("/users/:id", "GET"));
    }

    @Test
    void excludesNonGetAndSingletons() {
        assertFalse(EndpointFilter.isListEndpoint("/companies", "POST"));
        assertFalse(EndpointFilter.isListEndpoint("/me", "GET"));
        assertFalse(EndpointFilter.isListEndpoint("/health", "GET"));
    }
}
