package com.saastalend.generator;

import com.saastalend.model.TalendConnection;

public final class ConnectionGenerator {

    private ConnectionGenerator() {
    }

    /**
     * Generates a TalendConnection between two nodes.
     *
     * @param source         Unique name of the source node
     * @param target         Unique name of the target node
     * @param connectorName  Connection type: FLOW, RESPONSE, ITERATE, etc.
     * @param label          Display label for the connection
     * @return a configured TalendConnection
     */
    public static TalendConnection generate(String source, String target,
                                             String connectorName, String label) {
        return TalendConnection.builder()
                .xmiId(XmiIdGenerator.generate())
                .connectorName(connectorName)
                .source(source)
                .target(target)
                .label(label != null ? label : connectorName)
                .lineStyle(0)
                .build();
    }
}
