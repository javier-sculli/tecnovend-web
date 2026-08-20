import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';

export default function AlertModal({
  isOpen,
  onClose,
  title = 'Aviso',
  message,
  type = 'info' // 'info' | 'error' | 'success'
}) {
  if (!isOpen || !message) return null;

  const isError = type === 'error';
  const isSuccess = type === 'success';

  const badgeColor = isError ? '#ef4444' : isSuccess ? '#10b981' : '#3b82f6';
  const headerTitle = title || (isError ? 'Error' : isSuccess ? 'Éxito' : 'Aviso');

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: badgeColor,
              display: 'inline-block'
            }} />
            <div className="modal-title">{headerTitle}</div>
          </div>
          <button className="modal-close" onClick={onClose}>{Icon.x}</button>
        </div>
        <div className="modal-body" style={{ gap: 12, padding: '20px 22px' }}>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {message}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose} autoFocus>
            Aceptar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
