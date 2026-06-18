package com.saastalend.service;

import com.saastalend.model.AuthConfig;
import com.saastalend.model.DiscoveredEndpoint;
import com.saastalend.model.FieldInfo;
import com.saastalend.model.TalendConnection;
import com.saastalend.model.TalendJob;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression: a Talend component may have only ONE main (FLOW) output. The
 * generator used to hang both tLogRow and tFileOutputJSON off tExtractJSONFields,
 * giving it two main outputs — Talend rejects that ("too much row output"). The
 * pipeline must be linear: ... → tExtractJSONFields → tLogRow → tFileOutputJSON.
 */
class TalendJobGeneratorServiceTest {

    @Test
    void noComponentHasMoreThanOneMainFlowOutput() {
        DiscoveredEndpoint ep = DiscoveredEndpoint.builder()
                .name("latest_rates").path("/v1/latest").method("GET")
                .recordsPath("$").primaryKeys(List.of("date"))
                .responseFields(List.of(
                        FieldInfo.builder().name("amount").type("id_Double").build(),
                        FieldInfo.builder().name("base").type("id_String").build()))
                .selected(true).build();

        TalendJob job = new TalendJobGeneratorService().generateJob(
                ep,
                AuthConfig.builder().type(AuthConfig.AuthType.NO_AUTH).build(),
                "https://api.frankfurter.dev", "JSON");

        Map<String, Integer> flowOutPerSource = new HashMap<>();
        for (TalendConnection c : job.getConnections()) {
            if ("FLOW".equals(c.getConnectorName())) {
                flowOutPerSource.merge(c.getSource(), 1, Integer::sum);
            }
        }
        flowOutPerSource.forEach((src, n) -> assertTrue(n <= 1,
                "component " + src + " has " + n + " main FLOW outputs; Talend allows only one"));

        // Linear pipeline: HTTPClient → extract → tLogRow → tFileOutputJSON
        assertEquals(3, job.getConnections().size());
    }
}
