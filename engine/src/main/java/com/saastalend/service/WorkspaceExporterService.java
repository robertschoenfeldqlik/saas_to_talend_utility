package com.saastalend.service;

import com.saastalend.model.TalendJob;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Exports Talend workspace as a ZIP archive matching the import structure
 * that Talend Studio 8.0.1 expects.
 *
 * The dbt-to-Talend Studio conversion pattern uses:
 *   ProjectName/
 *     talend.project
 *     process/
 *       JobName_0.1.item
 *       JobName_0.1.properties
 *     context/                    (empty, required for import)
 *     code/
 *       routines/
 *         system/                 (empty, required for import)
 *     metadata/
 *       connections/              (empty, required for import)
 *
 * All paths are prefixed with the project folder name so the ZIP
 * extracts into a self-contained directory that can be imported as
 * "Import existing project" in Talend Studio.
 */
@Service
public class WorkspaceExporterService {

    private final TalendXmlWriterService xmlWriter;

    public WorkspaceExporterService(TalendXmlWriterService xmlWriter) {
        this.xmlWriter = xmlWriter;
    }

    /**
     * Exports a complete Talend workspace as a ZIP archive.
     * The ZIP is structured so Talend Studio can import it via
     * File → Import Items or File → Import Existing Project.
     */
    public byte[] exportWorkspace(String projectName, List<TalendJob> jobs) {
        return exportWorkspace(projectName, jobs, null);
    }

    /**
     * Overload that accepts a map of additional files (relativePath → content) to
     * embed alongside the project folder. Used for dbt artifacts and other
     * generated non-Talend files.
     */
    public byte[] exportWorkspace(String projectName, List<TalendJob> jobs,
                                    Map<String, String> extraFiles) {
        String projectDir = sanitizeProjectDir(projectName);

        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {

            // ── talend.project (project root) ──
            // We need the generated xmi:id and technical label so each .properties
            // file's <author href="../talend.project#XXXX"/> resolves to the same
            // project, and additionalProperties.value matches the technicalLabel.
            TalendXmlWriterService.ProjectXml projectXml =
                    xmlWriter.writeTalendProjectXmlWithId(projectName);
            addZipEntry(zos, projectDir + "/talend.project", projectXml.xml);

            // ── Required empty directories (Talend expects these to exist) ──
            addEmptyDir(zos, projectDir + "/process/");
            addEmptyDir(zos, projectDir + "/context/");
            addEmptyDir(zos, projectDir + "/code/routines/");
            addEmptyDir(zos, projectDir + "/code/routines/system/");
            addEmptyDir(zos, projectDir + "/metadata/connections/");
            addEmptyDir(zos, projectDir + "/metadata/file/");
            addEmptyDir(zos, projectDir + "/metadata/sapconnections/");
            addEmptyDir(zos, projectDir + "/metadata/header_footer/");
            addEmptyDir(zos, projectDir + "/temp/");

            // ── Job files ──
            if (jobs != null) {
                for (TalendJob job : jobs) {
                    String jobName = job.getName();
                    String basePath = projectDir + "/process/" + jobName + "_0.1";

                    // .item file (job process XML)
                    String itemXml = xmlWriter.writeItemXml(job);
                    addZipEntry(zos, basePath + ".item", itemXml);

                    // .properties file — passes the project xmi:id + tech label
                    // so cross-file XMI references resolve correctly.
                    String propsXml = xmlWriter.writePropertiesXml(
                            job, projectXml.technicalLabel, projectXml.projectXmiId);
                    addZipEntry(zos, basePath + ".properties", propsXml);
                }
            }

            // ── Extra files (dbt models, etc.) — nested under project folder ──
            if (extraFiles != null) {
                for (Map.Entry<String, String> e : extraFiles.entrySet()) {
                    String relPath = e.getKey();
                    if (relPath == null || relPath.isBlank()) continue;
                    // Strip any leading slash
                    if (relPath.startsWith("/")) relPath = relPath.substring(1);
                    String fullPath = projectDir + "/" + relPath;
                    addZipEntry(zos, fullPath, e.getValue() != null ? e.getValue() : "");
                }
            }

            zos.finish();
            return baos.toByteArray();

        } catch (IOException e) {
            throw new RuntimeException("Failed to create workspace ZIP", e);
        }
    }

    private String sanitizeProjectDir(String name) {
        if (name == null || name.isEmpty()) {
            return "SAAS_TALEND";
        }
        return name.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    private void addZipEntry(ZipOutputStream zos, String path, String content) throws IOException {
        ZipEntry entry = new ZipEntry(path);
        zos.putNextEntry(entry);
        zos.write(content.getBytes(StandardCharsets.UTF_8));
        zos.closeEntry();
    }

    private void addEmptyDir(ZipOutputStream zos, String path) throws IOException {
        // Ensure path ends with / for directories
        String dirPath = path.endsWith("/") ? path : path + "/";
        ZipEntry entry = new ZipEntry(dirPath);
        zos.putNextEntry(entry);
        zos.closeEntry();
    }

    // ─── tar.gz export ────────────────────────────────────────────────────
    //
    // Talend Studio 8.0.1's File → Import existing project wizard filters its
    // archive picker to .tar.gz / .tgz only; .zip is rejected at the file
    // selector. This method produces the same logical workspace structure as
    // exportWorkspace() but in a Talend-importable .tar.gz container.
    //

    /**
     * Logical entry to write into the workspace archive — either a directory
     * marker (content == null) or a UTF-8 text file (content != null).
     */
    private static final class Entry {
        final String path;
        final String content;
        Entry(String path, String content) { this.path = path; this.content = content; }
    }

    /**
     * Builds the canonical entry list for a workspace, used by both the .zip
     * and .tar.gz exporters so the two formats stay in sync.
     */
    private List<Entry> buildEntries(String projectName, List<TalendJob> jobs,
                                       Map<String, String> extraFiles) {
        String projectDir = sanitizeProjectDir(projectName);
        List<Entry> entries = new ArrayList<>();

        // Project marker
        TalendXmlWriterService.ProjectXml projectXml =
                xmlWriter.writeTalendProjectXmlWithId(projectName);
        entries.add(new Entry(projectDir + "/talend.project", projectXml.xml));

        // Required empty directories
        for (String d : new String[]{
                "process", "context", "code/routines", "code/routines/system",
                "metadata/connections", "metadata/file", "metadata/sapconnections",
                "metadata/header_footer", "temp"}) {
            entries.add(new Entry(projectDir + "/" + d + "/", null));
        }

        // Job .item + .properties pairs
        if (jobs != null) {
            for (TalendJob job : jobs) {
                String jobName = job.getName();
                String basePath = projectDir + "/process/" + jobName + "_0.1";
                entries.add(new Entry(basePath + ".item",
                        xmlWriter.writeItemXml(job)));
                entries.add(new Entry(basePath + ".properties",
                        xmlWriter.writePropertiesXml(
                                job, projectXml.technicalLabel, projectXml.projectXmiId)));
            }
        }

        // Extra files (dbt artifacts, etc.)
        if (extraFiles != null) {
            for (Map.Entry<String, String> e : extraFiles.entrySet()) {
                String relPath = e.getKey();
                if (relPath == null || relPath.isBlank()) continue;
                if (relPath.startsWith("/")) relPath = relPath.substring(1);
                entries.add(new Entry(projectDir + "/" + relPath,
                        e.getValue() != null ? e.getValue() : ""));
            }
        }

        return entries;
    }

    /**
     * Two-arg overload for tar.gz export (no extra files).
     */
    public byte[] exportWorkspaceTarGz(String projectName, List<TalendJob> jobs) {
        return exportWorkspaceTarGz(projectName, jobs, null);
    }

    /**
     * Exports the same logical workspace as exportWorkspace() but in
     * .tar.gz format — the container Talend Studio 8.0.1's "Import
     * existing project" wizard accepts.
     */
    public byte[] exportWorkspaceTarGz(String projectName, List<TalendJob> jobs,
                                         Map<String, String> extraFiles) {
        List<Entry> entries = buildEntries(projectName, jobs, extraFiles);

        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             GzipCompressorOutputStream gz = new GzipCompressorOutputStream(baos);
             TarArchiveOutputStream tar = new TarArchiveOutputStream(gz)) {

            // Allow long file names (some dbt paths can exceed POSIX 100-char limit)
            tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_GNU);

            for (Entry e : entries) {
                if (e.content == null) {
                    // Directory marker
                    String dirPath = e.path.endsWith("/") ? e.path : e.path + "/";
                    TarArchiveEntry dir = new TarArchiveEntry(dirPath);
                    tar.putArchiveEntry(dir);
                    tar.closeArchiveEntry();
                } else {
                    byte[] data = e.content.getBytes(StandardCharsets.UTF_8);
                    TarArchiveEntry tEntry = new TarArchiveEntry(e.path);
                    tEntry.setSize(data.length);
                    tar.putArchiveEntry(tEntry);
                    tar.write(data);
                    tar.closeArchiveEntry();
                }
            }

            tar.finish();
            gz.finish();
            return baos.toByteArray();
        } catch (IOException e) {
            throw new RuntimeException("Failed to build .tar.gz workspace", e);
        }
    }
}
