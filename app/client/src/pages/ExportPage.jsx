import { useState, useEffect } from 'react';
import { Download, Package, FileCode, CheckSquare } from 'lucide-react';
import { getProjects, getProjectJobs, exportWorkspace } from '../api/client';
import ExportWizard from '../components/export/ExportWizard';

export default function ExportPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto animate-fade-in-up">
      <div className="mb-8">
        <h1 className="page-header">Export Workspace</h1>
        <p className="page-subtitle">
          Package selected jobs into a Talend workspace ZIP file for import into Talend Studio
        </p>
      </div>
      <ExportWizard />
    </div>
  );
}
