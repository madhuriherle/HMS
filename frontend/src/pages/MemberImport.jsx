import React, { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Users,
  ArrowLeft,
  Loader2,
  RefreshCw,
  FileText,
  Check,
  X
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import PermissionGate from '../components/PermissionGate';

export default function MemberImport() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  // Import Execution State
  const [isImporting, setIsImporting] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [skippedList, setSkippedList] = useState([]);
  const [importCompleted, setImportCompleted] = useState(false);

  // The template comes from the server (column headings only)
  const handleDownloadTemplate = async () => {
    try {
      const { data } = await api.get('/meta/import-template/members', { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'members_import_template.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      notify('Could not download the template.', 'error');
    }
  };

  // Parse CSV text into array of objects
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    // Parse header line
    const rawHeaders = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase().replace(/\s+/g, '_'));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      // Basic CSV token regex handling quoted strings
      const rowRegex = /(?:,|\n|^)("(?:(?:"")*[^"]*)*"|[^",\n]*|(?:\n|$))/g;
      const values = [];
      let match;
      while ((match = rowRegex.exec(lines[i])) && values.length < rawHeaders.length) {
        let val = match[1] || '';
        val = val.replace(/^["']|["']$/g, '').replace(/""/g, '"').trim();
        values.push(val);
      }

      if (values.length === 0 || values.every((v) => !v)) continue;

      const obj = {};
      rawHeaders.forEach((header, idx) => {
        obj[header] = values[idx] || '';
      });

      // Normalize key aliases
      const memNum = obj.membership_number || obj.membership_no || obj.member_no || obj.member_code || obj.no;
      const firstName = obj.first_name_en || obj.first_name || obj.name || obj.full_name;

      if (memNum && firstName) {
        rows.push({
          membership_number: String(memNum).trim(),
          first_name_en: String(firstName).trim(),
          middle_name_en: (obj.middle_name_en || '').trim() || null,
          last_name_en: (obj.last_name_en || obj.last_name || '').trim() || null,
          full_name_kn: (obj.full_name_kn || '').trim() || null,
          mobile: (obj.mobile || obj.phone || '').trim() || null,
          gender: (obj.gender || 'MALE').trim().toUpperCase(),
          date_of_birth: obj.date_of_birth || obj.dob || null,
          email: (obj.email || '').trim() || null,
          address_line1: (obj.address_line1 || obj.address || '').trim() || null,
          address_line2: (obj.address_line2 || '').trim() || null,
          locality: (obj.locality || obj.place || obj.village || '').trim() || null,
          city: (obj.city || obj.district || '').trim() || null,
          pincode: (obj.pincode || '').trim() || null,
          membership_type: (obj.membership_type || obj.type || 'Life Member').trim() || null,
          remarks: (obj.remarks || '').trim() || null
        });
      }
    }
    return rows;
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setFileName(selected.name);
    setImportCompleted(false);
    setSkippedList([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result;
        if (typeof text === 'string') {
          const rows = parseCSV(text);
          setParsedRows(rows);
          setPreviewRows(rows.slice(0, 10));
          if (rows.length === 0) {
            notify('No valid member rows found. Please check columns.', 'error');
          } else {
            notify(`Loaded ${rows.length.toLocaleString()} member records ready for import.`, 'success');
          }
        }
      } catch (err) {
        console.error(err);
        notify('Could not parse file. Please use standard CSV format.', 'error');
      }
    };
    reader.readAsText(selected);
  };

  // Run the batch import
  const handleStartImport = async () => {
    if (!parsedRows || parsedRows.length === 0) {
      notify('Please select a file with valid member records.', 'error');
      return;
    }

    setIsImporting(true);
    setProgressPercent(0);
    setProcessedCount(0);
    setSuccessCount(0);
    setSkippedCount(0);
    setSkippedList([]);

    const BATCH_SIZE = 300; // Optimal batch size for speed and responsiveness
    let totalSuccess = 0;
    let totalSkipped = 0;
    const allSkipped = [];

    const totalRows = parsedRows.length;

    try {
      for (let i = 0; i < totalRows; i += BATCH_SIZE) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE);

        const { data } = await api.post('/members/bulk-import', {
          members: batch,
          skip_duplicates: skipDuplicates
        });

        totalSuccess += data.success_count || 0;
        totalSkipped += data.skipped_count || 0;
        if (data.skipped && data.skipped.length > 0) {
          allSkipped.push(...data.skipped);
        }

        const currentProcessed = Math.min(i + batch.length, totalRows);
        setProcessedCount(currentProcessed);
        setSuccessCount(totalSuccess);
        setSkippedCount(totalSkipped);
        setProgressPercent(Math.round((currentProcessed / totalRows) * 100));
      }

      setSkippedList(allSkipped);
      setImportCompleted(true);
      notify(`Import complete! ${totalSuccess.toLocaleString()} members successfully imported.`, 'success');
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'An error occurred during import.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setFileName('');
    setParsedRows([]);
    setPreviewRows([]);
    setIsImporting(false);
    setImportCompleted(false);
    setProgressPercent(0);
    setProcessedCount(0);
    setSuccessCount(0);
    setSkippedCount(0);
    setSkippedList([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <PermissionGate required={['members.register.write', 'members.write']} title="Access Restricted" message="You need permission to register or import members.">
      <div className="space-y-6">
        {/* Breadcrumb Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">Bulk Member Import (Live Register)</h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/dashboard/membership/list"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Member Directory
            </Link>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-white border border-[#510601] text-[#510601] hover:bg-[#510601]/5 transition-colors cursor-pointer shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download Template CSV
            </button>
          </div>
        </div>

        {/* 3 Steps Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-2xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-sm shrink-0">
              1
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wide">Prepare Data</h4>
              <p className="text-[11px] text-[#863221] mt-0.5">
                Download the CSV template and populate your live members list with existing Membership Numbers.
              </p>
            </div>
          </div>

          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-2xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-sm shrink-0">
              2
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wide">Upload & Validate</h4>
              <p className="text-[11px] text-[#863221] mt-0.5">
                Select your file. The parser inspects records and renders an instant 10-row preview.
              </p>
            </div>
          </div>

          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-2xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-sm shrink-0">
              3
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wide">Batch Ingestion</h4>
              <p className="text-[11px] text-[#863221] mt-0.5">
                Streamed processing in high-performance batches with live progress tracking and zero page freezing.
              </p>
            </div>
          </div>
        </div>

        {/* Upload & Progress Card */}
        <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm p-6 space-y-6">
          {!importCompleted && (
            <div className="space-y-4">
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider">
                Select Member Data File (.CSV)
              </label>

              <div
                onClick={() => !isImporting && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  file
                    ? 'border-[#3D705C] bg-[#3D705C]/5'
                    : 'border-[#E8DFD8] hover:border-[#510601] bg-[#FAF7F2]/40 hover:bg-[#FAF7F2]'
                } ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="flex flex-col items-center justify-center gap-2.5">
                  <div className={`p-3 rounded-2xl ${file ? 'bg-[#3D705C]/15 text-[#3D705C]' : 'bg-[#510601]/10 text-[#510601]'}`}>
                    {file ? <FileSpreadsheet className="w-8 h-8" /> : <Upload className="w-8 h-8" />}
                  </div>

                  {file ? (
                    <div>
                      <p className="text-sm font-bold text-[#180200]">{fileName}</p>
                      <p className="text-xs text-[#3D705C] font-semibold mt-0.5">
                        {parsedRows.length.toLocaleString()} valid member records ready to ingest
                      </p>
                      <p className="text-[11px] text-[#863221]/70 mt-1">Click to choose a different file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-bold text-[#180200]">Click to browse or drag and drop your members CSV file</p>
                      <p className="text-xs text-[#863221]/70 mt-1">Supports UTF-8 CSV with headers (Membership No, Name, Mobile, etc.)</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Options & Action Row */}
              {parsedRows.length > 0 && !isImporting && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                  <label className="inline-flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601]"
                    />
                    <span className="text-xs font-semibold text-[#180200]">
                      Skip duplicate membership numbers (recommended for safe re-runs)
                    </span>
                  </label>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-4 py-2 text-xs font-semibold text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleStartImport}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      Import {parsedRows.length.toLocaleString()} Live Members
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Real-time Progress Bar */}
          {isImporting && (
            <div className="p-6 bg-[#FAF7F2] rounded-2xl border border-[#E8DFD8] space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-5 h-5 text-[#510601] animate-spin" />
                  <div>
                    <h3 className="text-sm font-bold text-[#180200]">Importing Members in Progress...</h3>
                    <p className="text-xs text-[#863221]">Streaming batches to database without timeouts</p>
                  </div>
                </div>
                <span className="text-lg font-black text-[#510601] font-mono">{progressPercent}%</span>
              </div>

              {/* Progress Track */}
              <div className="w-full h-3 bg-white rounded-full border border-[#E8DFD8] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#510601] to-[#863221] transition-all duration-300 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Statistics Grid */}
              <div className="grid grid-cols-3 gap-3 text-center pt-2">
                <div className="p-3 bg-white rounded-xl border border-[#E8DFD8]">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#863221]">Processed</span>
                  <span className="text-base font-bold text-[#180200] font-mono">
                    {processedCount.toLocaleString()} / {parsedRows.length.toLocaleString()}
                  </span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-[#3D705C]/30 text-[#3D705C]">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#3D705C]/80">Imported</span>
                  <span className="text-base font-bold font-mono">+{successCount.toLocaleString()}</span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-amber-200 text-amber-800">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-700">Skipped (Dup)</span>
                  <span className="text-base font-bold font-mono">{skippedCount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Import Complete Report */}
          {importCompleted && (
            <div className="p-6 bg-[#3D705C]/5 border border-[#3D705C]/20 rounded-2xl space-y-5 animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 text-[#3D705C]">
                <div className="p-2.5 rounded-xl bg-[#3D705C]/15">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#180200]">Import Successfully Finished!</h3>
                  <p className="text-xs text-[#3D705C] font-semibold">
                    {successCount.toLocaleString()} live members have been registered into the database with permanent membership numbers.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-white rounded-xl border border-[#E8DFD8]">
                  <span className="block text-[10px] font-bold uppercase text-[#863221]">Total Records</span>
                  <span className="text-lg font-bold text-[#180200]">{parsedRows.length.toLocaleString()}</span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-[#3D705C]/30 text-[#3D705C]">
                  <span className="block text-[10px] font-bold uppercase">Successfully Active</span>
                  <span className="text-lg font-bold">+{successCount.toLocaleString()}</span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-amber-200 text-amber-800">
                  <span className="block text-[10px] font-bold uppercase">Duplicates Skipped</span>
                  <span className="text-lg font-bold">{skippedCount.toLocaleString()}</span>
                </div>
              </div>

              {skippedList.length > 0 && (
                <div className="bg-white rounded-xl border border-[#E8DFD8] p-4 space-y-2">
                  <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wide flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Skipped Records Summary ({skippedList.length.toLocaleString()})
                  </h4>
                  <div className="max-h-36 overflow-y-auto text-xs divide-y divide-[#E8DFD8]/60">
                    {skippedList.slice(0, 50).map((s, idx) => (
                      <div key={idx} className="py-1 flex items-center justify-between text-[#863221]">
                        <span className="font-mono font-medium">#{s.membership_number}</span>
                        <span className="text-[11px] text-amber-700">{s.reason}</span>
                      </div>
                    ))}
                    {skippedList.length > 50 && (
                      <div className="py-1 text-center text-[11px] text-[#863221]/70">
                        ...and {skippedList.length - 50} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-white transition-colors cursor-pointer"
                >
                  Import Another File
                </button>
                <Link
                  to="/dashboard/receipts/bulk-mapping"
                  className="px-5 py-2.5 text-xs font-bold rounded-xl bg-[#510601] hover:bg-[#863221] text-white shadow-sm transition-colors"
                >
                  Go to Bulk Receipt Auto-Mapping →
                </Link>
                <Link
                  to="/dashboard/membership/list"
                  className="px-5 py-2.5 text-xs font-bold rounded-xl border border-[#510601] text-[#510601] hover:bg-[#510601]/5 transition-colors"
                >
                  View Member Directory
                </Link>
              </div>
            </div>
          )}

          {/* Data Preview Table (First 10 rows) */}
          {previewRows.length > 0 && !isImporting && !importCompleted && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#510601]" />
                  Data Verification Preview (First 10 of {parsedRows.length.toLocaleString()} rows)
                </h4>
                <span className="text-[11px] font-semibold text-[#863221]">
                  Verify columns before executing import
                </span>
              </div>

              <div className="border border-[#E8DFD8] rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#180200] font-bold">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Membership No</th>
                      <th className="py-2.5 px-3">Full Name</th>
                      <th className="py-2.5 px-3">Mobile</th>
                      <th className="py-2.5 px-3">Gender</th>
                      <th className="py-2.5 px-3">City / Place</th>
                      <th className="py-2.5 px-3">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]/60 text-[#180200]">
                    {previewRows.map((r, i) => (
                      <tr key={i} className="hover:bg-[#FAF7F2]/60 transition-colors">
                        <td className="py-2 px-3 text-[#863221]/70">{i + 1}</td>
                        <td className="py-2 px-3 font-mono font-bold text-[#510601]">{r.membership_number}</td>
                        <td className="py-2 px-3 font-medium">
                          {r.first_name_en} {r.last_name_en || ''}
                          {r.full_name_kn ? <span className="block text-[11px] text-[#863221]/70">{r.full_name_kn}</span> : null}
                        </td>
                        <td className="py-2 px-3 font-mono">{r.mobile || '—'}</td>
                        <td className="py-2 px-3">{r.gender || 'MALE'}</td>
                        <td className="py-2 px-3">{r.city || r.locality || '—'}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded bg-[#FAF7F2] border border-[#E8DFD8] text-[10px] font-bold text-[#863221]">
                            {r.membership_type || 'Life Member'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}
