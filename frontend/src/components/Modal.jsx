import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Global Viewport-Level Modal Backdrop & Dialog Container
 * Renders into document.body to ensure complete 100vw x 100vh edge-to-edge
 * backdrop coverage over the entire browser viewport (including sidebar, header, and top areas).
 */
export default function Modal({
  isOpen = true,
  onClose,
  children,
  title,                 // given: the popup draws the standard card with a header bar (rule 12.9)
  maxWidthClass = 'max-w-2xl',
  className = '',
  backdropClassName = 'bg-[#180200]/60 backdrop-blur-sm',
  closeOnBackdrop = true,
  preventScroll = true
}) {
  // Prevent document body scrolling while modal is active
  useEffect(() => {
    if (!isOpen) return;

    if (preventScroll) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen, preventScroll]);

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen || !onClose) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto ${backdropClassName} ${className} animate-in fade-in duration-200`}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        margin: 0
      }}
      onClick={(e) => {
        if (closeOnBackdrop && onClose && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {title ? (
        <div
          className={`bg-white rounded-2xl ${maxWidthClass} w-full border border-[#E8DFD8] shadow-2xl overflow-y-auto flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 h-14 shrink-0 sticky top-0 z-10 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200] truncate">{title}</h3>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          {children}
        </div>
      ) : (
        children
      )}
    </div>,
    document.body
  );
}
