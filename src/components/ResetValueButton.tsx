import React, { useId } from 'react';

export const RESET_VALUE_HINT = '숫자를 누르면 해당 항목만 초기화됩니다.';

export function ResetValueButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const tooltipId = useId();
  return (
    <span className="group/reset relative inline-flex">
      <button {...props} type="button" aria-describedby={tooltipId} className={className}>{children}</button>
      <span id={tooltipId} role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-50 mb-1 w-max max-w-[230px] rounded bg-[var(--ui-bg-slate700)] px-2 py-1 text-[11px] font-normal text-[color:var(--ui-tooltip-text)] shadow-lg invisible opacity-0 group-hover/reset:visible group-hover/reset:opacity-100 group-focus-within/reset:visible group-focus-within/reset:opacity-100">
        누르면 이 항목만 기본값으로 초기화
      </span>
    </span>
  );
}
