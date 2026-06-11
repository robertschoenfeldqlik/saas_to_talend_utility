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
        // Both formats now share the same canonical entry list (built by
        // buildEntries). This guarantees ZIP and tar.gz contain the same
        // files in the same locations.
        List<Entry> entries = buildEntries(projectName, jobs, extraFiles);

        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {

            for (Entry e : entries) {
                // CRITICAL: Skip directory entries entirely. Real Talend
                // Studio export ZIPs (verified against nokey.zip shipped
                // with Studio 8.0.1) contain ONLY file entries — no explicit
                // directory markers. The import wizard's archive scanner
                // refuses to detect projects when stray directory entries
                // appear in the archive.
                if (e.content == null) continue;
                addZipEntry(zos, e.path, e.content);
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

    /**
     * Rejects archive entry paths that could escape the project directory when
     * extracted (zip-slip / tar-slip): Windows drive prefixes and any ".."
     * traversal segment. A single leading "/" is allowed (stripped by the
     * caller) since it just denotes project-root-relative.
     */
    private static boolean isUnsafeArchivePath(String p) {
        if (p == null || p.isBlank()) return true;
        if (p.matches("^[A-Za-z]:.*")) return true;   // Windows drive (C:\…)
        for (String seg : p.split("/")) {
            if (seg.equals("..")) return true;        // parent traversal
        }
        return false;
    }

    private void addZipEntry(ZipOutputStream zos, String path, String content) throws IOException {
        ZipEntry entry = new ZipEntry(path);
        zos.putNextEntry(entry);
        zos.write(content.getBytes(StandardCharsets.UTF_8));
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
     *
     * Layout matches a real Talend Studio 8.0.1 project export so the
     * "Import existing project" wizard recognizes it:
     *   ProjectName/
     *     .project                 <- Eclipse marker; wizard scans for this
     *     talend.project           <- Talend project metadata + User
     *     .settings/
     *       project.settings       <- technicalStatus / log settings JSON
     *       org.eclipse.core.resources.prefs
     *       org.talend.repository.prefs
     *       org.talend.designer.maven.prefs
     *       relationship.index
     *     process/JobName_0.1.item
     *     process/JobName_0.1.properties
     *     code/routines/, context/, metadata/...
     */
    private List<Entry> buildEntries(String projectName, List<TalendJob> jobs,
                                       Map<String, String> extraFiles) {
        String projectDir = sanitizeProjectDir(projectName);
        List<Entry> entries = new ArrayList<>();

        // Talend project metadata (also returns user xmi:id for cross-refs)
        TalendXmlWriterService.ProjectXml projectXml =
                xmlWriter.writeTalendProjectXmlWithId(projectName);

        // Layout matches a real Talend Studio 8.0.1 project export ZIP
        // (verified against the working `nokey.zip` reference shipped with
        // Talend Studio at C:/Program Files (x86)/Talend-Studio/studio/).
        // That export contains EXACTLY:
        //   ProjectName/
        //     talend.project
        //     .settings/project.settings        (~12 KB JSON, full real content)
        //     .settings/migration_task.index    (~104 KB JSON, full migration list)
        //     .settings/relationship.index      ([] is acceptable)
        //     process/<job>_0.1.item
        //     process/<job>_0.1.properties
        // No .project Eclipse marker, no .prefs files, no empty marker dirs.

        entries.add(new Entry(projectDir + "/talend.project", projectXml.xml));

        entries.add(new Entry(projectDir + "/.settings/", null));
        entries.add(new Entry(projectDir + "/.settings/project.settings",
                xmlWriter.writeProjectSettingsJson()));
        entries.add(new Entry(projectDir + "/.settings/migration_task.index",
                xmlWriter.writeMigrationTaskIndex()));
        entries.add(new Entry(projectDir + "/.settings/relationship.index",
                xmlWriter.writeRelationshipIndex()));

        entries.add(new Entry(projectDir + "/process/", null));

        // 5) Job .item + .properties pairs
        if (jobs != null) {
            for (TalendJob job : jobs) {
                String jobName = job.getName();
                String basePath = projectDir + "/process/" + jobName + "_0.1";
                entries.add(new Entry(basePath + ".item",
                        xmlWriter.writeItemXml(job)));
                entries.add(new Entry(basePath + ".properties",
                        xmlWriter.writePropertiesXml(
                                job, projectXml.technicalLabel,
                                projectXml.projectXmiId, projectXml.userXmiId)));
            }
        }

        // 6) Extra files (dbt artifacts, etc.)
        if (extraFiles != null) {
            for (Map.Entry<String, String> e : extraFiles.entrySet()) {
                String relPath = e.getKey();
                if (relPath == null || relPath.isBlank()) continue;
                String normalized = relPath.replace('\\', '/');
                // Reject path traversal — these entry names are extracted to
                // disk by the consumer, so "../" would escape the project
                // directory (zip-slip / tar-slip).
                if (isUnsafeArchivePath(normalized)) {
                    throw new IllegalArgumentException(
                            "Unsafe file path in workspace export: " + relPath);
                }
                if (normalized.startsWith("/")) normalized = normalized.substring(1);
                entries.add(new Entry(projectDir + "/" + normalized,
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
                // Skip directory entries — see exportWorkspace() for rationale.
                if (e.content == null) continue;
                byte[] data = e.content.getBytes(StandardCharsets.UTF_8);
                TarArchiveEntry tEntry = new TarArchiveEntry(e.path);
                tEntry.setSize(data.length);
                tar.putArchiveEntry(tEntry);
                tar.write(data);
                tar.closeArchiveEntry();
            }

            tar.finish();
            gz.finish();
            return baos.toByteArray();
        } catch (IOException e) {
            throw new RuntimeException("Failed to build .tar.gz workspace", e);
        }
    }
}
