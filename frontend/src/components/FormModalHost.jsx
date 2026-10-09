import React, { useEffect, useState } from 'react';
import { X, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import Modal from './Modal';
import { registerFormHost } from '../utils/dialogs';

// The popup used by askForm(): same look as the Add / Edit popups on the other screens
// (cream header with icon, uppercase labels, Active/Inactive buttons, Cancel + action buttons).
// Mounted once in App.jsx.

const inputClass = (hasError) =>
  `w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${
    hasError
      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
  }`;

export default function FormModalHost() {
  const [req, setReq] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(
    () =>
      registerFormHost((request) => {
        const initial = {};
        request.fields.forEach((f) => {
          initial[f.name] = f.type === 'status' ? f.value || 'Active' : f.value ?? '';
        });
        setValues(initial);
        setErrors({});
        setReq(request);
      }),
    []
  );

  if (!req) return null;

  const close = (result) => {
    // Close the form first, then hand the values back on the next tick so the
    // caller's confirmation popup opens over a closed form, never on top of it.
    setReq(null);
    window.setTimeout(() => req.resolve(result), 0);
  };

  const setValue = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const submit = (e) => {
    e.preventDefault();
    const nextErrors = {};
    const out = {};
    req.fields.forEach((f) => {
      let v = values[f.name];
      if (typeof v === 'string') v = v.trim();
      if (f.required && (v === '' || v === null || v === undefined)) {
        nextErrors[f.name] = `${f.label} is required.`;
      }
      if (f.type === 'number' && v !== '' && (Number.isNaN(Number(v)) || Number(v) < 0)) {
        nextErrors[f.name] = `${f.label} must be a valid number.`;
      }
      out[f.name] = f.type === 'number' && v !== '' ? Number(v) : v;
    });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    close(out);
  };

  return (
    <Modal isOpen onClose={() => close(null)}>
      <div
        className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#180200]">{req.title}</h3>
              {req.text && <p className="text-xs text-[#863221]">{req.text}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => close(null)}
            className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {req.fields.map((f) => (
            <div key={f.name}>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                {f.label} {f.required && <span className="text-[#ED4636]">*</span>}
              </label>

              {f.type === 'status' ? (
                <div className="grid grid-cols-2 gap-3">
                  {['Active', 'Inactive'].map((opt) => {
                    const on = values[f.name] === opt;
                    const green = opt === 'Active';
                    return (
                      <label
                        key={opt}
                        className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer font-semibold text-xs transition-all ${
                          on
                            ? green
                              ? 'border-[#3D705C] bg-[#3D705C]/10 text-[#3D705C] ring-1 ring-[#3D705C]'
                              : 'border-[#ED4636] bg-[#ED4636]/10 text-[#ED4636] ring-1 ring-[#ED4636]'
                            : 'border-[#E8DFD8] bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name={f.name}
                          value={opt}
                          checked={on}
                          onChange={() => setValue(f.name, opt)}
                          className="hidden"
                        />
                        {green ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              ) : f.type === 'select' ? (
                <select
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  className={`${inputClass(errors[f.name])} cursor-pointer`}
                >
                  <option value="">-- Select --</option>
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  className={inputClass(errors[f.name])}
                />
              ) : f.type === 'file' ? (
                <input
                  type="file"
                  accept={f.accept}
                  onChange={(e) => setValue(f.name, e.target.files?.[0] || '')}
                  className={`${inputClass(errors[f.name])} file:mr-3 file:rounded-lg file:border-0 file:bg-[#510601] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
                />
              ) : (
                <input
                  type={f.type || 'text'}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  className={inputClass(errors[f.name])}
                />
              )}

              {errors[f.name] && (
                <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errors[f.name]}
                </p>
              )}
            </div>
          ))}

          {/* Actions */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E8DFD8]">
            <button
              type="button"
              onClick={() => close(null)}
              className="px-4 py-2.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{req.confirmText || 'Save'}</span>
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
