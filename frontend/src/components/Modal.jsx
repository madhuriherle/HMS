import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Global Viewport-Level Modal Backdrop & Dialog Container
 * Renders into document.body to ensure complete 100vw x 100vh edge-to-edge
 * backdrop coverage over the entire browser viewport (including sidebar, header, and top areas).
 */
export default function Modal({
  isOpen = true,
  onClose,
  children,
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
      {children}
    </div>,
    document.body
  );
}
