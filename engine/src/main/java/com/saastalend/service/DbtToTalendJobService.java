package com.saastalend.service;

import com.saastalend.generator.TDBRowGenerator;
import com.saastalend.model.DbDialect;
import com.saastalend.model.DbtConversionRequest;
import com.saastalend.model.DbtModel;
import com.saastalend.model.TalendConnection;
import com.saastalend.model.TalendJob;
import com.saastalend.model.TalendNode;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Converts parsed dbt models into Talend jobs. Each dbt model becomes a
 * single-node job containing a dialect-specific tXxxRow component that
 * executes the model SQL against the configured target warehouse.
 */
@Service
public class DbtToTalendJobService {

    public List<TalendJob> generateJobs(DbtConversionRequest req) {
        List<TalendJob> jobs = new ArrayList<>();
        if (req == null || req.getModels() == null) {
            return jobs;
        }

        DbDialect dialect = DbDialect.fromString(req.getTargetDialect());

        for (DbtModel model : req.getModels()) {
            if (model == null) continue;

            String jobName = sanitizeJobName(model.getName());
            TalendNode node = TDBRowGenerator.generate(model, dialect, 100, 100);

            List<TalendNode> nodes = new ArrayList<>();
            nodes.add(node);

            TalendJob job = TalendJob.builder()
                    .id(UUID.randomUUID().toString())
                    .name(jobName)
                    .description("dbt model: "
                            + (model.getLayer() != null ? model.getLayer() : "unknown")
                            + " \u2014 converted from "
                            + (model.getPath() != null ? model.getPath() : model.getName()))
                    .nodes(nodes)
                    .connections(new ArrayList<TalendConnection>())
                    .status("GENERATED")
                    .build();

            jobs.add(job);
        }

        return jobs;
    }

    private String sanitizeJobName(String name) {
        if (name == null || name.isEmpty()) return "unnamed_model";
        String x = name.replaceAll("[^a-zA-Z0-9_]", "_");
        if (x.isEmpty()) return "unnamed_model";
        if (!Character.isLetter(x.charAt(0))) {
            x = "model_" + x;
        }
        return x;
    }
}
