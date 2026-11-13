import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

export function Modal({
  title, subtitle, icon, onClose, children, footer, width = 560,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <header className="modal__head">
          <div className="modal__heading">
            {icon && <span className="modal__icon">{icon}</span>}
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Btn({
  children, onClick, variant = 'ghost', disabled, title, type = 'button', className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button type={type} className={`btn btn--${variant} ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function IconBtn({
  children, onClick, title, active, danger, disabled, className = '',
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''} ${className}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
}

export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  return (
    <>
      <div className="menu-dismiss" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="menu"
        style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - items.length * 34 - 20) }}
        role="menu"
      >
        {items.map((it, i) =>
          it.divider ? (
            <div key={i} className="menu__divider" />
          ) : (
            <button
              key={i}
              className={`menu__item ${it.danger ? 'is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => { onClose(); it.onClick?.(); }}
              role="menuitem"
            >
              <span className="menu__ico">{it.icon}</span>
              <span>{it.label}</span>
            </button>
          )
        )}
      </div>
    </>
  );
}

export function Empty({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art">{icon}</div>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export interface ToastItem { id: number; msg: string; kind: 'ok' | 'err' }

/** 全局通知中心：固定在窗口上部中间，多条竖向堆叠。
 *  容器 pointer-events:none，只有通知条本身接收点击，不挡住下面的工具栏 / 弹窗。 */
export function ToastHost({ items, onClose }: { items: ToastItem[]; onClose: (id: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="toast-host" role="region" aria-label="通知" aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className={`toast toast--${it.kind}`} role="status">
          {it.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{it.msg}</span>
          <button className="toast__close" title="关闭这条通知" onClick={() => onClose(it.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)} title={o.label}>
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
