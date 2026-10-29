import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';

/**
 * The format of an import file: what the file is, a button for a blank format file (when the server has one), and every column
 * with what it holds. The columns come from the server (`formatUrl`), so this screen and the import cannot disagree.
 */
export default function ImportFormat({ formatUrl, templateUrl = null, templateFile = 'format.xlsx', children }) {
  const [format, setFormat] = useState(null);

  useEffect(() => {
    let current = true;
    api.get(formatUrl).then(({ data }) => { if (current) setFormat(data); }).catch(() => {});
    return () => { current = false; };
  }, [formatUrl]);

  const download = async () => {
    try {
      const { data } = await api.get(templateUrl, { responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(data);
      a.download = templateFile;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not download the format file', 'error');
    }
  };

  return (
    <div className="rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-[#510601]">File format</span>
        {templateUrl && (
          <button type="button" onClick={download} className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#510601] text-[#510601] hover:bg-[#510601]/5 text-xs font-bold rounded-lg cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Download format file
          </button>
        )}
      </div>
      {children && <p className="text-[#7D7068]">{children}</p>}
      <details>
        <summary className="cursor-pointer font-semibold text-[#863221]">See every column</summary>
        <div className="mt-2 max-h-56 overflow-y-auto space-y-2.5 pr-1">
          {(format?.groups || []).map((g) => (
            <div key={g.group}>
              {format.groups.length > 1 && <div className="font-bold text-[#510601]">{g.group}</div>}
              <ul className="mt-0.5 space-y-0.5">
                {g.columns.map((c) => (
                  <li key={c.name} className="flex gap-2">
                    <span className="font-mono font-semibold text-[#180200] shrink-0">{c.name}{c.required ? ' *' : ''}</span>
                    <span className="text-[#7D7068]">{c.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!format && <p className="text-[#7D7068]">Loading…</p>}
        </div>
      </details>
      <p className="text-[10px] text-[#9E8B7F]">* required</p>
    </div>
  );
}
