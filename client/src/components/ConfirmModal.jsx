import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'danger'
}) {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('Error en confirmación:', err);
    } finally {
      setLoading(false);
    }
  };

  const isDanger = variant === 'danger';

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !loading && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
          </div>
          <button className="modal-close" onClick={onClose} disabled={loading}>{Icon.x}</button>
        </div>
        <div className="modal-body" style={{ gap: 12, padding: '20px 22px' }}>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {description}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button 
            className={`btn ${isDanger ? 'danger' : 'primary'}`} 
            onClick={handleConfirm} 
            disabled={loading}
            style={isDanger ? { background: '#ef4444', color: '#fff', border: 'none' } : {}}
          >
            {loading ? 'Procesando…' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
