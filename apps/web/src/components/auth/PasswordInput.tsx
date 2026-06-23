'use client';

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** id(s) of error/description elements for aria-describedby */
  describedBy?: string;
  placeholder?: string;
  autoComplete?: string;
  label?: string;
}

/**
 * Accessible password field with a show/hide toggle and Caps Lock detection.
 * Visibility state is local and intentionally not persisted — it resets on remount.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  placeholder = 'Enter your password',
  autoComplete = 'current-password',
  label = 'Password',
}: PasswordInputProps) {
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const capsId = `${id}-caps`;
  const describedByIds = [describedBy, capsLock ? capsId : null].filter(Boolean).join(' ') || undefined;

  const detectCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // getModifierState is supported in all modern browsers; guard for safety.
    if (typeof e.getModifierState === 'function') {
      setCapsLock(e.getModifierState('CapsLock'));
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-[#211A4D]">
        {label}
      </label>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9A94A6]"
          aria-hidden="true"
        />
        <input
          id={id}
          name="password"
          type={show ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={detectCaps}
          onKeyDown={detectCaps}
          onBlur={() => setCapsLock(false)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByIds}
          className={[
            'h-[54px] w-full rounded-xl border bg-white pl-12 pr-12 text-[15px] text-[#202124]',
            'placeholder:text-[#9A94A6] transition-shadow outline-none',
            'focus:ring-4 focus:ring-[#7C5CFC]/[0.18] disabled:cursor-not-allowed disabled:opacity-60',
            invalid
              ? 'border-[#D92D20] focus:border-[#D92D20]'
              : 'border-[#E4E0EA] focus:border-[#7C5CFC]',
          ].join(' ')}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A78] transition-colors hover:bg-[#F2EFF7] hover:text-[#211A4D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>

      <p
        id={capsId}
        aria-live="polite"
        className={[
          'mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[#D97706] transition-opacity',
          capsLock ? 'opacity-100' : 'pointer-events-none h-0 overflow-hidden opacity-0',
        ].join(' ')}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Caps Lock is on
      </p>
    </div>
  );
}

export default PasswordInput;
