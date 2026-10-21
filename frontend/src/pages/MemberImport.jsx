import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  FileText,
  Check,
  X,
  History,
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { formatDateTime } from '../utils/dateUtils';
import { confirmAction } from '../utils/actionConfirm';
import { memberName } from '../utils/memberName';

export default function MemberImport() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
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

  // "Check file": the server judges every row exactly as the import would, but saves nothing
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  // Import history (right-side panel): who imported which file, when, and the result
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyDetail, setHistoryDetail] = useState(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const { data } = await api.get('/members/import-history', { params: { limit: 50 } });
      setHistory(data.data || []);
    } catch (err) {
      setHistoryError(err.response?.data?.detail || 'Could not load the import history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistoryDetail = async (id) => {
    try {
      const { data } = await api.get(`/members/import-history/${id}`);
      setHistoryDetail(data);
    } catch (err) {
      notify(err.response?.data?.detail || 'Could not load that import.', 'error');
    }
  };

  useEffect(() => {
    if (historyOpen) loadHistory();
    else setHistoryDetail(null);
  }, [historyOpen]);

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
      const firstName = obj.first_name_en || obj.first_name || obj.name || obj.full_name || obj.membership_name || obj.member_name;

      if (memNum && firstName) {
        rows.push({
          membership_number: String(memNum).trim(),
          first_name_en: String(firstName).trim(),
          middle_name_en: (obj.middle_name_en || '').trim() || null,
          last_name_en: (obj.last_name_en || obj.last_name || '').trim() || null,
          full_name_kn: (obj.full_name_kn || '').trim() || null,
          mobile: (obj.mobile || obj.phone || obj.mobile_number || '').trim() || null,
          gotra: (obj.gotra || obj.gothra || '').trim() || null,
          gender: (obj.gender || '').trim().toUpperCase() || null,
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

    const showRows = (rows) => {
      setParsedRows(rows);
      setPreviewRows(rows.slice(0, 10));
      if (rows.length === 0) {
        notify('No valid member rows found. Please check columns.', 'error');
      } else {
        notify(`Loaded ${rows.length.toLocaleString()} member records ready for import.`, 'success');
      }
    };

    // An Excel file (.xlsx, or an Excel saved with a .csv name) cannot be read as text: the server reads it.
    const readOnServer = async () => {
      try {
        const form = new FormData();
        form.append('file', selected);
        const { data } = await api.post('/members/bulk-import/preview', form);
        showRows(data?.members || []);
      } catch (err) {
        setParsedRows([]);
        setPreviewRows([]);
        notify(err.response?.data?.detail || 'Could not read the file.', 'error');
      }
    };

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result;
        if (typeof text !== 'string') return;
        if (/\.xlsx?$/i.test(selected.name) || text.startsWith('PK')) {
          readOnServer();
          return;
        }
        showRows(parseCSV(text));
      } catch (err) {
        console.error(err);
        notify('Could not parse file. Please use standard CSV format.', 'error');
      }
    };
    reader.readAsText(selected);
  };

  // Run the batch import
  const handleCheckFile = async () => {
    if (!parsedRows.length) return;
    setChecking(true);
    setCheckResult(null);
    const BATCH = 300;
    const seen = new Set(); // a number repeated later in the same file is skipped by the import, so it is here too
    const rows = [];
    const result = { total: parsedRows.length, wouldImport: 0, skipped: [], skippedCount: 0, warnings: [], warningCount: 0 };
    for (const r of parsedRows) {
      const key = String(r.membership_number || '').trim().toUpperCase();
      if (key && seen.has(key)) {
        result.skippedCount += 1;
        if (result.skipped.length < 200) result.skipped.push({ membership_number: r.membership_number, reason: 'Already exists in database or earlier in this file' });
        continue;
      }
      if (key) seen.add(key);
      rows.push(r);
    }
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const { data } = await api.post('/members/bulk-import/validate', { members: rows.slice(i, i + BATCH), skip_duplicates: skipDuplicates });
        result.wouldImport += data.success_count || 0;
        result.skippedCount += data.skipped_count || 0;
        result.warningCount += data.warning_count || 0;
        if (result.skipped.length < 200) result.skipped.push(...(data.skipped || []).slice(0, 200 - result.skipped.length));
        if (result.warnings.length < 200) result.warnings.push(...(data.warnings || []).slice(0, 200 - result.warnings.length));
      }
      setCheckResult(result);
    } catch (err) {
      notify(err.response?.data?.detail || 'Could not check the file.', 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleStartImport = async () => {
    if (!parsedRows || parsedRows.length === 0) {
      notify('Please select a file with valid member records.', 'error');
      return;
    }

    // one confirmation for the whole file (not one per batch of 300)
    const reason = await confirmAction('post', '/members/bulk-import');
    if (!reason) return;

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
    const runId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/-/g, '').slice(0, 32);

    try {
      for (let i = 0; i < totalRows; i += BATCH_SIZE) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE);

        const { data } = await api.post('/members/bulk-import', {
          members: batch,
          skip_duplicates: skipDuplicates,
          run_id: runId,
          file_name: fileName,
          total_rows: totalRows
        }, { headers: { 'X-Action-Reason': reason } });

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
    setCheckResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <PermissionGate required={['members.import.read', 'members.import.write']} title="Access Restricted" message="You need the Member Import privilege to open this page.">
      <div className="space-y-6">
        {/* Action Toolbar */}
        <div className="flex items-center justify-end gap-3 -mb-2">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              title="Import history"
              aria-label="Import history"
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-[#E8DFD8] text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] transition-colors cursor-pointer"
            >
              <History className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-white border border-[#510601] text-[#510601] hover:bg-[#510601]/5 transition-colors cursor-pointer shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download Template CSV
            </button>
          </div>

        {/* Upload & Progress Card */}
        <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm p-6 space-y-6">
          {!importCompleted && (
            <div className="space-y-4">
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider">
                Select Member Data File (.CSV or .XLSX)
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
                  accept=".csv,.txt,.xlsx"
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
                      onClick={handleCheckFile}
                      disabled={checking}
                      title="Shows what the import would do. Nothing is saved."
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#510601] rounded-xl border border-[#510601] hover:bg-[#510601]/5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {checking ? 'Checking...' : 'Check file (nothing is saved)'}
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

              {checkResult && parsedRows.length > 0 && !isImporting && (
                <div className="p-4 rounded-2xl border border-[#E8DFD8] bg-[#FAF7F2] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-[#180200] uppercase tracking-wider">Check result - nothing was saved</p>
                    <button type="button" onClick={() => setCheckResult(null)} className="p-1 text-[#863221] hover:text-[#180200] cursor-pointer" aria-label="Close">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {[
                      ['Rows in file', checkResult.total],
                      ['Would be imported', checkResult.wouldImport],
                      ['Would be skipped', checkResult.skippedCount],
                      ['Imported, please check', checkResult.warningCount],
                    ].map(([k, v]) => (
                      <div key={k} className="p-3 bg-white rounded-xl border border-[#E8DFD8]">
                        <p className="text-[#863221] font-semibold uppercase text-[10px]">{k}</p>
                        <p className="mt-0.5 text-base font-bold text-[#180200]">{Number(v).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  {[
                    ['Would be skipped', checkResult.skipped, checkResult.skippedCount, (r) => r.reason],
                    ['Imported, please check', checkResult.warnings, checkResult.warningCount, (r) => r.warning],
                  ].map(([title, list, count, text]) => (
                    list.length > 0 && (
                      <details key={title} className="bg-white rounded-xl border border-[#E8DFD8]">
                        <summary className="px-3 py-2 text-xs font-bold text-[#180200] cursor-pointer">
                          {title} (first {list.length}{count > list.length ? ` of ${Number(count).toLocaleString()}` : ''})
                        </summary>
                        <ul className="max-h-56 overflow-y-auto divide-y divide-[#E8DFD8] text-xs">
                          {list.map((r, i) => (
                            <li key={i} className="flex items-start justify-between gap-3 px-3 py-1.5">
                              <span className="font-semibold text-[#180200] shrink-0">{r.membership_number || '-'}</span>
                              <span className="text-[#863221] text-right">{text(r)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )
                  ))}
                  <p className="text-[11px] text-[#863221]">A mobile shared between two rows of this file is only flagged when the import runs.</p>
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
                        <span className="font-mono font-medium">{s.membership_number}</span>
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
                {hasPermission('receipts.bulk_mapping.read') && (
                  <Link
                    to="/dashboard/receipts/bulk-mapping"
                    className="px-5 py-2.5 text-xs font-bold rounded-xl bg-[#510601] hover:bg-[#863221] text-white shadow-sm transition-colors"
                  >
                    Go to Bulk Receipt Auto-Mapping →
                  </Link>
                )}
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
                          {memberName(r)}
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

        {historyOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Import history">
            <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryOpen(false)} />
            <aside className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col">
              <div className="px-5 h-14 flex items-center justify-between border-b border-[#E8DFD8] bg-[#FAF7F2] shrink-0">
                <h2 className="text-base font-bold text-[#180200]">{historyDetail ? 'Import details' : 'Import history'}</h2>
                <div className="flex items-center gap-1">
                  {!historyDetail && (
                    <button type="button" onClick={loadHistory} title="Refresh" className="p-2 rounded-lg text-[#863221] hover:bg-white cursor-pointer">
                      <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  <button type="button" onClick={() => setHistoryOpen(false)} title="Close" className="p-2 rounded-lg text-[#863221] hover:bg-white cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {historyDetail ? (
                  <div className="space-y-4">
                    <button type="button" onClick={() => setHistoryDetail(null)} className="text-xs font-semibold text-[#510601] hover:underline cursor-pointer">
                      &larr; All imports
                    </button>
                    <dl className="grid grid-cols-2 gap-3 text-xs">
                      {[
                        ['File', historyDetail.file_name || '-'],
                        ['Imported by', historyDetail.imported_by],
                        ['Started', formatDateTime(historyDetail.imported_at, '-', false)],
                        ['Finished', formatDateTime(historyDetail.finished_at, '-', false)],
                        ['Rows in file', Number(historyDetail.total_rows).toLocaleString()],
                        ['Rows processed', Number(historyDetail.processed_rows).toLocaleString()],
                        ['Imported', Number(historyDetail.success_count).toLocaleString()],
                        ['Skipped', Number(historyDetail.skipped_count).toLocaleString()],
                        ['Imported with a note', Number(historyDetail.warning_count || 0).toLocaleString()],
                        ['Existing numbers', historyDetail.skip_duplicates ? 'Skipped' : 'Stopped the import'],
                        ['Status', historyDetail.status === 'COMPLETED' ? 'Completed' : 'Stopped before the end'],
                      ].map(([k, v]) => (
                        <div key={k} className="p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] min-w-0">
                          <dt className="text-[#863221] font-semibold uppercase text-[10px]">{k}</dt>
                          <dd className="mt-0.5 font-bold text-[#180200] break-words">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div>
                      <h3 className="text-xs font-bold text-[#180200] uppercase tracking-wider mb-2">
                        Skipped rows{historyDetail.skipped_count > (historyDetail.skipped || []).length ? ` (first ${(historyDetail.skipped || []).length} of ${Number(historyDetail.skipped_count).toLocaleString()})` : ''}
                      </h3>
                      {(historyDetail.skipped || []).length === 0 ? (
                        <p className="text-xs text-[#863221]">Nothing was skipped.</p>
                      ) : (
                        <ul className="divide-y divide-[#E8DFD8] border border-[#E8DFD8] rounded-xl text-xs">
                          {historyDetail.skipped.map((r, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                              <span className="font-semibold text-[#180200]">{r.membership_number || '-'}</span>
                              <span className="text-[#863221] text-right">{r.reason}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-[#180200] uppercase tracking-wider mb-2">
                        Imported, please check{(historyDetail.warning_count || 0) > (historyDetail.warnings || []).length ? ` (first ${(historyDetail.warnings || []).length} of ${Number(historyDetail.warning_count).toLocaleString()})` : ''}
                      </h3>
                      {(historyDetail.warnings || []).length === 0 ? (
                        <p className="text-xs text-[#863221]">Nothing to check.</p>
                      ) : (
                        <ul className="divide-y divide-[#E8DFD8] border border-[#E8DFD8] rounded-xl text-xs">
                          {historyDetail.warnings.map((r, i) => (
                            <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                              <span className="font-semibold text-[#180200] shrink-0">{r.membership_number}</span>
                              <span className="text-[#863221] text-right">{r.warning}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : historyError ? (
                  <p className="text-sm font-semibold text-red-700">{historyError}</p>
                ) : historyLoading && history.length === 0 ? (
                  <p className="text-sm text-[#863221]">Loading...</p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-[#863221]">No imports have been run yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {history.map((h) => (
                      <li key={h.id}>
                        <button type="button" onClick={() => openHistoryDetail(h.id)}
                          className="w-full text-left p-3.5 rounded-xl border border-[#E8DFD8] hover:border-[#510601] hover:bg-[#FAF7F2] transition-colors cursor-pointer">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold text-[#180200] break-all">{h.file_name || 'Imported file'}</p>
                            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${h.status === 'COMPLETED' ? 'bg-[#3D705C]/10 text-[#3D705C]' : 'bg-[#FFC107]/20 text-[#863221]'}`}>
                              {h.status === 'COMPLETED' ? 'Completed' : 'Stopped'}
                            </span>
                          </div>
                          <p className="text-xs text-[#863221] mt-1">
                            {h.imported_by} &middot; {formatDateTime(h.imported_at, '-', false)}
                          </p>
                          <p className="text-xs text-[#180200] mt-1.5">
                            <span className="font-bold">{Number(h.success_count).toLocaleString()}</span> imported &middot;{' '}
                            <span className="font-bold">{Number(h.skipped_count).toLocaleString()}</span> skipped of{' '}
                            {Number(h.total_rows).toLocaleString()}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
